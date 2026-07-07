import { describe, it, expect } from 'vitest';
import { normalizePath, routeMatches } from '../../src/mock/matcher.js';

describe('normalizePath', () => {
  const strip = ['api/v2/'];
  it('leaves a bare path unchanged', () => {
    expect(normalizePath('guardian/factors/otp', strip)).toBe('guardian/factors/otp');
  });
  it('strips a leading slash', () => {
    expect(normalizePath('/guardian/policies', strip)).toBe('guardian/policies');
  });
  it('strips a host-less /api/v2/ prefix', () => {
    expect(normalizePath('/api/v2/actions', strip)).toBe('actions');
  });
  it('strips scheme+host and api/v2', () => {
    expect(normalizePath('https://t.us.auth0.com/api/v2/guardian/factors/otp', strip))
      .toBe('guardian/factors/otp');
  });
});

describe('routeMatches', () => {
  it('matches an exact method+path', () => {
    expect(routeMatches('POST actions', 'post', 'actions')).toBe(true);
  });
  it('is method-insensitive on the pattern', () => {
    expect(routeMatches('post actions', 'POST', 'actions')).toBe(true);
  });
  it('matches a single-segment wildcard', () => {
    expect(routeMatches('POST actions/*/deploy', 'post', 'actions/act_1/deploy')).toBe(true);
  });
  it('does not let * span multiple segments', () => {
    expect(routeMatches('POST actions/*/deploy', 'post', 'actions/a/b/deploy')).toBe(false);
  });
  it('rejects a different path', () => {
    expect(routeMatches('GET guardian/policies', 'get', 'guardian/factors')).toBe(false);
  });
});
