import { fetchCurrentUser, signInWithPassword, signOut } from './api.js';

// Views: / (home), /signin (Barkbook's existing email + password sign-in) and /dashboard.
const signInView = document.getElementById('signin');
const dashboardView = document.getElementById('dashboard');
const signInForm = document.getElementById('signin-form');
const signInError = document.getElementById('signin-error');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

function go(path) {
  window.location.assign(path);
}

function showSignIn() {
  // `?email=` pre-fills the form.
  emailInput.value = new URLSearchParams(window.location.search).get('email') ?? '';
  signInView.hidden = false;
}

async function showDashboard() {
  const user = await fetchCurrentUser();
  if (!user) return go('/signin');

  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-email').textContent = user.email;
  dashboardView.hidden = false;
}

signInForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await signInWithPassword(emailInput.value, passwordInput.value);
    go('/dashboard');
  } catch (err) {
    signInError.textContent = err.message;
    signInError.hidden = false;
  }
});

document.getElementById('signout').addEventListener('click', async () => {
  await signOut();
  go('/signin');
});

if (window.location.pathname === '/signin') {
  showSignIn();
} else if (window.location.pathname === '/dashboard') {
  showDashboard();
} else {
  document.getElementById('home').hidden = false;
}
