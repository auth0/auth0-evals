import { scryptSync, timingSafeEqual } from 'node:crypto';
import type { AppUser } from './session.js';

interface StoredUser extends AppUser {
  salt: string;
  passwordHash: string;
}

// Demo user store; in production this is Barkbook's user database.
const users: StoredUser[] = [
  {
    id: 'usr_owner',
    email: 'owner@barkbook.dev',
    name: 'Barkbook Owner',
    salt: 'barkbook-demo-salt',
    passwordHash: '6d60b3acdcce30cb7d9c0cbc3e550ca138a24d31984f76943d6a129ad6336095',
  },
];

export function verifyPassword(email: string, password: string): AppUser | null {
  const user = users.find((candidate) => candidate.email === email.trim().toLowerCase());
  if (!user) return null;

  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = scryptSync(password, user.salt, expected.length);
  if (!timingSafeEqual(expected, actual)) return null;

  return { id: user.id, email: user.email, name: user.name };
}
