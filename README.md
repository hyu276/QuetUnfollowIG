# QuetUnfollowIG

Local-first Instagram follower/following snapshot tracker.

This project is a Chrome/Chromium Manifest V3 extension with a full dashboard. It reads follower/following lists from the Instagram account already logged in on `instagram.com`, stores snapshots only in `chrome.storage.local`, and compares later crawls against the first baseline or the immediately previous snapshot.

## What it shows

- Lost followers: people present in the baseline/previous Followers list but absent now.
- You unfollowed: people present in the baseline/previous Following list but absent now.
- New followers.
- Newly followed accounts.
- Snapshot history, search, baseline reset, JSON backup export/import.

Comparisons use Instagram numeric user IDs when available, so username changes do not create false positives. A missing account can also mean deactivation, deletion, blocking, or an Instagram-side data inconsistency; the app therefore reports observed list differences rather than claiming intent.

## Privacy

- No password prompt.
- No external backend.
- No analytics.
- No follower/following data sent off-device.
- No follow/unfollow automation.
- The extension only sends GET requests to `https://www.instagram.com/` while you are already logged in.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome/Edge/Brave.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. Open Instagram in the same browser and make sure you are logged in.
6. Click the extension and choose **Open Dashboard**.
7. Click **Crawl now**. The first successful crawl becomes the baseline automatically.

## Notes

Instagram's internal web endpoints are undocumented and can change without notice. If Instagram changes the endpoint shape or rate-limits the session, the crawler may need an update. Use a conservative crawl cadence.

This project is not affiliated with Instagram or Meta.
