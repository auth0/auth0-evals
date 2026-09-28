import { redirect } from 'next/navigation';
import { auth0 } from '../../lib/auth0';

export default async function Dashboard() {
  const session = await auth0.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Welcome, {session.user.name}</p>
    </main>
  );
}
