import { randomBytes } from 'node:crypto';

/** Returns a cryptographically random 16-character hex session ID. */
export function makeSessionId(): string {
  return randomBytes(8).toString('hex');
}
