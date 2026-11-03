import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function Dashboard() {
  const user = await getSession();

  if (!user) {
    redirect('/signin');
  }

  return (
    <main>
      <h1>Welcome, {user.name}</h1>
      <p>{user.email}</p>
      <a href="/api/signout">Sign out</a>
    </main>
  );
}
