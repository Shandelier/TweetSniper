## Product Requirements Document

### Chrome / Opera Extension — “Tweet Heat Map”

---

### 1. Context & Goal

Power-users want to **quickly spot unusually popular tweets and fresh “about-to-go-viral” posts** while they browse any part of Twitter/X (home timeline, profiles, replies, search results, thread detail).
This extension unobtrusively **tints each tweet with a colored right-border based on its public view-count** and adds a 🔥 emoji to very recent tweets. A badge-popup lets the user turn the effect on/off and (later) tweak thresholds & colors.

---

### 2. User Stories

| ID | As a …                                | I want …                                                | So that …                                      |
| -- | ------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| U1 | power-user scrolling any Twitter page | tweets to be visually coded by popularity               | I can spot high-quality / outlier content fast |
| U2 | the same user                         | a 🔥 next to the timestamp if the tweet is < 30 min old | I notice fresh posts likely to rise            |
| U3 | the same user                         | a quick toggle in the extension badge                   | I can disable coloring when I don’t need it    |

---

### 3. Functional Requirements

1. **View-count parsing**

   * Works on every tweet that exposes the public “<number> Views” element.
   * Accepts formats: `1,234`, `5.6 K`, `1.2 M`.
   * Normalises to an integer for comparison.

2. **Color thresholds (v1 hard-coded, easily extendable)**

   | Bucket | Range (inclusive) | CSS class | Default border-color<sup>†</sup> |
   | ------ | ----------------- | --------- | -------------------------------- |
   | A      | 0 – 1 000         | `views-0` | none (transparent)               |
   | B      | 1 001 – 10 000    | `views-1` | **#B4C6FF** (soft blue)          |
   | C      | 10 001 – 50 000   | `views-2` | **#BDF4C4** (soft green)         |
   | D      | 50 001 – 250 000  | `views-3` | **#FFC2C2** (soft red)           |

   <sup>† Colors sampled from the reference screenshot and tweaked for WCAG AA contrast on white backgrounds.</sup>

   * **Extensibility:** thresholds + colors live in one ordered JSON map, so adding buckets = adding one entry.

3. **🔥 emoji rule**

   * Compare `<time datetime="…">` to `Date.now()`.
   * If tweet age ≤ 30 min and emoji is not already present, prepend “🔥 ”.

4. **Page coverage**

   * Home timeline, lists, profile timelines, thread detail view, search result timelines, replies in modal or side-pane.
   * Operates after infinite scrolling and after the user expands hidden replies.

5. **Toggle UI**

   * Clicking the extension badge opens a 160 × 200 px HTML popup with:

     * **On/off switch** (state stored in `chrome.storage.sync` as `{enabled: boolean}`)
     * Placeholder section “Configure thresholds (coming soon)”
   * Content script must respect `enabled` flag immediately (listen to storage changes).

---

### 4. Non-Functional Requirements

| Area              | Requirement                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| **Performance**   | DOM mutations under 1 ms per tweet; style changes batched to avoid reflow.                                   |
| **Memory**        | Single MutationObserver instance; disconnect on page unload.                                                 |
| **Compatibility** | Manifest V3; tested on Opera (Blink 120+), Chrome, Brave, Edge.                                              |
| **Security**      | No remote code; permissions limited to `activeTab`, `scripting`, `storage`.                                  |
| **Accessibility** | Do not remove Twitter native focus styles; maintain color contrast ≥ 3:1 for the border-stripe.              |
| **I18n**          | Works regardless of UI language—detect view-count by `aria-label$="Views"` attribute, which remains English. |

---

### 5. Architecture & Technical Decisions

| Concern          | Decision                                                                                                       | Rationale                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Manifest         | **v3**                                                                                                         | Required by Chrome 120+, Opera 95+.                          |
| Script type      | **Content script** (`document_idle`)                                                                           | Direct access to tweet DOM; no background round-trip.        |
| Tweet discovery  | `article[data-testid="tweet"]`                                                                                 | Stable selector across new/old Twitter UI.                   |
| Dynamic loading  | **MutationObserver** on `main` element                                                                         | Tweets load via React/GraphQL; observer catches added nodes. |
| Stylistic change | Add `<style id="thm-styles">` with `.views-N` classes; content script toggles the class on tweet root article. | Decouples logic from CSS values, cheap repaints.             |
| State & options  | `chrome.storage.sync` (key: `"thm-settings"`)                                                                  | Syncs across browsers/logins for power-users.                |
| Build tooling    | **TypeScript + Vite**                                                                                          | Fast HMR during dev; one-command production build.           |
| Lint/test        | ESLint (Airbnb), Prettier, Jest + jsdom for parser utilities                                                   | Code quality & regression safety.                            |

