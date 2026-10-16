import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSession } from '@/lib/session';
import { verifyPassword } from '@/lib/users';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const user = verifyPassword(String(form.get('email') ?? ''), String(form.get('password') ?? ''));

  if (!user) {
    return NextResponse.redirect(new URL('/signin?error=invalid', request.url), 303);
  }

  const response = NextResponse.redirect(new URL('/dashboard', request.url), 303);
  createSession(response, user);
  return response;
}
