# AGENTS.md — notes for future sessions

## What this repo is
Chrome/Opera extension ("Tweet Heat Map" / TweetSniper) that color-codes tweets on x.com by view count, flags fresh tweets with 🔥, highlights keywords, and shows follower-count badges under avatars. All logic lives in `src/content.ts` (~1100 lines); no background/service worker. Build with `npm run build` (esbuild via `build.js`), output in `dist/`.

## Follower badge architecture (since v1.3.0)
- Counts come from **network interception**: `src/pagehook.ts` runs in the page's MAIN world at `document_start`, wraps `fetch`/XHR, and mines every `/i/api/` JSON response for `(screen_name, followers_count)` pairs (`src/followerExtract.ts`, unit-tested). It posts them via `window.postMessage` (`THM_FOLLOWER_COUNTS`); `content.ts` (`setupFollowerFeed`) receives, updates the in-memory cache, debounce-saves to `chrome.storage.local` (`ts-follower-cache`) and debounce-re-renders badges. No extra requests to Twitter; counts are exact, not "12.3K" approximations.
- Older hover-card/profile-DOM scraping was removed in v1.3.0 — it caused wrong counts (hover race attributed one user's count to another, cache never expired or self-corrected). Don't reintroduce it.
- Cache is pruned on save: entries >30 days dropped, capped at 3000 newest.
- Badge → handle mapping prefers `data-testid="UserAvatar-Container-<handle>"` on the avatar (reliable for quoted tweets/user cells), falls back to the article's `/status/` link.
- GraphQL user shape varies: sometimes `{screen_name, followers_count}` flat, sometimes `core.screen_name` + `legacy.followers_count`. `followerExtract.ts` handles both; if badges ever stop appearing, check whether X moved these fields again.
- `world: "MAIN"` in manifest content_scripts needs Chrome 111+.

## Other gotchas
- `build.js` **generates its own manifest inline** — `src/manifest.json` is duplicated there and NOT copied to dist. Any manifest change must be made in BOTH places (and version also in package.json).
- `npx tsc --noEmit` has ~47 pre-existing errors in `explodingtopics.ts`/`trustmrr.ts` (script-scope redeclarations across files). Not a regression signal; use `npm run lint` + `npm test` instead.
- MutationObserver on `<main>` runs with `attributes: true` + subtree — very hot path; `applyHeat` itself mutates classes, which re-triggers the observer. Be careful adding work there.
- Twitter rewrites classes on hover, so heat classes go on the article's **parent** div (`getTargetContainer`), not the article.
- `parseCount` handles "1,234" / "5.6K" / "1.2M" formats; K/M values are approximations by nature.
- "New posts" pill and ad detection still match **English UI strings only** ("new posts", "Ad", "Promoted") — break on localized X UI.

## User preferences (Karol)
- Explain at behavior/UX level, not implementation detail, unless asked. Blunt, short answers.
- Speaks Polish; team/client-facing text in English.
