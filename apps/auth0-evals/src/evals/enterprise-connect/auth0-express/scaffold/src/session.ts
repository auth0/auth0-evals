import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface AppUser {
  id: string;
  email: string;
  name: string;
}

const COOKIE_NAME = 'barkbook_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function sign(body: string): string {
  return createHmac('sha256', process.env.APP_SESSION_SECRET as string)
    .update(body)
    .digest('base64url');
}

// Barkbook's own session: a signed "<body>.<signature>" cookie holding the user.
export function createSession(response: Response, user: AppUser): void {
  const body = Buffer.from(JSON.stringify(user)).toString('base64url');
  response.cookie(COOKIE_NAME, `${body}.${sign(body)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}

export function readSession(request: Request): AppUser | null {
  const raw: string | undefined = request.cookies?.[COOKIE_NAME];
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

export function clearSession(response: Response): void {
  response.clearCookie(COOKIE_NAME, { path: '/' });
}

export function requireSession(request: Request, response: Response, next: NextFunction): void {
  const user = readSession(request);
  if (!user) {
    response.redirect('/signin');
    return;
  }
  response.locals.user = user;
  next();
}
