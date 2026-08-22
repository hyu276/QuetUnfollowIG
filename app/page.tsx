"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type IGUser = { id: string; username: string; fullName: string; isPrivate: boolean; isVerified: boolean };
type TargetProfile = {
  id: string;
  username: string;
  fullName?: string;
  isPrivate: boolean;
  isVerified?: boolean;
  viewerFollows?: boolean;
  followsViewer?: boolean;
  expectedFollowers?: number | null;
  expectedFollowing?: number | null;
  resolver?: string;
  isSelf?: boolean;
};
type Snapshot = {
  id: string;
  accountId: string;
  targetId?: string;
  crawledAt: string;
  durationMs?: number;
  followers: IGUser[];
  following: IGUser[];
  counts: { followers: number; following: number };
  warnings?: string[];
};
type SnapshotSummary = { id: string; crawledAt: string; durationMs?: number; counts: { followers: number; following: number } };
type WebTracker = {
  viewerAccountId: string;
  targetId: string;
  targetUsername: string;
  targetFullName?: string;
  targetIsPrivate: boolean;
  baseline: Snapshot | null;
  latest: Snapshot | null;
  history: SnapshotSummary[];
  snapshotCount: number;
};
type CloudProfile = {
  instagram_user_id: string;
  username?: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
};
type CloudRun = {
  id: string;
  target_username?: string;
  viewer_ig_id?: string | null;
  viewer_username?: string | null;
  crawled_followers: number;
  crawled_following: number;
  duration_ms?: number | null;
  previous_run_id?: string | null;
  captured_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
};
type CloudTargetStatus = {
  target?: { target_ig_id: string; username: string; full_name?: string; is_private: boolean } | null;
  history: CloudRun[];
  latest: CloudRun | null;
  previous?: CloudRun | null;
  changes: {
    lost_follower: CloudProfile[];
    new_follower: CloudProfile[];
    target_unfollowed: CloudProfile[];
    target_followed: CloudProfile[];
  };
  samples?: { followers: CloudProfile[]; following: CloudProfile[] };
  comparison?: {
    previousRunId?: string | null;
    viewerChanged?: boolean;
    currentViewerId?: string | null;
    previousViewerId?: string | null;
  } | null;
};
type CloudEnvelope = {
  configured: boolean;
  workspace?: { id: string; name: string } | null;
  status?: CloudTargetStatus | null;
  error?: string;
};
type CloudConfig = {
  configured: boolean;
  workspace?: { id: string; name: string } | null;
  error?: string;
  maskedKey?: string;
};
type StatusResult = {
  loggedInUserId: string | null;
  target: TargetProfile | null;
  tracker: WebTracker | null;
  cloudConfig?: CloudConfig;
  cloud?: CloudEnvelope | null;
};
type ProgressEvent = {
  kind: "followers" | "following";
  loaded: number;
  page: number;
  elapsedMs?: number;
  pageLatencyMs?: number;
  hasNextPage?: boolean;
  at?: string;
  target?: { id: string; username: string; isPrivate: boolean };
};
type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
};
type BehaviorListProps = {
  title: string;
  description: string;
  users: IGUser[];
  tone: "red" | "amber" | "green" | "blue";
  symbol: string;
  hasPreviousRun: boolean;
};

const SOURCE = "quet-unfollow-ig-web";
const PROFESSIONAL_MODE_KEY = "quet-unfollow-professional-mode";

function formatNumber(value?: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("vi-VN").format(value);
}

