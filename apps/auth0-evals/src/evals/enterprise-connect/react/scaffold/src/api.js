// Barkbook's existing sign-in, backed by its own API and session cookie.

export async function signInWithPassword(email, password) {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error('Invalid email or password.');
  return response.json();
}

export async function fetchCurrentUser() {
  const response = await fetch('/api/session', { credentials: 'include' });
  return response.ok ? response.json() : null;
}

export async function signOut() {
  const response = await fetch('/api/session', { method: 'DELETE', credentials: 'include' });
  if (!response.ok) throw new Error('Sign out failed.');
}
