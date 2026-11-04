import { Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard.jsx';
import Home from './Home.jsx';
import SignIn from './SignIn.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