function formatDuration(ms?: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function targetLabel(target: TargetProfile | null, viewerId?: string | null) {
  if (!target) return "Not resolved";
  if (target.isSelf || target.id === viewerId) return "Your account";
  return target.username ? `@${target.username}` : `ID ${target.id}`;
}

function cloudUser(profile: CloudProfile): IGUser {
  return {
    id: profile.instagram_user_id || "",
    username: profile.username || "",
    fullName: profile.full_name || "",
    isPrivate: Boolean(profile.is_private),
    isVerified: Boolean(profile.is_verified)
  };
}

function userKey(user: IGUser) {
  return user.id ? `id:${user.id}` : `username:${user.username.toLowerCase()}`;
}

function BehaviorListCard({ title, description, users, tone, symbol, hasPreviousRun }: BehaviorListProps) {
  return (
    <article className={`behavior-card hazy-card tone-${tone}`}>
      <div className="behavior-head">
        <div className="behavior-title">
          <span className="behavior-symbol">{symbol}</span>
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <strong className="behavior-count">{hasPreviousRun ? formatNumber(users.length) : "—"}</strong>
      </div>

      <div className="behavior-list">
        {!hasPreviousRun ? (
          <div className="behavior-empty">Cần ít nhất 2 complete cloud runs để xác định tài khoản nào đã thay đổi.</div>
        ) : users.length ? (
          users.map((user) => (
            <div className="behavior-user" key={userKey(user)}>
              <div className="behavior-avatar">{user.username?.slice(0, 1).toUpperCase() || "?"}</div>
              <div className="behavior-user-main">
                <b>@{user.username || "unknown"}</b>
                <small>{user.fullName || `Instagram ID ${user.id || "unknown"}`}</small>
              </div>
              {user.username ? (
                <a
                  className="behavior-open"
                  href={`https://www.instagram.com/${encodeURIComponent(user.username)}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Profile
                </a>
              ) : null}
            </div>
          ))
        ) : (
          <div className="behavior-empty">Không có tài khoản nào thuộc hành vi này trong lần so sánh gần nhất.</div>
        )}
      </div>
    </article>
  );
}

export default function Home() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeVersion, setBridgeVersion] = useState("—");
  const [pairingKey, setPairingKey] = useState("");
  const [targetUsername, setTargetUsername] = useState("");
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [professionalMode, setProfessionalMode] = useState(false);
  const pending = useRef(new Map<string, PendingRequest>());

  useEffect(() => {
    const savedKey = window.localStorage.getItem("quet-unfollow-pairing-key");
    const savedTarget = window.localStorage.getItem("quet-unfollow-target");
    const savedMode = window.localStorage.getItem(PROFESSIONAL_MODE_KEY);
    if (savedKey) setPairingKey(savedKey);
    if (savedTarget) setTargetUsername(savedTarget);
    if (savedMode === "on") setProfessionalMode(true);

    const onPointerMove = (event: PointerEvent) => {
      const x = (event.clientX / Math.max(window.innerWidth, 1)) * 100;
      const y = (event.clientY / Math.max(window.innerHeight, 1)) * 100;
      document.documentElement.style.setProperty("--mouse-x", `${x}%`);
      document.documentElement.style.setProperty("--mouse-y", `${y}%`);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== SOURCE) return;

      if (message.type === "BRIDGE_READY") {
        setBridgeReady(true);
        setBridgeVersion(message.version || "unknown");
        return;
      }
      if (message.type === "BRIDGE_DISCONNECTED") {
        setBridgeReady(false);
        setError(message.error || "Extension bridge disconnected.");
        return;
      }
      if (message.type === "CRAWL_PROGRESS") {
        const payload = message.payload as ProgressEvent;
        setProgress(payload);
        setLogs((items) => [...items.slice(-199), payload]);
        return;
      }
      if (message.type === "WEB_RESPONSE") {
        const req = pending.current.get(message.requestId);
        if (!req) return;
        clearTimeout(req.timeout);
        pending.current.delete(message.requestId);
        message.ok ? req.resolve(message.result) : req.reject(new Error(message.error || "Unknown bridge error"));
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("message", onMessage);
    window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin);
    const retry = window.setTimeout(() => {
      window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin);
    }, 700);

    return () => {
      clearTimeout(retry);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("message", onMessage);
      for (const req of pending.current.values()) clearTimeout(req.timeout);
      pending.current.clear();
    };
  }, []);

  function toggleProfessionalMode() {
    setProfessionalMode((current) => {
      const next = !current;
      window.localStorage.setItem(PROFESSIONAL_MODE_KEY, next ? "on" : "off");
      return next;
    });
  }

  function request<T>(action: "GET_STATUS" | "CRAWL_NOW", payload: Record<string, unknown> = {}, key = pairingKey) {
    return new Promise<T>((resolve, reject) => {
      if (!bridgeReady) {
        reject(new Error("Không phát hiện extension bridge. Reload extension rồi reload website."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("Bridge request timeout."));
      }, action === "CRAWL_NOW" ? 20 * 60_000 : 30_000);
      pending.current.set(requestId, { resolve, reject, timeout });
      window.postMessage(
        { source: SOURCE, type: "WEB_REQUEST", requestId, pairingKey: key.trim(), action, payload },
        window.location.origin
      );
    });
  }

  async function connect() {
    setError("");
    const key = pairingKey.trim();
    if (!key) {
      setError("Nhập pairing key từ popup extension trước.");
      return;
    }
    try {
      window.localStorage.setItem("quet-unfollow-pairing-key", key);
      window.localStorage.setItem("quet-unfollow-target", targetUsername.trim());
      const result = await request<StatusResult>("GET_STATUS", { targetUsername: targetUsername.trim() }, key);
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function crawl() {
    setError("");
    setBusy(true);
    setLogs([]);
    setProgress({ kind: "followers", loaded: 0, page: 0, elapsedMs: 0 });
    try {
      window.localStorage.setItem("quet-unfollow-target", targetUsername.trim());
      await request("CRAWL_NOW", { targetUsername: targetUsername.trim() });
      setStatus(await request<StatusResult>("GET_STATUS", { targetUsername: targetUsername.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const target = status?.target || null;
  const tracker = status?.tracker || null;
  const localLatest = tracker?.latest || null;
  const cloudEnvelope = status?.cloud || null;
  const cloudStatus = cloudEnvelope?.status || null;
  const cloudLatest = cloudStatus?.latest || null;
  const cloudHistory = cloudStatus?.history || [];
  const cloudChanges = cloudStatus?.changes;
  const cloudConnected = Boolean(status?.cloudConfig?.configured && !status?.cloudConfig?.error);
  const viewerChanged = Boolean(cloudStatus?.comparison?.viewerChanged);
  const hasPreviousCloudRun = Boolean(cloudLatest?.previous_run_id);
  const selfTarget = Boolean(target?.isSelf || (target && target.id === status?.loggedInUserId));

  const changes = useMemo(() => ({
    lostFollowers: (cloudChanges?.lost_follower || []).map(cloudUser),
    newFollowers: (cloudChanges?.new_follower || []).map(cloudUser),
    unfollowed: (cloudChanges?.target_unfollowed || []).map(cloudUser),
    newFollowing: (cloudChanges?.target_followed || []).map(cloudUser)
  }), [cloudChanges]);

  const sampleFollowers = useMemo(() => {
    if (cloudStatus?.samples?.followers?.length) return cloudStatus.samples.followers.map(cloudUser);
    return localLatest?.followers?.slice(0, 12) || [];
  }, [cloudStatus, localLatest]);

  const sampleFollowing = useMemo(() => {
    if (cloudStatus?.samples?.following?.length) return cloudStatus.samples.following.map(cloudUser);
    return localLatest?.following?.slice(0, 12) || [];
  }, [cloudStatus, localLatest]);

  const followerCount = cloudLatest?.crawled_followers ?? localLatest?.counts.followers ?? null;
  const followingCount = cloudLatest?.crawled_following ?? localLatest?.counts.following ?? null;
  const expectedForProgress = progress?.kind === "followers" ? target?.expectedFollowers : target?.expectedFollowing;
  const progressPercent = expectedForProgress && progress
    ? Math.min(100, Math.max(0, (progress.loaded / expectedForProgress) * 100))
    : null;

  const validations = [
    {
      label: "Cloud Workspace connected",
      ok: cloudConnected,
      detail: status?.cloudConfig?.workspace?.name || status?.cloudConfig?.error || "not configured"
    },
    {
      label: "Target numeric ID exists",
      ok: Boolean(target?.id),
      detail: target?.id || "missing"
    },
    {
      label: "Latest cloud run complete",
      ok: Boolean(cloudLatest),
      detail: cloudLatest?.id || "no complete cloud run yet"
    },
    {
      label: "Cross-device history available",
      ok: cloudHistory.length > 0,
      detail: `${cloudHistory.length} complete run(s)`
    },
    {
      label: "Viewer consistency",
      ok: !viewerChanged,
      detail: viewerChanged
        ? `changed ${cloudStatus?.comparison?.previousViewerId || "?"} → ${cloudStatus?.comparison?.currentViewerId || "?"}`
        : "same viewer or first run"
    }
  ];
  const passCount = validations.filter((item) => item.ok).length;
  const integrityPerfect = validations.length > 0 && passCount === validations.length;

  return (
    <main className="site-shell">
      <nav className="top-nav">
        <div className="nav-inner">
          <a className="brand" href="#top" aria-label="QuetUnfollowIG home">
            <span className="brand-mark"><span /></span>
            <span>QuetUnfollowIG</span>
          </a>
          <div className="nav-links">
            <a href="#control">Control</a>
            <a href="#changes">Changes</a>
            <a href="#who-changed">Who changed</a>
            {professionalMode ? <a href="#realtime">Realtime</a> : null}
            {professionalMode ? <a href="#history">History</a> : null}
          </div>
          <div className="nav-tools">
            <button
              className={`mode-toggle ${professionalMode ? "is-on" : ""}`}
              onClick={toggleProfessionalMode}
              aria-pressed={professionalMode}
              title="Bật/tắt các số liệu và công cụ kỹ thuật"
            >
              <span className="mode-switch" />
              <span className="mode-toggle-label">Professional {professionalMode ? "ON" : "OFF"}</span>
            </button>
            {professionalMode ? (
              <div className={`nav-status ${bridgeReady ? "is-online" : "is-offline"}`}>
                <span className="nav-status-dot" />
                <span>{bridgeReady ? `Bridge ${bridgeVersion}` : "Bridge offline"}</span>
              </div>
            ) : null}
          </div>
        </div>
      </nav>

      <section className="hero-section" id="top">
        <div className="hero-ambient" aria-hidden="true">
          <div className="orb orb-a" />
          <div className="orb orb-b" />
          <div className="orb orb-c" />
          <div className="grid-haze" />
        </div>

        <div className="hero-copy">
          <div className="hero-mark reveal-1"><span /></div>
          <div className="hero-title" aria-label="Know exactly who changed.">
            <span className="word reveal-2">Know exactly</span>
            <span className="word reveal-3">who changed.</span>
          </div>
          <p className="hero-description reveal-4">
            Không chỉ đếm thay đổi follow. QuetUnfollowIG lưu snapshot trên Supabase và chỉ ra chính xác tài khoản nào xuất hiện hoặc biến mất giữa hai lần crawl hoàn chỉnh gần nhất.
          </p>
          <div className="hero-actions reveal-5">
            <a className="button button-primary" href="#control">Open tracker</a>
            <a className="button button-dark" href="#who-changed">See account lists <span>↘</span></a>
          </div>
        </div>

        <div className="hero-console-stage reveal-6">
          <div className="hero-console-glow" />
          <div className="hero-console">
            <div className="console-bar">
              <div className="console-dots"><span /><span /><span /></div>
              <div className="console-title">{professionalMode ? `supabase / ${target?.username ? `@${target.username}` : "target"}` : targetLabel(target, status?.loggedInUserId)}</div>
              <div className={`console-live ${busy ? "is-running" : ""}`}><span />{busy ? "CRAWLING" : cloudConnected ? "READY" : "SETUP"}</div>
            </div>
            <div className="console-body">
              <div className="console-profile">
                <div className="console-avatar">{target?.username?.slice(0, 1).toUpperCase() || "@"}</div>
                <div>
                  <span className="console-label">TARGET</span>
                  <strong>{targetLabel(target, status?.loggedInUserId)}</strong>
                  <small>{target ? `${target.isPrivate ? "Private" : "Public"}${professionalMode ? ` · ${target.resolver || "resolved"}` : ""}` : "Waiting for connection"}</small>
                </div>
              </div>
              <div className="console-numbers">
                <div><span>Followers</span><strong>{formatNumber(followerCount)}</strong></div>
                <div><span>Following</span><strong>{formatNumber(followingCount)}</strong></div>
                <div><span>{professionalMode ? "Cloud runs" : "Lost followers"}</span><strong>{professionalMode ? cloudHistory.length : hasPreviousCloudRun ? changes.lostFollowers.length : "—"}</strong></div>
              </div>
              {professionalMode ? (
                <div className="console-progress">
                  <div className="console-progress-row">
                    <span>{progress ? `${progress.kind} · page ${progress.page}` : "Crawler idle"}</span>
                    <strong>{progress ? `${formatNumber(progress.loaded)} received` : cloudLatest ? "Last run complete" : "No cloud run"}</strong>
                  </div>
                  <div className={`progress-track ${busy && progressPercent == null ? "is-indeterminate" : ""}`}>
                    <span style={progressPercent != null ? { width: `${progressPercent}%` } : undefined} />
                  </div>
                  <div className="console-progress-meta">
                    <span>latency {formatDuration(progress?.pageLatencyMs)}</span>
                    <span>elapsed {formatDuration(progress?.elapsedMs)}</span>
                    <span>next {progress?.hasNextPage == null ? "—" : progress.hasNextPage ? "yes" : "no"}</span>
                  </div>
                </div>
              ) : (
                <div className="simple-mode-note">
                  <b>Professional mode đang OFF.</b> Trang chỉ hiển thị các chỉ số chính và danh sách tài khoản có thay đổi quan hệ.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="content-section under-hero" id="control">
        <div className="section-wrap">
          <div className="section-heading">
            <span className="section-tag"><i>01</i> Control</span>
            <div>
              <h2>Choose an account.<br />Run a comparison.</h2>
              <p>Pair main site với extension, chọn target rồi crawl. Supabase giữ complete history để lần crawl sau xác định account nào đã xuất hiện hoặc biến mất khỏi Followers/Following.</p>
            </div>
          </div>

          <div className="control-card hazy-card">
            <div className="control-copy">
              <span className="mini-label">PAIRING + TARGET</span>
              <h3>Choose what to inspect.</h3>
              <p>Để trống target để crawl tài khoản đang đăng nhập, hoặc nhập @username/profile URL của tài khoản mà session hiện tại có quyền xem.</p>
              <div className={`bridge-inline ${bridgeReady ? "is-online" : ""}`}><span />{bridgeReady ? "Extension bridge detected" : "Reload extension to connect"}</div>
              <div className="mode-description"><b>Professional mode:</b> {professionalMode ? "technical telemetry + validation + history visible" : "simplified consumer view"}</div>
            </div>
            <div className="control-form">
              <label>
                <span>Pairing key</span>
                <input value={pairingKey} onChange={(e) => setPairingKey(e.target.value)} placeholder="Paste extension pairing key" spellCheck={false} autoComplete="off" />
              </label>
              <label>
                <span>Instagram target</span>
                <input value={targetUsername} onChange={(e) => setTargetUsername(e.target.value)} placeholder="@target_username · blank = me" spellCheck={false} autoComplete="off" />
              </label>
              <div className="control-buttons">
                <button className="button button-white" onClick={connect} disabled={!bridgeReady || busy}>Connect</button>
                <button className="button button-primary" onClick={crawl} disabled={!status?.loggedInUserId || !cloudConnected || busy}>{busy ? "Crawling + syncing…" : "Run crawl"}</button>
              </div>
            </div>
            {error ? <div className="notice notice-error"><span>!</span><p>{error}</p></div> : null}
            {cloudEnvelope?.error ? <div className="notice notice-error"><span>!</span><p>Cloud: {cloudEnvelope.error}</p></div> : null}
            {professionalMode && viewerChanged ? <div className="notice notice-warning"><span>!</span><p>The previous complete run used a different Instagram viewer. Diff confidence is lower for private accounts.</p></div> : null}
            {professionalMode && localLatest?.warnings?.length ? <div className="notice notice-warning"><span>!</span><p>{localLatest.warnings.join(" ")}</p></div> : null}
          </div>

          {professionalMode ? (
            <div className="metric-cards">
              <article className="metric-card hazy-card">
                <div className="metric-icon">01</div>
                <span>Cloud workspace</span>
                <strong>{cloudConnected ? "Connected" : "—"}</strong>
                <small>{status?.cloudConfig?.workspace?.name || "Configure in extension popup"}</small>
              </article>
              <article className="metric-card hazy-card">
                <div className="metric-icon">02</div>
                <span>Target</span>
                <strong className="target-metric">{targetLabel(target, status?.loggedInUserId)}</strong>
                <small>{target ? `${target.isPrivate ? "Private" : "Public"} · ${target.resolver || "resolver n/a"}` : "Not resolved"}</small>
              </article>
              <article className="metric-card hazy-card">
                <div className="metric-icon">03</div>
                <span>Followers</span>
                <strong>{formatNumber(followerCount)}</strong>
                <small>{cloudLatest ? "Supabase complete run" : "No cloud snapshot"}</small>
              </article>
              <article className="metric-card hazy-card">
                <div className="metric-icon">04</div>
                <span>Following</span>
                <strong>{formatNumber(followingCount)}</strong>
                <small>{cloudLatest ? formatDate(cloudLatest.captured_at || cloudLatest.finished_at || cloudLatest.created_at) : "No cloud snapshot"}</small>
              </article>
            </div>
          ) : (
            <div className="metric-cards consumer-metrics">
              <article className="metric-card hazy-card">
                <div className="metric-icon">@</div>
                <span>Target</span>
                <strong className="target-metric">{targetLabel(target, status?.loggedInUserId)}</strong>
                <small>{target ? (target.isPrivate ? "Private account" : "Public account") : "Connect to resolve"}</small>
              </article>
              <article className="metric-card hazy-card">
                <div className="metric-icon">↓</div>
                <span>Followers</span>
                <strong>{formatNumber(followerCount)}</strong>
                <small>Latest complete crawl</small>
              </article>
              <article className="metric-card hazy-card">
                <div className="metric-icon">↑</div>
                <span>Following</span>
                <strong>{formatNumber(followingCount)}</strong>
                <small>Latest complete crawl</small>
              </article>
            </div>
          )}

          {professionalMode && target ? (
            <div className="target-strip hazy-card">
              <span><b>Target ID</b>{target.id}</span>
              <span><b>Cloud runs</b>{cloudHistory.length}</span>
              <span><b>Previous run</b>{cloudLatest?.previous_run_id ? cloudLatest.previous_run_id.slice(0, 8) : "None"}</span>
              <span><b>Current viewer</b>{cloudStatus?.comparison?.currentViewerId || status?.loggedInUserId || "—"}</span>
              <span><b>Last duration</b>{formatDuration(cloudLatest?.duration_ms ?? localLatest?.durationMs)}</span>
            </div>
          ) : null}
        </div>
      </section>

      {professionalMode ? (
        <section className="content-section grey-section" id="realtime">
          <div className="section-wrap">
            <div className="section-heading">
              <span className="section-tag"><i>02</i> Realtime</span>
              <div>
                <h2>Watch every page.<br />Trust only complete runs.</h2>
                <p>Telemetry cho biết pagination, latency và trạng thái validation của crawl hiện tại.</p>
              </div>
            </div>

            <div className="realtime-grid">
              <article className="telemetry-card hazy-card">
                <div className="card-topline">
                  <div><span className="mini-label">LIVE TELEMETRY</span><h3>Crawl progress</h3></div>
                  <span className={`run-pill ${busy ? "is-running" : ""}`}><i />{busy ? "RUNNING" : "IDLE"}</span>
                </div>
                <div className="telemetry-hero">
                  <span>{progress ? progress.kind : "No active run"}</span>
                  <strong>{progress ? `Page ${progress.page}` : "—"}</strong>
                  <small>{progress ? `${formatNumber(progress.loaded)} accounts received${progress.target?.username ? ` from @${progress.target.username}` : ""}` : "Run a cloud crawl to stream telemetry"}</small>
                </div>
                <div className="telemetry-stats">
                  <span><small>Elapsed</small><b>{formatDuration(progress?.elapsedMs)}</b></span>
                  <span><small>Page latency</small><b>{formatDuration(progress?.pageLatencyMs)}</b></span>
                  <span><small>Next page</small><b>{progress?.hasNextPage == null ? "—" : progress.hasNextPage ? "Yes" : "No"}</b></span>
                </div>
                <div className="log-window">
                  <div className="log-header"><span>TIME</span><span>LIST</span><span>PAGE</span><span>USERS</span><span>LATENCY</span></div>
                  {logs.length ? logs.slice().reverse().map((item, index) => (
                    <div className="log-entry" key={`${item.kind}-${item.page}-${item.at || index}-${index}`}>
                      <code>{item.at ? new Date(item.at).toLocaleTimeString("vi-VN") : "now"}</code>
                      <span>{item.kind}</span>
                      <span>{item.page}</span>
                      <span>{formatNumber(item.loaded)}</span>
                      <span>{item.pageLatencyMs != null ? `${item.pageLatencyMs} ms` : "—"}</span>
                    </div>
                  )) : <div className="empty-state">Telemetry will appear here.</div>}
                </div>
              </article>

              <article className="integrity-card hazy-card">
                <div className="card-topline">
                  <div><span className="mini-label">CLOUD VALIDATION</span><h3>Cross-device integrity</h3></div>
                  <div className={`integrity-score ${integrityPerfect ? "is-perfect" : ""}`}>
                    <strong>{passCount}/{validations.length}</strong>
                    <span>{integrityPerfect ? "PASS" : "CHECK"}</span>
                  </div>
                </div>
                <div className="integrity-list">
                  {validations.map((item) => (
                    <div className="integrity-item" key={item.label}>
                      <span className={`integrity-icon ${item.ok ? "ok" : "fail"}`}>{item.ok ? "✓" : "×"}</span>
                      <div><b>{item.label}</b><small>{item.detail}</small></div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>
      ) : null}

      <section className="content-section" id="changes">
        <div className="section-wrap">
          <div className="section-heading">
            <span className="section-tag"><i>{professionalMode ? "03" : "02"}</i> Changes</span>
            <div>
              <h2>What changed<br />since the last crawl?</h2>
              <p>So sánh latest complete run với complete run ngay trước đó của cùng target. Đây là observed list difference; không tự động chứng minh nguyên nhân là unfollow.</p>
            </div>
          </div>

          <div className="change-grid">
            <article className="change-card hazy-card tone-red">
              <div className="change-symbol">−</div>
              <span>{selfTarget ? "No longer follows you" : "No longer follows target"}</span>
              <strong>{cloudLatest ? formatNumber(changes.lostFollowers.length) : "—"}</strong>
              <small>{hasPreviousCloudRun ? "previous run → latest" : "need another complete run"}</small>
            </article>
            <article className="change-card hazy-card tone-amber">
              <div className="change-symbol">↘</div>
              <span>{selfTarget ? "No longer in your Following" : "Target no longer follows"}</span>
              <strong>{cloudLatest ? formatNumber(changes.unfollowed.length) : "—"}</strong>
              <small>{hasPreviousCloudRun ? "previous run → latest" : "need another complete run"}</small>
            </article>
            <article className="change-card hazy-card tone-green">
              <div className="change-symbol">+</div>
              <span>{selfTarget ? "New in your Followers" : "New followers"}</span>
              <strong>{cloudLatest ? formatNumber(changes.newFollowers.length) : "—"}</strong>
              <small>{hasPreviousCloudRun ? "previous run → latest" : "need another complete run"}</small>
            </article>
            <article className="change-card hazy-card tone-blue">
              <div className="change-symbol">↗</div>
              <span>{selfTarget ? "New in your Following" : "New in target Following"}</span>
              <strong>{cloudLatest ? formatNumber(changes.newFollowing.length) : "—"}</strong>
              <small>{hasPreviousCloudRun ? "previous run → latest" : "need another complete run"}</small>
            </article>
          </div>

          <div className="change-people-section" id="who-changed">
            <div className="section-heading">
              <span className="section-tag"><i>{professionalMode ? "04" : "03"}</i> Who changed</span>
              <div>
                <h2>Not just how many.<br />Exactly which accounts.</h2>
                <p>Đây là toàn bộ account xuất hiện hoặc biến mất giữa hai complete runs gần nhất. Disappearance có thể do unfollow, block, deactivate/delete hoặc thay đổi visibility — vì vậy UI không gán nguyên nhân khi dữ liệu không chứng minh được.</p>
              </div>
            </div>

            <div className="behavior-grid">
              <BehaviorListCard
                title={selfTarget ? "No longer follows you" : "No longer follows target"}
                description={selfTarget ? "Từng có trong Followers của bạn nhưng không còn ở latest run." : "Từng có trong Followers của target nhưng không còn ở latest run."}
                users={changes.lostFollowers}
                tone="red"
                symbol="−"
                hasPreviousRun={hasPreviousCloudRun}
              />
              <BehaviorListCard
                title={selfTarget ? "No longer in your Following" : "Target no longer follows"}
                description={selfTarget ? "Từng có trong Following của bạn nhưng không còn ở latest run." : "Từng có trong Following của target nhưng không còn ở latest run."}
                users={changes.unfollowed}
                tone="amber"
                symbol="↘"
                hasPreviousRun={hasPreviousCloudRun}
              />
              <BehaviorListCard
                title={selfTarget ? "New in your Followers" : "New followers"}
                description={selfTarget ? "Mới xuất hiện trong Followers của bạn." : "Mới xuất hiện trong Followers của target."}
                users={changes.newFollowers}
                tone="green"
                symbol="+"
                hasPreviousRun={hasPreviousCloudRun}
              />
              <BehaviorListCard
                title={selfTarget ? "New in your Following" : "New in target Following"}
                description={selfTarget ? "Mới xuất hiện trong Following của bạn." : "Mới xuất hiện trong Following của target."}
                users={changes.newFollowing}
                tone="blue"
                symbol="↗"
                hasPreviousRun={hasPreviousCloudRun}
              />
            </div>
          </div>

          {professionalMode ? (
            <div className="sample-grid">
              <article className="sample-card hazy-card">
                <div className="card-topline"><div><span className="mini-label">LATEST CLOUD SAMPLE</span><h3>Followers</h3></div><span>{sampleFollowers.length} shown</span></div>
                <div className="people-list">
                  {sampleFollowers.length ? sampleFollowers.map((user) => (
                    <div className="person-row" key={userKey(user)}>
                      <div className="person-avatar">{user.username?.slice(0, 1).toUpperCase() || "?"}</div>
                      <div><b>@{user.username || "unknown"}</b><small>{user.fullName || "Instagram user"}</small></div>
                      <code>{user.id || "no-id"}</code>
                    </div>
                  )) : <div className="empty-state tall">No follower data.</div>}
                </div>
              </article>
              <article className="sample-card hazy-card">
                <div className="card-topline"><div><span className="mini-label">LATEST CLOUD SAMPLE</span><h3>Following</h3></div><span>{sampleFollowing.length} shown</span></div>
                <div className="people-list">
                  {sampleFollowing.length ? sampleFollowing.map((user) => (
                    <div className="person-row" key={userKey(user)}>
                      <div className="person-avatar">{user.username?.slice(0, 1).toUpperCase() || "?"}</div>
                      <div><b>@{user.username || "unknown"}</b><small>{user.fullName || "Instagram user"}</small></div>
                      <code>{user.id || "no-id"}</code>
                    </div>
                  )) : <div className="empty-state tall">No following data.</div>}
                </div>
              </article>
            </div>
          ) : null}
        </div>
      </section>

      {professionalMode ? (
        <section className="content-section grey-section" id="history">
          <div className="section-wrap">
            <div className="section-heading">
              <span className="section-tag"><i>05</i> History</span>
              <div>
                <h2>One target history.<br />Across every device.</h2>
                <p>Only finalized cloud runs appear here. Partial uploads and failed runs are excluded from comparison. Time is the snapshot capture time, not upload completion time.</p>
              </div>
            </div>

            <article className="history-card hazy-card">
              <div className="card-topline">
                <div><span className="mini-label">SUPABASE HISTORY</span><h3>Complete runs · {targetLabel(target, status?.loggedInUserId)}</h3></div>
                <span>{cloudHistory.length} runs</span>
              </div>
              <div className="history-table">
                <div className="history-row history-head"><span>Captured</span><span>Followers</span><span>Following</span><span>Duration</span><span>Run</span></div>
                {cloudHistory.length ? cloudHistory.map((run) => (
                  <div className="history-row" key={run.id}>
                    <span>{formatDate(run.captured_at || run.finished_at || run.created_at)}</span>
                    <span>{formatNumber(run.crawled_followers)}</span>
                    <span>{formatNumber(run.crawled_following)}</span>
                    <span>{formatDuration(run.duration_ms)}</span>
                    <code>{run.id.slice(0, 10)}</code>
                  </div>
                )) : <div className="empty-state tall">No complete cloud run for this target yet.</div>}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="brand-mark"><span /></span>
            <strong>QuetUnfollowIG</strong>
            <p>{professionalMode ? "Supabase stores normalized relationship snapshots and SQL-computed diffs." : "See the accounts behind every observed relationship change."}</p>
          </div>
          <div className="footer-links">
            <a href="#control">Control</a>
            <a href="#changes">Changes</a>
            <a href="#who-changed">Who changed</a>
            {professionalMode ? <a href="#history">History</a> : null}
          </div>
        </div>
        <div className="footer-bottom">
          <span>UNOFFICIAL INSTAGRAM ANALYTICS TOOL</span>
          <span>Only data visible to the signed-in Instagram session can be crawled.</span>
        </div>
      </footer>
    </main>
  );
}
