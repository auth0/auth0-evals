// Barkbook's existing email + password sign-in. `?email=` pre-fills the form.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email = '', error } = await searchParams;

  return (
    <main>
      <h1>Sign in to Barkbook</h1>
      {error ? <p role="alert">Invalid email or password.</p> : null}
      <form method="POST" action="/api/signin">
        <label htmlFor="email">Email</label>
        <input type="email" id="email" name="email" defaultValue={email} required />
        <label htmlFor="password">Password</label>
        <input type="password" id="password" name="password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
