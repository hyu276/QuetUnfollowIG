# QuetUnfollowIG

Local-first Instagram follower/following snapshot tracker with a Next.js live validation console.

## Live deployment

Production test console: https://quet-unfollow-ig.vercel.app

The repository contains two surfaces that use the same crawler:

1. A Chrome/Chromium Manifest V3 extension that uses the Instagram session already logged in on `instagram.com`.
2. A Next.js website that acts as a realtime control and validation console. It sends commands to the extension through a paired browser bridge and never receives the Instagram cookie itself.

## v1.2: crawl any session-visible account

The crawler is no longer limited to the logged-in account. Enter a target username, `@username`, or Instagram profile URL and the extension will resolve that profile to its numeric Instagram user ID, then request that target's Followers and Following lists with the current browser session.

Supported cases:

- Your own logged-in account: leave Target blank.
- Public accounts whose follower/following lists Instagram allows the session to open.
- Private accounts when the current logged-in Instagram session has permission to view those lists, for example an accepted follower relationship. Mutual following is not hard-coded as a requirement; actual visibility under the current Instagram session is the authority.

Not supported:

- Bypassing a private profile that the current session cannot see.
- Using somebody else's cookie/session.
- Circumventing Instagram access controls.

If Instagram itself refuses the target list for the current session, the crawler returns an access error instead of treating the account as an empty list.

## Target isolation

Snapshots are keyed by both the logged-in viewer account and target account:

`viewerInstagramId:targetInstagramId`

This prevents data from being mixed when two different logged-in Instagram accounts have different visibility into the same private target.

Each target gets its own:

- baseline;
- snapshot history;
- Followers/Following arrays;
- lost followers;
- accounts the target unfollowed;
- new followers;
- new following accounts.

Self-account snapshots are also kept in the original `accounts` store for backwards compatibility with the original extension dashboard.

## Target resolution

Instagram's `web_profile_info` endpoint is currently brittle and may return an account-specific HTTP 400 even with a valid session. The extension therefore uses a fallback chain:

1. `/api/v1/users/web_profile_info/?username=...`
2. `/api/v1/users/{username}/usernameinfo_stream/`
3. `/api/v1/feed/user/{username}/username/?count=1`

The live console displays which resolver succeeded.

## Architecture

A normal hosted website cannot directly reuse the authenticated Instagram session from another tab because browser origin isolation prevents one site from reading another site's cookies/session. Privileged GET requests therefore remain inside the extension.

Data flow:

`Next.js page -> window.postMessage -> web-bridge.js -> extension service worker -> instagram.com -> chrome.storage.local -> paired response -> Next.js UI`

There is no Next.js API route for Instagram data and no follower/following payload is POSTed to Vercel.

## What the live website validates

For the selected target the Next.js console shows:

- extension bridge status;
- logged-in viewer Instagram ID;
- target username and numeric ID;
- public/private status;
- whether the resolver reports the viewer follows the target;
- resolver used;
- profile follower/following counts when available;
- realtime Followers/Following page number;
- accounts received after each page;
- per-page latency;
- `Next page = yes/no`;
- total crawl duration;
- duplicate-ID checks;
- count-vs-array integrity checks;
- profile-count-vs-crawled-count checks when profile counts are available;
- baseline-to-latest differences;
- target-specific snapshot history;
- raw sample users with numeric Instagram IDs.

A profile-count mismatch is surfaced as a warning because it can indicate an incomplete crawl, a changing list during the run, or an Instagram-side count inconsistency.

## Privacy and permissions

- No password prompt.
- No analytics.
- No remote follower database.
- No follow/unfollow automation.
- Instagram data requests are GET-only.
- Instagram cookies stay inside the extension context.
- Snapshot data stays in `chrome.storage.local`.
- The web bridge requires a random pairing key.
- The website receives only the selected target's baseline/latest arrays and lightweight history summaries.

Do not share the pairing key. If exposed, click **Tạo pairing key mới** in the extension popup.

## Install / update the extension

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. After every repository update, click **Reload** on the QuetUnfollowIG extension card.
6. Make sure Instagram is logged in in that same browser.

The current extension version is **1.2.0**.

## Test a target on the production website

1. Reload extension v1.2.0 in `chrome://extensions`.
2. Open `https://quet-unfollow-ig.vercel.app` in the same Chromium browser.
3. Copy the pairing key from the extension popup.
4. Paste the pairing key into the website.
5. Enter a target username. Leave blank to test your own account.
6. Click **Resolve + Connect**.
7. Confirm the target numeric ID and visibility metadata.
8. Click **Run live crawl**.
9. Watch Followers then Following pagination in realtime.
10. The final page for each list should show **Next page = no**.
11. Review Snapshot integrity and any profile-count mismatch warning.

For a private-account test, first verify manually that the same Instagram browser session can open the target's Followers/Following UI. The extension intentionally does not bypass Instagram's access controls.

## Controlled diff test

1. Crawl target A to create its baseline.
2. Change one known relationship on target A where you can observe the result.
3. Crawl target A again.
4. The baseline diff should identify the correct numeric user ID in the expected category.
5. Switch to target B and crawl it. Target B must have an independent baseline/history.
6. Switch Instagram viewer accounts and repeat target A. The second viewer must create a separate tracker.

## Local Next.js development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and use the same pairing workflow.

## Rate limits and endpoint stability

Instagram's internal web endpoints are undocumented and can change without notice. Relationship lists currently paginate via `next_max_id`; the crawler adds randomized delays between pages. HTTP 429 is treated as rate limiting, and access failures for a non-self target are surfaced as target/session visibility errors.

Do not repeatedly hammer the crawl button. Use a conservative testing cadence.

This project is not affiliated with Instagram or Meta.
