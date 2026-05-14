#!/bin/bash
set -euo pipefail

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Docker sandbox entrypoint for eval agent runs.
#
# This script runs as root to configure network isolation, then drops to an
# unprivileged user before executing the eval runner. The container is started
# with --cap-drop=ALL plus only NET_ADMIN, SETUID, and SETGID capabilities.
# After this script completes its setup, all capabilities are cleared via
# setpriv --inh-caps=-all, so the application process runs with zero caps.
#
# Execution order:
#   1. Apply iptables rules (requires NET_ADMIN as root)
#   2. Validate workspace mount exists
#   3. Resolve agent CLI paths
#   4. Drop to UID 1000 (node) with no capabilities
#   5. Execute the sandbox-runner.js (eval agent + grading)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ─── Network isolation ────────────────────────────────────────────────────────
#
# Goal: Allow public internet (npm registries, LLM proxy, documentation) while
# blocking all access to the host machine, Docker bridge, LAN, and cloud
# metadata endpoints. This prevents a malicious or misbehaving agent from
# reaching internal services.
#
# Strategy:
#   - Default policy: DROP on all chains (fail-closed)
#   - Explicitly ACCEPT only: loopback, DNS to known resolvers, public internet
#   - Explicitly REJECT RFC 1918 + link-local (fast failure, not silent timeout)
#   - IPv6 is disabled entirely at the Docker level (--sysctl flag)
#
# Rule order matters: iptables evaluates rules top-to-bottom, first match wins.

# Default DROP — if rules are flushed or a rule is accidentally removed,
# all traffic is blocked rather than silently allowed.
iptables -P OUTPUT DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP

# INPUT chain: allow responses to our outbound connections and loopback traffic.
# Without these, TCP handshakes and HTTP responses would be dropped.
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT

# OUTPUT chain: allow packets belonging to already-established connections.
# This means once a connection is initiated (and passes later rules), its
# ongoing packets flow freely without hitting the REJECT rules below.
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow all traffic to loopback (127.0.0.0/8).
# Needed for: local dev servers the agent may start (e.g., vite), inter-process
# communication, and Docker's embedded DNS resolver at 127.0.0.11.
iptables -A OUTPUT -d 127.0.0.0/8 -j ACCEPT

# Allow DNS queries only to nameservers listed in /etc/resolv.conf.
# In Docker, this is typically 127.0.0.11 (embedded DNS). We restrict to known
# resolvers to prevent using port 53 as a covert channel to internal networks.
for ns in $(awk '/^nameserver/ {print $2}' /etc/resolv.conf); do
  iptables -A OUTPUT -d "$ns" -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -d "$ns" -p tcp --dport 53 -j ACCEPT
done

# REJECT (not DROP) traffic to private networks. REJECT sends an ICMP
# "unreachable" back immediately so the agent fails fast instead of hanging
# on connection timeouts.
#
# RFC 1918 ranges cover:
#   10.0.0.0/8     — common in corporate/cloud VPCs
#   172.16.0.0/12  — includes Docker bridge networks (172.17.x.x)
#   192.168.0.0/16 — typical home/office LANs
iptables -A OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-net-unreachable
iptables -A OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-unreachable
iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-net-unreachable

# Block link-local addresses (169.254.0.0/16).
# These are used for cloud instance metadata services (AWS 169.254.169.254,
# GCP, Azure) and Docker's host.docker.internal alias. We override the alias
# separately (--add-host flag), but this catches any direct IP access.
iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-net-unreachable

# Everything else is public internet — allow it.
# This enables: npm install, pip install, fetching documentation, calling the
# LLM proxy (llm.atko.ai), and any other public API the agent needs.
iptables -A OUTPUT -j ACCEPT

echo "[sandbox] Network isolation applied — internal/host traffic blocked"

# ─── Workspace validation ─────────────────────────────────────────────────────
# The workspace is bind-mounted from the host's temp directory. It contains the
# eval scaffold files and is where the agent writes its output. The host reads
# results from this directory after the container exits.
if [ ! -d "/workspace" ]; then
  echo "ERROR: /workspace is not mounted" >&2
  exit 1
fi

# ─── Agent CLI resolution ─────────────────────────────────────────────────────
# Different agent runners need their CLI binary available. We validate the binary
# exists and is executable, then export its path so the SDK can find it.
# These are installed at image build time via npm ci.

if [ "${AGENT_TYPE:-}" = "claude-code" ]; then
  # The Claude Agent SDK uses pathToClaudeCodeExecutable to spawn this binary.
  # Without this, the SDK falls back to a platform-specific native binary that
  # may not be installed in the container.
  export CLAUDE_CLI_PATH="/app/node_modules/.bin/claude"
  if [ ! -x "$CLAUDE_CLI_PATH" ]; then
    echo "ERROR: claude CLI not found at $CLAUDE_CLI_PATH" >&2
    exit 1
  fi
  echo "[sandbox] CLAUDE_CLI_PATH=$CLAUDE_CLI_PATH"
fi

if [ "${AGENT_TYPE:-}" = "gemini-cli" ]; then
  if [ ! -x "/app/node_modules/.bin/gemini" ]; then
    echo "ERROR: gemini CLI not found at /app/node_modules/.bin/gemini" >&2
    exit 1
  fi
fi

# Add node_modules/.bin to PATH so all CLI tools (claude, gemini, copilot) are
# resolvable by name when the runner spawns child processes.
export PATH="/app/node_modules/.bin:$PATH"

# ─── Drop privileges and run ──────────────────────────────────────────────────
# Why setpriv instead of su/gosu:
#   - su resets PATH via PAM, breaking CLI resolution
#   - gosu requires an additional binary install
#   - setpriv is built into util-linux (already in the base image), preserves
#     the full environment, and can clear inheritable capabilities in one step
#
# --reuid/--regid=1000: switch to the 'node' user (UID/GID 1000 from base image)
# --init-groups: set supplementary groups for the target user
# --inh-caps=-all: clear ALL inheritable capabilities — the node process and any
#   children it spawns will have zero capabilities, even if they somehow exec a
#   setcap binary. Combined with --security-opt=no-new-privileges on the container,
#   there is no path back to elevated privileges.
#
# HOME must be set explicitly because setpriv doesn't change it (unlike su).
# It points to /home/node which is a writable tmpfs mount.
export HOME=/home/node
exec setpriv --reuid=1000 --regid=1000 --init-groups --inh-caps=-all \
  node /app/packages/eval/dist/cli/sandbox-runner.js
