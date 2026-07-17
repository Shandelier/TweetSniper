// Shared logic for extracting follower counts from Twitter/X API responses.
// Used by the page hook (MAIN world) that intercepts fetch/XHR responses.

export interface FollowerInfo {
  handle: string;
  count: number;
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_DEPTH = 30;

/**
 * Check whether a request URL is a Twitter/X API endpoint whose response
 * may contain user objects (timelines, tweet detail, profiles, user lists).
 */
export function isTwitterApiUrl(url: string): boolean {
  return (
    url.includes('/i/api/') ||
    url.includes('api.twitter.com') ||
    url.includes('api.x.com')
  );
}

function pushUser(out: Map<string, number>, handle: unknown, count: unknown): void {
  if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) return;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return;
  out.set(handle.toLowerCase(), count);
}

function walk(node: unknown, out: Map<string, number>, depth: number): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;

  // Shape A: flat user object (legacy REST / older GraphQL "legacy" blocks)
  // { screen_name: "foo", followers_count: 123, ... }
  if ('followers_count' in obj) {
    pushUser(out, obj['screen_name'], obj['followers_count']);
  }

  // Shape B: GraphQL user result where the handle moved out of "legacy"
  // { core: { screen_name: "foo" }, legacy: { followers_count: 123 } }
  const legacy = obj['legacy'] as Record<string, unknown> | undefined;
  const core = obj['core'] as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === 'object' && 'followers_count' in legacy) {
    const handle = legacy['screen_name'] ?? (core && typeof core === 'object' ? core['screen_name'] : undefined);
    pushUser(out, handle, legacy['followers_count']);
  }

  for (const key of Object.keys(obj)) {
    walk(obj[key], out, depth + 1);
  }
}

/**
 * Walk an arbitrary API response payload and collect every
 * (screen_name, followers_count) pair found in it.
 */
export function extractFollowerCounts(payload: unknown): FollowerInfo[] {
  const out = new Map<string, number>();
  try {
    walk(payload, out, 0);
  } catch {
    // Defensive: malformed/unexpected payloads must never break the page.
  }
  return Array.from(out.entries()).map(([handle, count]) => ({ handle, count }));
}
