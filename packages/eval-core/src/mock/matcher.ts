// Normalize an API path so every form agents emit collapses to one route:
// full URL, host-less /api/v2/..., leading slash, or bare path.
export function normalizePath(raw: string, stripPrefixes: string[]): string {
  let p = raw.replace(/^https?:\/\/[^/]*\//, ''); // scheme + host
  p = p.replace(/^\/+/, ''); // leading slash(es)
  for (const prefix of stripPrefixes) {
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  return p;
}

// Pattern: "<METHOD> <path>", where * matches exactly one path segment.
export function routeMatches(pattern: string, method: string, path: string): boolean {
  const sp = pattern.indexOf(' ');
  if (sp === -1) return false;
  const pMethod = pattern.slice(0, sp).toLowerCase();
  const pPath = pattern.slice(sp + 1);
  if (pMethod !== method.toLowerCase()) return false;
  if (!pPath.includes('*')) return pPath === path;
  // Build a regex: escape everything, replace \* with a single-segment matcher.
  const escaped = pPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+');
  return new RegExp(`^${escaped}$`).test(path);
}
