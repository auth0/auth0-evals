import { contains, matches, judge } from '../../../agent_eval/graders.js';

export function defineGraders() {
  return [
    contains('Auth0'),
    contains('import Auth0'),
    matches(String.raw`webAuth\s*\(\s*clientId\s*:.*domain\s*:`),
    contains('login('),
    contains('logout('),
    matches(String.raw`credentials\.(accessToken|idToken)`),
    contains('credentialsManager'),
    judge(
      'Does the solution correctly integrate Auth0 into a Swift iOS app using ' +
        'Auth0.webAuth(), login, logout, and credential management?',
      'ios',
    ),
  ];
}
