import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main>
      <h1>Barkbook</h1>
      <Link to="/signin">Sign in</Link> · <Link to="/dashboard">Dashboard</Link>
    </main>
  );
}
