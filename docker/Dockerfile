# ── Builder stage: compile TypeScript and prune dev deps ──────────────────────
FROM node:24-bookworm AS builder

WORKDIR /build

# Install deps first (cache layer)
COPY package.json package-lock.json ./
COPY packages/evals/package.json packages/evals/package.json
COPY packages/evals-core/package.json packages/evals-core/package.json
COPY packages/evals-graders/package.json packages/evals-graders/package.json
COPY packages/evals-reporter/package.json packages/evals-reporter/package.json
COPY apps/auth0-evals/package.json apps/auth0-evals/package.json

RUN npm ci

# Copy source and build
COPY tsconfig.json turbo.json ./
COPY packages/ packages/
COPY apps/auth0-evals/ apps/auth0-evals/

RUN npm run build

# Prune to production deps only
RUN npm prune --omit=dev

# ── Runtime stage: Node base + additional runtimes ────────────────────────────
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
# Ensure git can find the CA bundle regardless of which user runs the container
ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

# Install additional runtimes: Python 3, Java, git, curl, gh, CA certs, iptables (for network isolation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gh \
    git \
    iptables \
    python3 \
    python3-pip \
    python3-venv \
    default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Install the real Auth0 CLI (pinned). HTTP-mocked CLI evals run this binary
# against a local mock Management API — see packages/evals-core/src/mock-http/.
ARG AUTH0_CLI_VERSION=1.32.0
RUN curl -fsSL \
      "https://github.com/auth0/auth0-cli/releases/download/v${AUTH0_CLI_VERSION}/auth0-cli_${AUTH0_CLI_VERSION}_Linux_x86_64.tar.gz" \
      -o /tmp/auth0-cli.tar.gz \
    && tar -xzf /tmp/auth0-cli.tar.gz -C /usr/local/bin auth0 \
    && rm /tmp/auth0-cli.tar.gz \
    && chmod +x /usr/local/bin/auth0 \
    && auth0 --version

# Bake the mock Management API CA into the system trust store so the Go auth0
# CLI accepts the mock server's TLS. This CA is TEST-ONLY: it signs one
# loopback (127.0.0.1) leaf cert served inside the sandbox and guards nothing
# real. Regenerate with apps/auth0-evals/scripts/gen-mock-ca.mjs.
COPY docker/mock-ca/mockCA.pem /usr/local/share/ca-certificates/auth0-evals-mock-ca.crt
RUN update-ca-certificates


# Use existing 'node' user (UID 1000) from the base image

WORKDIR /app

# Copy built application from builder
COPY --from=builder /build/package.json /build/package-lock.json ./
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/evals/dist/ packages/evals/dist/
COPY --from=builder /build/packages/evals/package.json packages/evals/package.json
COPY --from=builder /build/packages/evals-core/dist/ packages/evals-core/dist/
COPY --from=builder /build/packages/evals-core/package.json packages/evals-core/package.json
COPY --from=builder /build/packages/evals-graders/dist/ packages/evals-graders/dist/
COPY --from=builder /build/packages/evals-graders/package.json packages/evals-graders/package.json
COPY --from=builder /build/packages/evals-reporter/dist/ packages/evals-reporter/dist/
COPY --from=builder /build/packages/evals-reporter/package.json packages/evals-reporter/package.json

# Copy eval app (config, eval definitions, scaffolds, skills)
COPY --from=builder /build/apps/auth0-evals/dist/ apps/auth0-evals/dist/
COPY --from=builder /build/apps/auth0-evals/package.json apps/auth0-evals/package.json
COPY --from=builder /build/apps/auth0-evals/eval.config.js apps/auth0-evals/eval.config.js
COPY apps/auth0-evals/src/evals/ apps/auth0-evals/src/evals/
COPY apps/auth0-evals/skills/ apps/auth0-evals/skills/

# Copy the mock Management API leaf cert + key (served by the in-container mock
# HTTP server for HTTP-mocked CLI evals). Path matches SANDBOX_MOCK_CERT_DIR.
# Made world-readable so the unprivileged (UID 1000) runner can read the key —
# these are TEST-ONLY certs for a loopback server and guard nothing real.
COPY docker/mock-ca/mockServer.pem docker/mock-ca/mockServer.key /app/docker/mock-ca/
RUN chmod 0644 /app/docker/mock-ca/mockServer.pem /app/docker/mock-ca/mockServer.key

# Copy entrypoint
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create workspace mount point and skills-remote directory (for runtime clones)
RUN mkdir -p /workspace && chown node:node /workspace
RUN mkdir -p /app/skills-remote && chown node:node /app/skills-remote

# Backup system CA certs so entrypoint.sh can restore them after the tmpfs
# overlay shadows /etc/ssl/certs at runtime (needed for rustls-native-certs,
# used by the Codex CLI, which reads ca-certificates.crt directly at startup).
RUN cp -a /etc/ssl/certs /etc/ssl/certs.bak

# Make application code read-only to prevent tampering
RUN chmod -R a-w /app/node_modules /app/packages /app/apps

# NOTE: Container starts as root to apply iptables rules in entrypoint,
# then drops to 'node' user before running the application.
ENTRYPOINT ["/app/entrypoint.sh"]