---

### 6. Detailed Implementation Steps (suggested order)

1. **Repo bootstrap**

   ```bash
   mkdir tweet-heat-map && cd $_
   npm init -y
   npm i -D typescript vite eslint @typescript-eslint/parser prettier jest @types/jest ts-jest
   ```

   * `src/manifest.json` (MV3 template)
   * `src/content.ts`, `src/popup/popup.html|ts|css`, `src/options/…` (future)
   * `vite.config.ts` outputs into `dist/`.

2. **Manifest.json**

   ```jsonc
   {
     "manifest_version": 3,
     "name": "Tweet Heat Map",
     "version": "0.1.0",
     "description": "Color-codes tweets by view-count and flags fresh ones with 🔥.",
     "permissions": ["activeTab", "storage", "scripting"],
     "host_permissions": ["https://*.twitter.com/*", "https://*.x.com/*"],
     "action": { "default_popup": "popup/index.html", "default_icon": "icons/icon128.png" },
     "content_scripts": [{
       "matches": ["https://*.twitter.com/*", "https://*.x.com/*"],
       "js": ["content.js"],
       "run_at": "document_idle"
     }],
     "icons": { "128": "icons/icon128.png" }
   }
   ```

3. **CSS injection** (`content.ts`)

   ```ts
   const CSS = `
     .views-1 { border-right: 5px solid #B4C6FF !important; }
     .views-2 { border-right: 5px solid #BDF4C4 !important; }
     .views-3 { border-right: 5px solid #FFC2C2 !important; }
   `;
   ```

4. **Utility: `parseViews(text: string): number | null`**

   * Regex: `^([\d,.]+)\s*([KkMm])?$`
   * Convert K → ×1 000, M → ×1 000 000.

5. **Main logic**

   * `applyHeat(articleEl)`

     * locate span `[aria-label$=" Views"]` → extract number.
     * classify into bucket, add `.views-N`.
     * find `<time>`, compute age, prepend 🔥 if needed.
   * `scanExisting()` loops thru current tweets.
   * `observeNew()` sets `MutationObserver` with throttling (`requestIdleCallback`).
   * Respect `enabled` flag; when disabled, remove our CSS classes and 🔥.

6. **Popup UI** (`popup.tsx` optional)

   * Minimal HTML + vanilla JS/TS: a checkbox bound to `chrome.storage.sync`.
   * Icon changes: grey when disabled, colored when enabled (optional).

7. **Testing**

   * Unit tests for `parseViews`.
   * DOM test: inject mock tweet HTML and ensure classes added.

8. **Build & load**

   * `npm run build` → `dist/`
   * In Opera: `Develop > Extensions > Load unpacked` → select `dist`.

9. **Readme**

   * Quick install, dev watch (`vite --watch`), test instructions.

---

### 7. Acceptance Criteria Checklist

* [ ] Tweets across **all** Twitter page types get correct border within 500 ms of appearing.
* [ ] 🔥 emoji appears exactly once per tweet when age ≤ 30 min; disappears if page stays open beyond 30 min (re-evaluated periodically or on scroll).
* [ ] Badge toggle instantly disables/enables both borders and emoji without reload.
* [ ] No console errors, CSP violations, or layout breakage (scrolling still smooth).
* [ ] `npm run lint && npm test && npm run build` passes CI.
* [ ] Packaged `tweet-heat-map-0.1.0.zip` ready for Chrome Web Store upload.

---

### 8. Future Enhancements (out of scope v1)

1. Threshold & color editor in Options page.
2. Support for mobile Twitter PWA.
3. Highlight tweets from small-follower accounts that outperform baseline.
4. Analytics on user’s saved high-performers.

---

**That’s the spec.** Feel free to reach out if any selector becomes brittle—the architecture isolates selectors in one file for quick hot-fixes. Good luck and ship it!
