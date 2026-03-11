import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// TODO: Wrap App with Auth0Provider using domain and clientId

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
