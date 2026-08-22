importScripts("cloud.js");

const STORAGE_KEY = "quetUnfollowIGState";
const PAIRING_KEY_STORAGE = "quetUnfollowIGPairingKey";
const APP_ID = "936619743392459";
const ASBD_ID = "198387";
const MAX_HISTORY = 30;
const LOCAL_SAMPLE_SIZE = 12;
const PAGE_SIZE = 100;
const MAX_RELATIONSHIP_PAGES = 1000;
const bridgePorts = new Set();

let activeCrawl = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => 900 + Math.floor(Math.random() * 900);

function emptyState() {
  return { schemaVersion: 4, currentAccountId: null, accounts: {}, targets: {} };
}

function compactSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    viewerAccountId: snapshot.viewerAccountId,
    accountId: snapshot.accountId,
    targetId: snapshot.targetId,
    targetUsername: snapshot.targetUsername,
    targetFullName: snapshot.targetFullName,
    targetIsPrivate: snapshot.targetIsPrivate,
    targetViewerFollows: snapshot.targetViewerFollows,
    resolver: snapshot.resolver,
    expectedCounts: snapshot.expectedCounts,
    crawledAt: snapshot.crawledAt,
    durationMs: snapshot.durationMs,
    followers: Array.isArray(snapshot.followers) ? snapshot.followers.slice(0, LOCAL_SAMPLE_SIZE) : [],
    following: Array.isArray(snapshot.following) ? snapshot.following.slice(0, LOCAL_SAMPLE_SIZE) : [],
    counts: snapshot.counts || {
      followers: Array.isArray(snapshot.followers) ? snapshot.followers.length : 0,
      following: Array.isArray(snapshot.following) ? snapshot.following.length : 0
    },
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.slice(0, 8) : [],
    cloudRunId: snapshot.cloudRunId || null,
    cloudDiffSummary: snapshot.cloudDiffSummary || null
  };
}

function compactTracker(tracker) {
  if (!tracker) return tracker;
  const snapshots = (tracker.snapshots || []).slice(-MAX_HISTORY).map(compactSnapshot).filter(Boolean);
  const baselineId = tracker.baseline?.id;
  const baseline = baselineId
    ? snapshots.find((snapshot) => snapshot.id === baselineId) || compactSnapshot(tracker.baseline)
    : snapshots[0] || null;
  return { ...tracker, baseline, snapshots };
}

async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] || emptyState();
  if (!state.accounts) state.accounts = {};
  if (!state.targets) state.targets = {};

  if (Number(state.schemaVersion || 0) < 4) {
    for (const [key, tracker] of Object.entries(state.targets)) state.targets[key] = compactTracker(tracker);
    for (const [key, account] of Object.entries(state.accounts)) state.accounts[key] = compactTracker(account);
    state.schemaVersion = 4;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  state.schemaVersion = 4;
  return state;
}

