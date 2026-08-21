const STORAGE_KEY = "quetUnfollowIGState";
const APP_ID = "936619743392459";
const MAX_HISTORY = 30;
const PAGE_SIZE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => 900 + Math.floor(Math.random() * 900);

function emptyState() {
  return { schemaVersion: 1, currentAccountId: null, accounts: {} };
}

async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || emptyState();
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function getLoggedInUserId() {
  const cookie = await chrome.cookies.get({
    url: "https://www.instagram.com/",
    name: "ds_user_id"
  });
  if (!cookie?.value) {
    throw new Error("Không tìm thấy phiên Instagram. Hãy đăng nhập instagram.com trong cùng trình duyệt rồi thử lại.");
  }
  return String(cookie.value);
}

function normalizeUser(user) {
  return {
    id: String(user.pk ?? user.id ?? user.pk_id ?? ""),
    username: user.username || "",
    fullName: user.full_name || "",
    isPrivate: Boolean(user.is_private),
    isVerified: Boolean(user.is_verified)
  };
}

function dedupeUsers(users) {
  const map = new Map();
  for (const raw of users) {
    const user = normalizeUser(raw);
    const key = user.id || `username:${user.username.toLowerCase()}`;
    if (!key || key === "username:") continue;
    map.set(key, user);
  }
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username));
}

async function emitProgress(kind, loaded, page) {
  try {
    await chrome.runtime.sendMessage({
      type: "CRAWL_PROGRESS",
      payload: { kind, loaded, page }
    });
  } catch (_) {
    // Dashboard/popup may be closed. Crawling should continue.
  }
}

async function fetchRelationshipList(userId, kind) {
  const all = [];
  let nextMaxId = "";
  let page = 0;

  do {
    page += 1;
    const params = new URLSearchParams({
      count: String(PAGE_SIZE),
      search_surface: "follow_list_page"
    });
    if (nextMaxId) params.set("max_id", nextMaxId);

    const response = await fetch(
      `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/${kind}/?${params.toString()}`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          "X-IG-App-ID": APP_ID,
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Instagram từ chối phiên đăng nhập. Hãy mở instagram.com, tải lại trang và thử lại.");
      }
      if (response.status === 429) {
        throw new Error("Instagram đang rate-limit tài khoản này. Không nên crawl tiếp ngay lúc này.");
      }
      throw new Error(`Instagram API trả về HTTP ${response.status}.`);
    }

    const data = await response.json();
    if (data?.status && data.status !== "ok") {
      throw new Error(`Instagram API trả về trạng thái: ${data.status}`);
    }

    const users = Array.isArray(data?.users) ? data.users : [];
    all.push(...users);
    await emitProgress(kind, all.length, page);

    nextMaxId = data?.next_max_id ? String(data.next_max_id) : "";
    if (nextMaxId) await sleep(jitter());
  } while (nextMaxId);

  return dedupeUsers(all);
}

async function crawlNow() {
  const userId = await getLoggedInUserId();
  await emitProgress("followers", 0, 0);
  const followers = await fetchRelationshipList(userId, "followers");
  await sleep(jitter());
  await emitProgress("following", 0, 0);
  const following = await fetchRelationshipList(userId, "following");

  const snapshot = {
    id: crypto.randomUUID(),
    accountId: userId,
    crawledAt: new Date().toISOString(),
    followers,
    following,
    counts: { followers: followers.length, following: following.length }
  };

  const state = await getState();
  state.currentAccountId = userId;
  const account = state.accounts[userId] || {
    accountId: userId,
    baseline: null,
    snapshots: []
  };

  if (!account.baseline) account.baseline = snapshot;
  account.snapshots.push(snapshot);
  if (account.snapshots.length > MAX_HISTORY) {
    account.snapshots = account.snapshots.slice(-MAX_HISTORY);
  }
  state.accounts[userId] = account;
  await setState(state);

  return {
    userId,
    snapshot,
    isFirstSnapshot: account.snapshots.length === 1,
    baselineId: account.baseline.id
  };
}

async function status() {
  let loggedInUserId = null;
  try {
    loggedInUserId = await getLoggedInUserId();
  } catch (_) {
    // Keep status readable even when logged out.
  }
  const state = await getState();
  return { loggedInUserId, state };
}

async function resetBaseline() {
  const userId = await getLoggedInUserId();
  const state = await getState();
  const account = state.accounts[userId];
  const latest = account?.snapshots?.at(-1);
  if (!latest) throw new Error("Chưa có snapshot nào để đặt làm baseline.");
  account.baseline = latest;
  await setState(state);
  return { baselineId: latest.id, crawledAt: latest.crawledAt };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;

  const handlers = {
    GET_STATUS: status,
    CRAWL_NOW: crawlNow,
    RESET_BASELINE: resetBaseline
  };

  const handler = handlers[message.type];
  if (!handler) return false;

  handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});
