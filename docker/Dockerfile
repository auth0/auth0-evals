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

# Install additional runtimes: Python 3, Java, git, curl, gh, CA certs, iptables
# (for network isolation), plus the system libraries Chromium needs for runtime
# (Playwright) grading. The Chromium deps are installed here via the normal
# apt-get path rather than via `playwright install --with-deps`, whose internal
# apt invocation hangs behind TLS-inspecting proxies. The list mirrors
# `playwright install-deps chromium` (Playwright 1.50, Debian bookworm).
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
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libfontconfig1 \
    libfreetype6 \
    fonts-liberation \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# ── Playwright Chromium for runtime (browser) grading ─────────────────────────
# PLAYWRIGHT_BROWSERS_PATH points at a world-readable location so the dropped
# 'node' user (UID 1000) can launch the browser. System libraries are installed
# in the apt block above, so this only downloads the browser binary (no
# --with-deps, which hangs on this network).
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npx --yes playwright@1.50.0 install chromium \
    && chmod -R a+rX /opt/playwright-browsers


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
