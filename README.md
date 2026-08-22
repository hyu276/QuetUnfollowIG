# QuetUnfollowIG

Cloud-backed Instagram Followers/Following change tracker with a Chrome/Chromium extension, a Next.js main site, and Supabase snapshot history.

Production: https://quet-unfollow-ig.vercel.app

## What it does

The extension uses the Instagram session already signed in on `instagram.com` to crawl relationship lists that the current session is allowed to see. Complete snapshots are uploaded to Supabase. The backend compares each target with its immediately previous complete snapshot and records:

- accounts that no longer follow the target;
- accounts newly following the target;
- accounts the target unfollowed;
- accounts the target newly followed.

The main site shows both the counts and the exact Instagram accounts in each change category.

A disappearance is an observed list difference, not proof of intent. Deactivation, deletion, blocking, visibility changes, or Instagram-side inconsistencies can also make an account disappear from a list.

## Architecture

A normal hosted website cannot reuse another origin's authenticated Instagram session. Instagram requests therefore remain inside the browser extension.

Data flow:

`Next.js main site -> paired web bridge -> MV3 service worker -> Instagram -> Supabase Edge Function -> PostgreSQL`

Important boundaries:

- Instagram cookies never go to the Next.js site or Supabase.
- The browser extension performs the Instagram GET requests.
- Supabase is the authoritative source for completed snapshot history and diffs.
- `chrome.storage.local` is only a compact cache in schema v4; it no longer keeps 30 full relationship arrays.
- The main site never receives the Cloud Workspace Key.

## Supported targets

Enter a username, `@username`, Instagram profile URL, or leave Target blank for the currently signed-in account.

The crawler can work with:

- your own signed-in account;
- public accounts whose relationship lists Instagram exposes to the current session;
- private accounts when the current signed-in session actually has permission to open those lists.

The extension does not bypass private-profile access controls and does not use another person's session.

## Cloud history and cross-device use

All devices that use the same Cloud Workspace Key share the same targets, completed runs, and diffs.

On the first device, the extension attempts to provision the workspace automatically. The generated Cloud Workspace Key stays inside extension storage and can be copied intentionally from the popup for another device.

On another device:

1. Install/reload the extension.
2. Open the extension popup.
3. Paste the Cloud Workspace Key from the first device.
4. Choose **Connect existing**.

Treat the Cloud Workspace Key as a secret. Losing it means a new device cannot authenticate to the existing cloud history.

## Pairing key vs Cloud Workspace Key

They are different credentials:

- **Pairing key**: authorizes the main site in the same browser to command the extension. Rotate it if it is exposed.
- **Cloud Workspace Key**: authenticates the extension to the shared Supabase workspace across devices. Do not paste it into the main site.

The web bridge only allows `GET_STATUS` and `CRAWL_NOW` and is restricted to the production aliases plus localhost development.

## Snapshot integrity

A crawl is not considered historical truth merely because Instagram returned some users.

A run becomes `complete` only when:

1. Followers pagination finishes.
2. Following pagination finishes.
3. Every crawled membership is uploaded to Supabase.
4. Supabase verifies uploaded counts exactly match crawler counts.
5. When Instagram exposes profile relationship counts, the crawl also passes a count-completeness tolerance check.

If upload is partial or the crawl count is materially inconsistent with an available expected count, the run is marked `failed` and is excluded from unfollow inference.

The backend orders runs by the time the relationship snapshot was captured (`captured_at`), not by upload completion time. This matters when different devices finish uploading in a different order.

## Main site modes

**Professional Mode OFF** is the default consumer view. It focuses on:

- target;
- Followers / Following;
- four relationship-change counts;
- the full list of accounts in each change category.

**Professional Mode ON** additionally shows technical telemetry, pagination, cloud validation, samples, viewer consistency, and history.

The mode preference is stored in the browser.

## Install / update extension

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository folder.
5. Whenever extension files change, click **Reload** on the QuetUnfollowIG extension card.
6. Make sure `instagram.com` is signed in in the same browser.
7. Open the extension popup and copy the Main Site pairing key.
8. Open https://quet-unfollow-ig.vercel.app and paste the pairing key.

Current extension version: **1.4.0**.

## Typical workflow

1. Paste the pairing key on the main site.
2. Enter a target or leave it blank for your own account.
3. Click **Connect**.
4. Click **Run crawl**.
5. The first successful run creates the cloud baseline for that target.
6. Run the same target again later.
7. Supabase compares it with the immediately previous complete run and the main site shows exactly which accounts changed.

Only one crawler may run at a time in an extension instance. A second request is rejected instead of running two overlapping Instagram crawls.

## Target resolution

For a non-self target, the extension currently tries multiple Instagram web endpoints because individual endpoints can be brittle:

1. `/api/v1/users/web_profile_info/?username=...`
2. `/api/v1/users/{username}/usernameinfo_stream/`
3. `/api/v1/feed/user/{username}/username/?count=1`

Instagram internal web endpoints are undocumented and may change without notice.

## Rate limits

The crawler adds randomized delay between pagination pages and treats HTTP 429 as rate limiting. Avoid repeatedly starting crawls in a short period.

A failed or incomplete run is not used as the previous-run reference for future diffs.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The extension manifest permits localhost for development.

Production build also runs syntax validation for the extension JavaScript before Next.js compilation:

```bash
npm run check:extension
npm run build
```

Top-level dependencies are pinned rather than using `latest` to reduce deployment drift.

## Supabase source

Database migrations are version-controlled in `supabase/migrations/` and the Edge Function source is in `supabase/functions/ig-cloud/index.ts`.

Crawler tables have RLS enabled and no client policies by design. Direct `anon` / `authenticated` table access is revoked; the Edge Function performs authorized operations with the service role after validating the Cloud Workspace Key.

## Privacy and limitations

- No Instagram password prompt.
- No Instagram password is stored.
- No Instagram cookie is uploaded to the website or cloud backend.
- The backend stores Instagram IDs, usernames, display names, relationship membership snapshots, crawl metadata, and computed changes.
- This project does not automatically follow or unfollow accounts.
- A list difference does not prove why the relationship changed.
- Private-account results can differ when different viewer accounts have different visibility; the backend records the viewer ID and the Professional UI warns when the viewer changed.

This project is unofficial and is not affiliated with Instagram or Meta.
