export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function signInPage({ email = '', error }: { email?: string; error?: string }): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sign in · Barkbook</title></head>
  <body>
    <h1>Sign in to Barkbook</h1>
    ${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
    <form method="POST" action="/signin">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="${escapeHtml(email)}" required />
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`;
}

export function dashboardPage({ name, email }: { name: string; email: string }): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Dashboard · Barkbook</title></head>
  <body>
    <h1>Welcome, ${escapeHtml(name)}</h1>
    <p>${escapeHtml(email)}</p>
    <a href="/signout">Sign out</a>
  </body>
</html>`;
}
