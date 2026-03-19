import { contains, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    contains('@auth0/auth0-react'),
    contains('Auth0Provider'),
    contains('useAuth0'),
    contains('loginWithRedirect'),
    contains('logout('),
    contains('isAuthenticated'),
    contains('user.name'),
    contains('user.email'),
    judge(
      'Does the solution correctly integrate Auth0 into a React app using ' +
        'Auth0Provider, useAuth0, login, logout, and display the user profile?',
      'react',
    ),
  ];
}
