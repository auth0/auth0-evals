import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCurrentUser, signOut } from './api.js';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchCurrentUser().then((current) => {
      if (current) setUser(current);
      else navigate('/signin', { replace: true });
    });
  }, [navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/signin');
  };

  if (!user) return <p>Loading…</p>;

  return (
    <main>
      <h1>Welcome, {user.name}</h1>
      <p>{user.email}</p>
      <button onClick={handleSignOut}>Sign out</button>
    </main>
  );
}
