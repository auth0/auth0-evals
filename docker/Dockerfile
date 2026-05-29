# ── Builder stage: compile TypeScript and prune dev deps ──────────────────────
FROM node:24-bookworm AS builder

WORKDIR /build

# Install deps first (cache layer)
COPY package.json package-lock.json ./
COPY packages/eval/package.json packages/eval/package.json
COPY packages/eval-core/package.json packages/eval-core/package.json
COPY packages/eval-graders/package.json packages/eval-graders/package.json
COPY packages/eval-reporter/package.json packages/eval-reporter/package.json
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


# Use existing 'node' user (UID 1000) from the base image

WORKDIR /app

# Copy built application from builder
COPY --from=builder /build/package.json /build/package-lock.json ./
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/eval/dist/ packages/eval/dist/
COPY --from=builder /build/packages/eval/package.json packages/eval/package.json
COPY --from=builder /build/packages/eval-core/dist/ packages/eval-core/dist/
COPY --from=builder /build/packages/eval-core/package.json packages/eval-core/package.json
COPY --from=builder /build/packages/eval-graders/dist/ packages/eval-graders/dist/
COPY --from=builder /build/packages/eval-graders/package.json packages/eval-graders/package.json
COPY --from=builder /build/packages/eval-reporter/dist/ packages/eval-reporter/dist/
COPY --from=builder /build/packages/eval-reporter/package.json packages/eval-reporter/package.json

# Copy eval app (config, eval definitions, scaffolds, skills)
COPY --from=builder /build/apps/auth0-evals/dist/ apps/auth0-evals/dist/
COPY --from=builder /build/apps/auth0-evals/package.json apps/auth0-evals/package.json
COPY --from=builder /build/apps/auth0-evals/eval.config.js apps/auth0-evals/eval.config.js
COPY apps/auth0-evals/src/evals/ apps/auth0-evals/src/evals/
COPY apps/auth0-evals/skills/ apps/auth0-evals/skills/

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
