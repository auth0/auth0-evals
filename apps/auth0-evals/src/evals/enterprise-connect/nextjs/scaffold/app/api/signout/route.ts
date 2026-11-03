import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clearSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/signin', request.url));
  clearSession(response);
  return response;
}
