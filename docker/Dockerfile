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
# unzip is needed to extract the Android command-line tools archive.
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
    unzip \
    && rm -rf /var/lib/apt/lists/*

# ── Android SDK (for Expo Android builds: expo prebuild + gradle assembleDebug) ──
# Only the Android toolchain is installed — iOS builds require macOS and are out
# of scope for this Linux sandbox. Versions are pinned so image builds are
# reproducible; bump deliberately when the Expo SDK target moves.
#   - platform-tools + platforms;android-35 + build-tools: standard app build
#   - ndk + cmake: required because Expo SDK 57 / RN 0.86 new architecture compiles C++
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_NDK_VERSION=27.1.12297006
ARG ANDROID_CMDLINE_TOOLS_VERSION=11076708
RUN mkdir -p "${ANDROID_SDK_ROOT}/cmdline-tools" \
    && curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip" -o /tmp/cmdline-tools.zip \
    && unzip -q /tmp/cmdline-tools.zip -d "${ANDROID_SDK_ROOT}/cmdline-tools" \
    && mv "${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools" "${ANDROID_SDK_ROOT}/cmdline-tools/latest" \
    && rm /tmp/cmdline-tools.zip
ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"
RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager --install \
        "platform-tools" \
        "platforms;android-35" \
        "build-tools;35.0.0" \
        "ndk;${ANDROID_NDK_VERSION}" \
        "cmake;3.22.1" > /dev/null


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

# Copy entrypoint
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create workspace mount point and skills-remote directory (for runtime clones)
RUN mkdir -p /workspace && chown node:node /workspace
RUN mkdir -p /app/skills-remote && chown node:node /app/skills-remote

# The container drops to the unprivileged 'node' user, but a gradle Android build
# writes into the SDK dir (license acks, side-by-side NDK components). Hand SDK
# ownership to node so the build isn't blocked by permission errors.
RUN chown -R node:node "${ANDROID_SDK_ROOT}"

# Backup system CA certs so entrypoint.sh can restore them after the tmpfs
# overlay shadows /etc/ssl/certs at runtime (needed for rustls-native-certs,
# used by the Codex CLI, which reads ca-certificates.crt directly at startup).
RUN cp -a /etc/ssl/certs /etc/ssl/certs.bak

# Make application code read-only to prevent tampering
RUN chmod -R a-w /app/node_modules /app/packages /app/apps

# NOTE: Container starts as root to apply iptables rules in entrypoint,
# then drops to 'node' user before running the application.
ENTRYPOINT ["/app/entrypoint.sh"]
