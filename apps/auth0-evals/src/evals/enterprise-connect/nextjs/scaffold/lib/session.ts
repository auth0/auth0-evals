import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

export interface AppUser {
  id: string;
  email: string;
  name: string;
}

const COOKIE_NAME = 'barkbook_session';
const MAX_AGE_SECONDS = 8 * 60 * 60;

function sign(body: string): string {
  return createHmac('sha256', process.env.APP_SESSION_SECRET as string)
    .update(body)
    .digest('base64url');
}

// Barkbook's own session: a signed "<body>.<signature>" cookie holding the user.
export function createSession(response: NextResponse, user: AppUser): void {
  const body = Buffer.from(JSON.stringify(user)).toString('base64url');
  response.cookies.set(COOKIE_NAME, `${body}.${sign(body)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<AppUser | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  const [body, signature] = raw?.split('.') ?? [];
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as AppUser;
  } catch {
    return null;
  }
}

export function clearSession(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}
