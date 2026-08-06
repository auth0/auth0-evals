#!/usr/bin/env node
/**
 * Regenerates the mock CA and the 127.0.0.1 leaf certificate used by the mock
 * HTTP server (packages/evals-core/src/mock-http/server.ts).
 *
 * These certs are TEST-ONLY. The CA signs exactly one leaf, whose SubjectAltName
 * is the loopback IP 127.0.0.1, and the server only ever binds loopback inside
 * an ephemeral sandbox. The CA guards NOTHING real — it exists solely so the
 * container's trust store (and Go's auth0 CLI) accept the mock server's TLS.
 *
 * Trust is established at image build time by copying mockCA.pem into the
 * container CA store. Rotate by re-running this script and rebuilding the image:
 *
 *   node apps/auth0-evals/scripts/gen-mock-ca.mjs
 *
 * Requires `openssl` on PATH.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Repo-root docker/ is the Docker build context (see packages/evals/src/sandbox/docker.ts).
const outDir = join(here, '..', '..', '..', 'docker', 'mock-ca');
const CA_DAYS = 3650;
const LEAF_DAYS = 3650;

function openssl(args, opts = {}) {
  execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

const work = mkdtempSync(join(tmpdir(), 'mock-ca-'));
try {
  const caKey = join(work, 'mockCA.key');
  const caCert = join(work, 'mockCA.pem');
  const leafKey = join(work, 'mockServer.key');
  const leafCsr = join(work, 'mockServer.csr');
  const leafCert = join(work, 'mockServer.pem');

  // 1. CA key + self-signed CA cert.
  openssl(['genrsa', '-out', caKey, '2048']);
  openssl([
    'req', '-x509', '-new', '-nodes', '-key', caKey,
    '-sha256', '-days', String(CA_DAYS), '-out', caCert,
    '-subj', '/CN=auth0-evals mock CA (test only)/O=auth0-evals',
  ]);

  // 2. Leaf key + CSR.
  openssl(['genrsa', '-out', leafKey, '2048']);
  openssl([
    'req', '-new', '-key', leafKey, '-out', leafCsr,
    '-subj', '/CN=127.0.0.1/O=auth0-evals mock server',
  ]);

  // 3. Sign leaf with SAN = IP:127.0.0.1 (and localhost for good measure).
  const extFile = join(work, 'leaf.ext');
  writeFileSync(
    extFile,
    ['subjectAltName = IP:127.0.0.1,DNS:localhost', 'extendedKeyUsage = serverAuth'].join('\n') + '\n',
  );
  openssl([
    'x509', '-req', '-in', leafCsr, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', leafCert, '-days', String(LEAF_DAYS),
    '-sha256', '-extfile', extFile,
  ]);

  mkdirSync(outDir, { recursive: true });
  // Commit only what's needed: the CA cert (baked into the container trust
  // store) and the leaf cert+key (served by the mock). The CA private key is
  // NOT persisted — regeneration mints a fresh chain, so keeping it would only
  // add a needless private key to the repo.
  copyFileSync(caCert, join(outDir, 'mockCA.pem'));
  copyFileSync(leafCert, join(outDir, 'mockServer.pem'));
  copyFileSync(leafKey, join(outDir, 'mockServer.key'));

  console.log(`Wrote mock CA cert + 127.0.0.1 leaf cert/key to ${outDir}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
