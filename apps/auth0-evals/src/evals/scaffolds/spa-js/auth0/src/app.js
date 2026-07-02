import { createAuth0Client } from '@auth0/auth0-spa-js';

const domain = 'dev-barkbook.us.auth0.com';
const clientId = 'barkbook_client_abc123xyz';
const audience = 'https://api.barkbook.com';

let auth0Client = null;

async function initAuth0() {
  auth0Client = await createAuth0Client({
    domain,
    clientId,
    authorizationParams: {
      audience,
    },
  });

  const query = window.location.search;
  if (query.includes('code=') && query.includes('state=')) {
    await auth0Client.handleRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  await updateUI();
}

async function updateUI() {
  const isAuthenticated = await auth0Client.isAuthenticated();

  const loginSection = document.getElementById('login-section');
  const profileSection = document.getElementById('profile-section');

  if (isAuthenticated) {
    const user = await auth0Client.getUser();
    document.getElementById('user-name').textContent = `Name: ${user.name}`;
    document.getElementById('user-email').textContent = `Email: ${user.email}`;
    loginSection.style.display = 'none';
    profileSection.style.display = 'block';
  } else {
    loginSection.style.display = 'block';
    profileSection.style.display = 'none';
  }
}

async function fetchApiData() {
  const accessToken = await auth0Client.getTokenSilently({
    authorizationParams: { audience },
  });

  const response = await fetch('https://api.barkbook.com/data', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

document.getElementById('login-btn').addEventListener('click', async () => {
  await auth0Client.loginWithRedirect({
    authorizationParams: { redirect_uri: window.location.origin },
  });
});

document.getElementById('logout-btn').addEventListener('click', () => {
  auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
});

document.getElementById('call-api-btn').addEventListener('click', async () => {
  try {
    const data = await fetchApiData();
    console.log('API response:', data);
  } catch (err) {
    console.error('API call failed:', err);
  }
});

initAuth0();