async function setState(state) {
  state.schemaVersion = 4;
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function makePairingKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getPairingKey() {
  const stored = await chrome.storage.local.get(PAIRING_KEY_STORAGE);
  if (stored[PAIRING_KEY_STORAGE]) return stored[PAIRING_KEY_STORAGE];
  const key = makePairingKey();
  await chrome.storage.local.set({ [PAIRING_KEY_STORAGE]: key });
  return key;
}

async function rotatePairingKey() {
  const key = makePairingKey();
  await chrome.storage.local.set({ [PAIRING_KEY_STORAGE]: key });
  return key;
}

async function assertPairingKey(key) {
  const expected = await getPairingKey();
  if (!key || key !== expected) throw new Error("Pairing key không hợp lệ.");
}

async function getLoggedInUserId() {
  const cookie = await chrome.cookies.get({ url: "https://www.instagram.com/", name: "ds_user_id" });
  if (!cookie?.value) throw new Error("Không tìm thấy phiên Instagram. Hãy đăng nhập instagram.com trong cùng trình duyệt rồi thử lại.");
  return String(cookie.value);
}

function normalizeUsername(input) {
  let value = String(input || "").trim();
  if (!value) return "";
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  value = value.split(/[/?#]/)[0];
  return value.replace(/^@/, "").trim().toLowerCase();
}

function normalizeUser(user) {
  return {
    id: String(user?.pk ?? user?.id ?? user?.pk_id ?? ""),
    username: String(user?.username || ""),
    fullName: user?.full_name || user?.fullName || "",
    isPrivate: Boolean(user?.is_private ?? user?.isPrivate),
    isVerified: Boolean(user?.is_verified ?? user?.isVerified)
  };
}

function numberOrNull(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function normalizeTargetProfile(user, requestedUsername) {
  const basic = normalizeUser(user || {});
  const friendship = user?.friendship_status || {};
  return {
    id: basic.id,
    username: basic.username || requestedUsername,
    fullName: basic.fullName,
    isPrivate: basic.isPrivate,
    isVerified: basic.isVerified,
    viewerFollows: Boolean(user?.followed_by_viewer ?? friendship.following ?? false),
    followsViewer: Boolean(user?.follows_viewer ?? friendship.followed_by ?? false),
    expectedFollowers: numberOrNull(user?.edge_followed_by?.count, user?.follower_count, user?.followers_count),
    expectedFollowing: numberOrNull(user?.edge_follow?.count, user?.following_count, user?.follow_count),
    resolver: "unknown"
  };
}

function findUserCandidate(payload, requestedUsername) {
  const normalized = normalizeUsername(requestedUsername);
  const obvious = [
    payload?.data?.user,
    payload?.user,
    payload?.items?.[0]?.user,
    payload?.items?.[0]?.owner,
    payload?.stream_rows?.[0]?.user
  ].filter(Boolean);

  for (const candidate of obvious) {
    if (candidate?.id || candidate?.pk || candidate?.pk_id) return candidate;
  }

  const queue = [{ value: payload, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value) || depth > 5) continue;
    seen.add(value);
    if ((value.id || value.pk || value.pk_id) && normalizeUsername(value.username) === normalized) return value;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function requestHeaders() {
  return {
    "X-IG-App-ID": APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "Accept": "application/json"
  };
}

async function fetchInstagramJson(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: requestHeaders()
  });
  let data = null;
  try { data = await response.json(); } catch (_) {}
  return { response, data };
}

async function resolveTargetProfile(input, viewerId) {
  const username = normalizeUsername(input);
  if (!username || username === "me" || username === "self") {
    return {
      id: String(viewerId), username: "", fullName: "", isPrivate: false, isVerified: false,
      viewerFollows: true, followsViewer: true, expectedFollowers: null, expectedFollowing: null,
      resolver: "session-self", isSelf: true
    };
  }

  const attempts = [
    { name: "web_profile_info", url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}` },
    { name: "usernameinfo_stream", url: `https://www.instagram.com/api/v1/users/${encodeURIComponent(username)}/usernameinfo_stream/` },
    { name: "feed_by_username", url: `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(username)}/username/?count=1` }
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const { response, data } = await fetchInstagramJson(attempt.url);
      if (!response.ok) { errors.push(`${attempt.name}: HTTP ${response.status}`); continue; }
      const candidate = findUserCandidate(data, username);
      if (!candidate) { errors.push(`${attempt.name}: no user payload`); continue; }
      const profile = normalizeTargetProfile(candidate, username);
      if (!profile.id) { errors.push(`${attempt.name}: no numeric id`); continue; }
      profile.resolver = attempt.name;
      profile.isSelf = profile.id === String(viewerId);
      return profile;
    } catch (error) {
      errors.push(`${attempt.name}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(`Không resolve được @${username}. Profile có thể không tồn tại, Instagram đang gate endpoint này, hoặc session hiện tại không nhìn thấy profile. ${errors.join(" · ")}`);
}

function broadcastProgress(payload) {
  for (const port of bridgePorts) {
    try { port.postMessage({ type: "CRAWL_PROGRESS", payload }); }
    catch (_) { bridgePorts.delete(port); }
  }
}

async function emitProgress(kind, loaded, page, startedAt, target, extra = {}) {
  const payload = {
    kind,
    loaded,
    page,
    target: { id: target.id, username: target.username, isPrivate: target.isPrivate },
    elapsedMs: Date.now() - startedAt,
    at: new Date().toISOString(),
    ...extra
  };
  broadcastProgress(payload);
  try { await chrome.runtime.sendMessage({ type: "CRAWL_PROGRESS", payload }); } catch (_) {}
}

function accessError(target, kind, status, detail = "") {
  const label = target.username ? `@${target.username}` : `ID ${target.id}`;
  if (!target.isSelf && (status === 400 || status === 403 || status === 404)) {
    const privateHint = target.isPrivate
      ? " Đây là private account; session Instagram hiện tại phải thực sự có quyền mở danh sách này trên Instagram."
      : " Danh sách có thể bị Instagram giới hạn cho session hiện tại.";
    return new Error(`Không thể đọc ${kind} của ${label} (HTTP ${status}).${privateHint}${detail ? ` ${detail}` : ""}`);
  }
  if (status === 401 || status === 403) return new Error("Instagram từ chối phiên đăng nhập. Hãy mở instagram.com, tải lại trang và thử lại.");
  if (status === 429) return new Error("Instagram đang rate-limit session này. Không nên crawl tiếp ngay lúc này.");
  return new Error(`Instagram API trả về HTTP ${status} khi đọc ${kind} của ${label}.${detail ? ` ${detail}` : ""}`);
}

async function fetchRelationshipList(target, kind, crawlStartedAt) {
  const usersById = new Map();
  const seenCursors = new Set();
  let nextMaxId = "";
  let page = 0;

  do {
    page += 1;
    if (page > MAX_RELATIONSHIP_PAGES) {
      throw new Error(`Pagination ${kind} vượt quá ${MAX_RELATIONSHIP_PAGES} pages. Run bị hủy để tránh vòng lặp API.`);
    }

    const pageStartedAt = performance.now();
    const params = new URLSearchParams({ count: String(PAGE_SIZE), search_surface: "follow_list_page" });
    if (nextMaxId) params.set("max_id", nextMaxId);

    const url = `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(target.id)}/${kind}/?${params.toString()}`;
    const { response, data } = await fetchInstagramJson(url);

    if (!response.ok) {
      const detail = data?.message ? String(data.message).slice(0, 180) : "";
      throw accessError(target, kind, response.status, detail);
    }
    if (data?.status && data.status !== "ok") {
      throw new Error(`Instagram trả về trạng thái ${data.status} khi đọc ${kind} của @${target.username || target.id}.`);
    }

    const rawUsers = Array.isArray(data?.users) ? data.users : [];
    for (const rawUser of rawUsers) {
      const user = normalizeUser(rawUser);
      if (!user.id || !/^\d+$/.test(user.id)) {
        throw new Error(`Instagram trả về một ${kind} entry không có stable numeric user ID. Run bị hủy để tránh false diff.`);
      }
      if (usersById.has(user.id)) {
        throw new Error(`Instagram pagination trả duplicate user ID ${user.id} trong ${kind}. List có thể đang biến động; run bị hủy để tránh false diff.`);
      }
      usersById.set(user.id, user);
    }

    const candidateNext = data?.next_max_id ? String(data.next_max_id) : "";
    if (candidateNext && seenCursors.has(candidateNext)) {
      throw new Error(`Instagram pagination lặp lại cursor trong ${kind}. Run bị hủy để tránh loop và snapshot thiếu.`);
    }
    if (candidateNext && rawUsers.length === 0) {
      throw new Error(`Instagram trả page rỗng nhưng vẫn có next cursor trong ${kind}. Run bị hủy vì pagination không nhất quán.`);
    }
    if (candidateNext) seenCursors.add(candidateNext);
    nextMaxId = candidateNext;

    await emitProgress(kind, usersById.size, page, crawlStartedAt, target, {
      pageLatencyMs: Math.round(performance.now() - pageStartedAt),
      hasNextPage: Boolean(nextMaxId)
    });
    if (nextMaxId) await sleep(jitter());
  } while (nextMaxId);

  return [...usersById.values()];
}

function trackerKey(viewerId, targetId) {
  return `${viewerId}:${targetId}`;
}

function makeWarnings(target, followers, following) {
  const warnings = [];
  if (target.expectedFollowers != null && followers.length !== target.expectedFollowers) warnings.push(`Followers crawl=${followers.length}, profile count=${target.expectedFollowers}.`);
  if (target.expectedFollowing != null && following.length !== target.expectedFollowing) warnings.push(`Following crawl=${following.length}, profile count=${target.expectedFollowing}.`);
  if (target.isPrivate && !target.isSelf && !target.viewerFollows) warnings.push("Target là private account và resolver không xác nhận viewer đang follow target; khả năng truy cập phụ thuộc session thực tế.");
  return warnings;
}

async function executeCrawl(options = {}) {
  const crawlStartedAt = Date.now();
  const viewerId = await getLoggedInUserId();
  await cloudRequireWorkspace();
  const target = await resolveTargetProfile(options?.targetUsername, viewerId);
  activeCrawl.target = target.username || target.id;

  await emitProgress("followers", 0, 0, crawlStartedAt, target, { hasNextPage: true });
  const followers = await fetchRelationshipList(target, "followers", crawlStartedAt);
  await sleep(jitter());
  await emitProgress("following", 0, 0, crawlStartedAt, target, { hasNextPage: true });
  const following = await fetchRelationshipList(target, "following", crawlStartedAt);

  const snapshot = {
    id: crypto.randomUUID(),
    viewerAccountId: viewerId,
    accountId: target.id,
    targetId: target.id,
    targetUsername: target.username,
    targetFullName: target.fullName,
    targetIsPrivate: target.isPrivate,
    targetViewerFollows: target.viewerFollows,
    resolver: target.resolver,
    expectedCounts: { followers: target.expectedFollowers, following: target.expectedFollowing },
    crawledAt: new Date().toISOString(),
    durationMs: Date.now() - crawlStartedAt,
    followers,
    following,
    counts: { followers: followers.length, following: following.length },
    warnings: makeWarnings(target, followers, following)
  };

  const cloud = await cloudSyncSnapshot(snapshot, target, viewerId, chrome.runtime.getManifest().version);
  snapshot.cloudRunId = cloud?.run?.id || null;
  snapshot.cloudDiffSummary = cloud?.diffSummary || null;

  const compact = compactSnapshot(snapshot);
  const state = await getState();
  state.currentAccountId = viewerId;
  const key = trackerKey(viewerId, target.id);
  const tracker = state.targets[key] || {
    viewerAccountId: viewerId,
    targetId: target.id,
    targetUsername: target.username,
    targetFullName: target.fullName,
    targetIsPrivate: target.isPrivate,
    baseline: null,
    snapshots: []
  };
  tracker.targetUsername = target.username || tracker.targetUsername;
  tracker.targetFullName = target.fullName || tracker.targetFullName;
  tracker.targetIsPrivate = target.isPrivate;
  if (!tracker.baseline) tracker.baseline = compact;
  tracker.snapshots.push(compact);
  if (tracker.snapshots.length > MAX_HISTORY) tracker.snapshots = tracker.snapshots.slice(-MAX_HISTORY);
  state.targets[key] = compactTracker(tracker);

  if (target.isSelf) {
    const account = state.accounts[viewerId] || { accountId: viewerId, baseline: null, snapshots: [] };
    if (!account.baseline) account.baseline = compact;
    account.snapshots.push(compact);
    if (account.snapshots.length > MAX_HISTORY) account.snapshots = account.snapshots.slice(-MAX_HISTORY);
    state.accounts[viewerId] = compactTracker(account);
  }

  await setState(state);
  return {
    viewerId,
    target,
    snapshot: compact,
    cloud,
    isFirstSnapshot: tracker.snapshots.length === 1,
    baselineId: tracker.baseline.id,
    trackerKey: key
  };
}

async function crawlNow(options = {}) {
  if (activeCrawl) {
    const target = activeCrawl.target ? ` cho ${activeCrawl.target}` : "";
    throw new Error(`Một crawl khác đang chạy${target}. Hãy chờ crawl hiện tại hoàn tất trước khi bắt đầu crawl mới.`);
  }

  const crawlId = crypto.randomUUID();
  activeCrawl = {
    id: crawlId,
    target: normalizeUsername(options?.targetUsername) || "current account",
    startedAt: new Date().toISOString()
  };
  try {
    return await executeCrawl(options);
  } finally {
    if (activeCrawl?.id === crawlId) activeCrawl = null;
  }
}

function summarizeTracker(tracker) {
  if (!tracker) return null;
  const latest = tracker.snapshots?.at(-1) || null;
  const history = (tracker.snapshots || []).map((snapshot) => ({
    id: snapshot.id,
    crawledAt: snapshot.crawledAt,
    durationMs: snapshot.durationMs,
    counts: snapshot.counts || { followers: 0, following: 0 }
  }));
  return {
    viewerAccountId: tracker.viewerAccountId,
    targetId: tracker.targetId,
    targetUsername: tracker.targetUsername,
    targetFullName: tracker.targetFullName,
    targetIsPrivate: tracker.targetIsPrivate,
    baseline: tracker.baseline,
    latest,
    history,
    snapshotCount: history.length
  };
}

function publicCloudConfig(config) {
  if (!config) return { configured: false, workspace: null };
  return {
    configured: Boolean(config.configured),
    workspace: config.workspace || null,
    maskedKey: config.maskedKey || "",
    autoProvisioned: Boolean(config.autoProvisioned),
    code: config.code || null,
    error: config.error || null
  };
}

async function status() {
  let loggedInUserId = null;
  try { loggedInUserId = await getLoggedInUserId(); } catch (_) {}
  const cloudConfig = await cloudGetConfig();
  return { loggedInUserId, cloudConfig, activeCrawl: activeCrawl ? { ...activeCrawl } : null };
}

async function safeCloudTargetStatus(targetId) {
  const config = await cloudGetConfig();
  if (!config.configured) return { configured: false, workspace: null, status: null, error: config.error || null };
  if (config.error) return { configured: true, workspace: config.workspace, status: null, error: config.error };
  try {
    const cloudStatus = await cloudGetTargetStatus(targetId);
    return { configured: true, workspace: config.workspace, status: cloudStatus };
  } catch (error) {
    return { configured: true, workspace: config.workspace, status: null, error: error?.message || String(error) };
  }
}

async function statusForWeb(options = {}) {
  let viewerId = null;
  try { viewerId = await getLoggedInUserId(); } catch (_) {}
  const rawConfig = await cloudGetConfig();
  const cloudConfig = publicCloudConfig(rawConfig);
  if (!viewerId) return { loggedInUserId: null, target: null, tracker: null, cloudConfig, cloud: null, activeCrawl };

  const rawTarget = normalizeUsername(options?.targetUsername);
  if (!rawTarget) {
    const state = await getState();
    const selfTracker = state.targets[trackerKey(viewerId, viewerId)] || null;
    const target = { id: viewerId, username: "", isPrivate: false, isSelf: true, resolver: "session-self" };
    const cloud = await safeCloudTargetStatus(viewerId);
    return {
      loggedInUserId: viewerId,
      target,
      tracker: summarizeTracker(selfTracker),
      cloudConfig,
      cloud,
      activeCrawl: activeCrawl ? { ...activeCrawl } : null
    };
  }

  const target = await resolveTargetProfile(rawTarget, viewerId);
  const state = await getState();
  const tracker = state.targets[trackerKey(viewerId, target.id)] || null;
  const cloud = await safeCloudTargetStatus(target.id);
  return {
    loggedInUserId: viewerId,
    target,
    tracker: summarizeTracker(tracker),
    cloudConfig,
    cloud,
    activeCrawl: activeCrawl ? { ...activeCrawl } : null
  };
}

async function handleWebRequest(message) {
  await assertPairingKey(message?.pairingKey);
  if (message?.action === "GET_STATUS") return statusForWeb(message?.payload || {});
  if (message?.action === "CRAWL_NOW") return crawlNow(message?.payload || {});
  throw new Error("Web action không được hỗ trợ.");
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "quet-unfollow-web-bridge") return;
  bridgePorts.add(port);
  port.onDisconnect.addListener(() => bridgePorts.delete(port));
  port.onMessage.addListener(async (message) => {
    if (message?.type !== "WEB_REQUEST") return;
    try {
      const result = await handleWebRequest(message);
      port.postMessage({ type: "WEB_RESPONSE", requestId: message.requestId, ok: true, result });
    } catch (error) {
      port.postMessage({ type: "WEB_RESPONSE", requestId: message.requestId, ok: false, error: error?.message || String(error) });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;
  const handlers = {
    GET_STATUS: status,
    CRAWL_NOW: () => crawlNow(message?.payload || {}),
    CRAWL_TARGET: () => crawlNow({ targetUsername: message?.targetUsername }),
    GET_PAIRING_KEY: async () => ({ pairingKey: await getPairingKey() }),
    ROTATE_PAIRING_KEY: async () => ({ pairingKey: await rotatePairingKey() }),
    GET_CLOUD_CONFIG: cloudGetConfig,
    CREATE_CLOUD_WORKSPACE: () => cloudCreateWorkspace(message?.name || "QuetUnfollowIG Workspace"),
    CONNECT_CLOUD_WORKSPACE: () => cloudConnectWorkspace(message?.workspaceKey),
    DISCONNECT_CLOUD_WORKSPACE: cloudDisconnectWorkspace,
    GET_CLOUD_TARGETS: cloudListTargets
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
