/**
 * Path normalization + route matching for the mock HTTP runtime.
 *
 * The auth0 CLI issues requests to `https://<domain>/api/v2/<path>`. The server
 * receives the request path (`/api/v2/<path>?<query>`); normalization collapses
 * every incoming form to the bare `<path>` a manifest route is written against.
 */

// Normalize a request path so it matches a manifest route regardless of the
// leading slash, `api/v2/` prefix, or query string.
export function normalizePath(raw: string, stripPrefixes: string[]): string {
  let p = raw.replace(/^https?:\/\/[^/]*\//, ''); // scheme + host (defensive)
  p = p.replace(/[?#].*$/, ''); // query string / fragment
  p = p.replace(/^\/+/, ''); // leading slash(es)
  for (const prefix of stripPrefixes) {
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  return p.replace(/\/+$/, ''); // trailing slash(es)
}

// Pattern: "<METHOD> <path>", where * matches exactly one path segment.
export function routeMatches(pattern: string, method: string, path: string): boolean {
  const sp = pattern.indexOf(' ');
  if (sp === -1) return false;
  const pMethod = pattern.slice(0, sp).toLowerCase();
  const pPath = normalizePath(pattern.slice(sp + 1), []);
  if (pMethod !== method.toLowerCase()) return false;
  if (!pPath.includes('*')) return pPath === path;
  // Build a regex: escape everything, replace \* with a single-segment matcher.
  const escaped = pPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`).test(path);
}
