// Tweet Heat Map - Page hook (runs in the page's MAIN world at document_start)
//
// Twitter's own API responses already contain the exact followers_count for
// every user appearing in a timeline, tweet detail, profile or user list.
// We wrap fetch/XHR, mine those responses, and hand the counts to the
// content script via window.postMessage. No extra network requests are made.

import { extractFollowerCounts, isTwitterApiUrl } from './followerExtract.js';

export const FOLLOWER_MESSAGE_TYPE = 'THM_FOLLOWER_COUNTS';

function report(payload: unknown): void {
  try {
    const users = extractFollowerCounts(payload);
    if (users.length === 0) return;
    window.postMessage({ type: FOLLOWER_MESSAGE_TYPE, users }, window.location.origin);
  } catch {
    // Never let our mining break the page.
  }
}

function hookFetch(): void {
  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const result = originalFetch.call(this, input as RequestInfo, init);
    try {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url && isTwitterApiUrl(url)) {
        result
          .then(response => {
            if (!response.ok) return;
            response
              .clone()
              .json()
              .then(report)
              .catch(() => {});
          })
          .catch(() => {});
      }
    } catch {
      // Ignore — the original request result is returned untouched either way.
    }
    return result;
  };
}

function hookXhr(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const urls = new WeakMap<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    try {
      urls.set(this, typeof url === 'string' ? url : url.href);
    } catch {
      // ignore
    }
    // @ts-expect-error -- passing through the original arguments verbatim
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    const url = urls.get(this);
    if (url && isTwitterApiUrl(url)) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType !== '' && this.responseType !== 'text' && this.responseType !== 'json') return;
          const payload =
            this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          report(payload);
        } catch {
          // Non-JSON or unreadable response — ignore.
        }
      });
    }
    // @ts-expect-error -- passing through the original arguments verbatim
    return originalSend.call(this, ...args);
  };
}

hookFetch();
hookXhr();
