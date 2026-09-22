import { auth0 } from '../lib/auth0';

export default async function Home() {
  const session = await auth0.getSession();

  return (
    <main>
      <h1>My App</h1>
      {session ? (
        <>
          <p>Welcome, {session.user.name}</p>
          <a href="/dashboard">Go to Dashboard</a>
          <br />
          <a href="/auth/logout">Log Out</a>
        </>
      ) : (
        <a href="/auth/login">Log In</a>
      )}
    </main>
  );
}
