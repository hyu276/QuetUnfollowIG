"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type IGUser = { id: string; username: string; fullName: string; isPrivate: boolean; isVerified: boolean };
type TargetProfile = {
  id: string; username: string; fullName?: string; isPrivate: boolean; isVerified?: boolean;
  viewerFollows?: boolean; followsViewer?: boolean; expectedFollowers?: number | null;
  expectedFollowing?: number | null; resolver?: string; isSelf?: boolean;
};
type Snapshot = {
  id: string; viewerAccountId?: string; accountId: string; targetId?: string; targetUsername?: string;
  crawledAt: string; durationMs?: number; followers: IGUser[]; following: IGUser[];
  counts: { followers: number; following: number }; warnings?: string[];
};
type SnapshotSummary = { id: string; crawledAt: string; durationMs?: number; counts: { followers: number; following: number } };
type WebTracker = {
  viewerAccountId: string; targetId: string; targetUsername: string; targetFullName?: string; targetIsPrivate: boolean;
  baseline: Snapshot | null; latest: Snapshot | null; history: SnapshotSummary[]; snapshotCount: number;
};
type CloudProfile = { instagram_user_id: string; username?: string; full_name?: string; is_private?: boolean; is_verified?: boolean };
type CloudRun = {
  id: string; target_username?: string; viewer_ig_id?: string | null; viewer_username?: string | null;
  crawled_followers: number; crawled_following: number; duration_ms?: number | null;
  previous_run_id?: string | null; finished_at?: string | null; created_at?: string;
};
type CloudTargetStatus = {
  target?: { target_ig_id: string; username: string; full_name?: string; is_private: boolean } | null;
  history: CloudRun[]; latest: CloudRun | null; previous?: CloudRun | null;
  changes: { lost_follower: CloudProfile[]; new_follower: CloudProfile[]; target_unfollowed: CloudProfile[]; target_followed: CloudProfile[] };
  samples?: { followers: CloudProfile[]; following: CloudProfile[] };
  comparison?: { previousRunId?: string | null; viewerChanged?: boolean; currentViewerId?: string | null; previousViewerId?: string | null } | null;
};
type CloudEnvelope = { configured: boolean; workspace?: { id: string; name: string } | null; status?: CloudTargetStatus | null; error?: string };
type CloudConfig = { configured: boolean; workspace?: { id: string; name: string } | null; error?: string; maskedKey?: string };
type StatusResult = {
  loggedInUserId: string | null; target: TargetProfile | null; tracker: WebTracker | null;
  cloudConfig?: CloudConfig; cloud?: CloudEnvelope | null;
};
type ProgressEvent = {
  kind: "followers" | "following"; loaded: number; page: number; elapsedMs?: number; pageLatencyMs?: number;
  hasNextPage?: boolean; at?: string; target?: { id: string; username: string; isPrivate: boolean };
};
type PendingRequest = { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: ReturnType<typeof setTimeout> };

const SOURCE = "quet-unfollow-ig-web";

function formatNumber(value?: number | null) { return value == null ? "—" : new Intl.NumberFormat("vi-VN").format(value); }
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
  if (!target) return "—";
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
function userKey(user: IGUser) { return user.id ? `id:${user.id}` : `username:${user.username.toLowerCase()}`; }

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
  const pending = useRef(new Map<string, PendingRequest>());

  useEffect(() => {
    const savedKey = window.localStorage.getItem("quet-unfollow-pairing-key");
    const savedTarget = window.localStorage.getItem("quet-unfollow-target");
    if (savedKey) setPairingKey(savedKey);
    if (savedTarget) setTargetUsername(savedTarget);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== SOURCE) return;
      if (message.type === "BRIDGE_READY") { setBridgeReady(true); setBridgeVersion(message.version || "unknown"); return; }
      if (message.type === "BRIDGE_DISCONNECTED") { setBridgeReady(false); setError(message.error || "Extension bridge disconnected."); return; }
      if (message.type === "CRAWL_PROGRESS") {
        const payload = message.payload as ProgressEvent;
        setProgress(payload); setLogs((items) => [...items.slice(-199), payload]); return;
      }
      if (message.type === "WEB_RESPONSE") {
        const req = pending.current.get(message.requestId);
        if (!req) return;
        clearTimeout(req.timeout); pending.current.delete(message.requestId);
        message.ok ? req.resolve(message.result) : req.reject(new Error(message.error || "Unknown bridge error"));
      }
    };

    window.addEventListener("message", onMessage);
    window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin);
    const retry = window.setTimeout(() => window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin), 700);
    return () => {
      clearTimeout(retry); window.removeEventListener("message", onMessage);
      for (const req of pending.current.values()) clearTimeout(req.timeout);
      pending.current.clear();
    };
  }, []);

  function request<T>(action: "GET_STATUS" | "CRAWL_NOW", payload: Record<string, unknown> = {}, key = pairingKey) {
    return new Promise<T>((resolve, reject) => {
      if (!bridgeReady) return reject(new Error("Không phát hiện extension bridge. Reload extension rồi reload website."));
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pending.current.delete(requestId); reject(new Error("Bridge request timeout."));
      }, action === "CRAWL_NOW" ? 20 * 60_000 : 30_000);
      pending.current.set(requestId, { resolve, reject, timeout });
      window.postMessage({ source: SOURCE, type: "WEB_REQUEST", requestId, pairingKey: key.trim(), action, payload }, window.location.origin);
    });
  }

  async function connect() {
    setError("");
    const key = pairingKey.trim();
    if (!key) return setError("Nhập pairing key từ popup extension trước.");
    try {
      window.localStorage.setItem("quet-unfollow-pairing-key", key);
      window.localStorage.setItem("quet-unfollow-target", targetUsername.trim());
      setStatus(await request<StatusResult>("GET_STATUS", { targetUsername: targetUsername.trim() }, key));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function crawl() {
    setError(""); setBusy(true); setLogs([]);
    setProgress({ kind: "followers", loaded: 0, page: 0, elapsedMs: 0 });
    try {
      window.localStorage.setItem("quet-unfollow-target", targetUsername.trim());
      await request("CRAWL_NOW", { targetUsername: targetUsername.trim() });
      setStatus(await request<StatusResult>("GET_STATUS", { targetUsername: targetUsername.trim() }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const target = status?.target || null;
  const tracker = status?.tracker || null;
  const localLatest = tracker?.latest || null;
  const cloudEnvelope = status?.cloud || null;
  const cloudStatus = cloudEnvelope?.status || null;
  const cloudLatest = cloudStatus?.latest || null;
  const cloudHistory = cloudStatus?.history || [];
  const cloudChanges = cloudStatus?.changes;
  const hasPreviousCloudRun = Boolean(cloudLatest?.previous_run_id);

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
  const selfTarget = Boolean(target?.isSelf || (target && target.id === status?.loggedInUserId));
  const cloudConnected = Boolean(status?.cloudConfig?.configured && !status?.cloudConfig?.error);
  const viewerChanged = Boolean(cloudStatus?.comparison?.viewerChanged);

  const validations = [
    { label: "Cloud Workspace connected", ok: cloudConnected, detail: status?.cloudConfig?.workspace?.name || status?.cloudConfig?.error || "not configured" },
    { label: "Target numeric ID tồn tại", ok: Boolean(target?.id), detail: target?.id || "missing" },
    { label: "Latest cloud run complete", ok: Boolean(cloudLatest), detail: cloudLatest?.id || "no cloud run yet" },
    { label: "Cross-device history available", ok: cloudHistory.length > 0, detail: `${cloudHistory.length} complete run(s)` },
    { label: "Viewer consistency", ok: !viewerChanged, detail: viewerChanged ? `changed ${cloudStatus?.comparison?.previousViewerId || "?"} → ${cloudStatus?.comparison?.currentViewerId || "?"}` : "same viewer or first run" },
  ];
  const passCount = validations.filter((v) => v.ok).length;

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">SUPABASE CLOUD CRAWL CONSOLE</div>
          <h1>QuetUnfollowIG</h1>
          <p className="lede">Mỗi complete crawl được commit lên Supabase. Diff luôn so với complete run gần nhất của cùng target trong Cloud Workspace, bất kể thiết bị.</p>
        </div>
        <div className={`bridge-pill ${bridgeReady ? "ok" : "bad"}`}><span className="status-dot" />{bridgeReady ? `Extension bridge v${bridgeVersion}` : "Extension bridge chưa phát hiện"}</div>
      </header>

      <section className="connect-card panel">
        <div><span className="section-kicker">PAIRING + TARGET</span><h2>Chọn account cần crawl</h2><p>Cloud Workspace được cấu hình trong extension popup. Để trống target = tài khoản đang login.</p></div>
        <div className="connect-row">
          <input value={pairingKey} onChange={(e) => setPairingKey(e.target.value)} placeholder="Pairing key…" spellCheck={false} />
          <input value={targetUsername} onChange={(e) => setTargetUsername(e.target.value)} placeholder="@target_username · blank = me" spellCheck={false} />
          <button onClick={connect} disabled={!bridgeReady || busy}>Resolve + Cloud Status</button>
          <button className="primary" onClick={crawl} disabled={!status?.loggedInUserId || !cloudConnected || busy}>{busy ? "Crawling + syncing…" : "Run cloud crawl"}</button>
        </div>
        {error ? <div className="error-box">{error}</div> : null}
        {viewerChanged ? <div className="error-box">Warning: lần crawl trước dùng Instagram viewer khác. Diff vẫn được tính theo target nhưng độ tin cậy thấp hơn với private account.</div> : null}
        {cloudEnvelope?.error ? <div className="error-box">Cloud: {cloudEnvelope.error}</div> : null}
      </section>

      <section className="metric-grid">
        <article className="metric panel"><span>Cloud Workspace</span><strong>{cloudConnected ? "Connected" : "—"}</strong><small>{status?.cloudConfig?.workspace?.name || "Configure in extension popup"}</small></article>
        <article className="metric panel"><span>Target</span><strong>{targetLabel(target, status?.loggedInUserId)}</strong><small>{target ? `${target.isPrivate ? "Private" : "Public"} · ${target.resolver || "resolver n/a"}` : "Chưa resolve"}</small></article>
        <article className="metric panel"><span>Followers</span><strong>{formatNumber(followerCount)}</strong><small>{cloudLatest ? "Supabase complete run" : "No cloud snapshot"}</small></article>
        <article className="metric panel"><span>Following</span><strong>{formatNumber(followingCount)}</strong><small>{cloudLatest ? formatDate(cloudLatest.finished_at) : "No cloud snapshot"}</small></article>
      </section>

      <section className="toolbar panel">
        <div className="comparison-meta">
          Target ID <b>{target?.id || "—"}</b> · cloud runs <b>{cloudHistory.length}</b> · previous run <b>{cloudLatest?.previous_run_id ? cloudLatest.previous_run_id.slice(0, 8) : "none"}</b> · current viewer <b>{cloudStatus?.comparison?.currentViewerId || status?.loggedInUserId || "—"}</b> · last duration <b>{formatDuration(cloudLatest?.duration_ms)}</b>
        </div>
      </section>

      <section className="two-col">
        <article className="panel progress-panel">
          <div className="panel-head"><div><span className="section-kicker">REALTIME</span><h2>Instagram crawl progress</h2></div><span className={`run-state ${busy ? "running" : "idle"}`}>{busy ? "RUNNING" : "IDLE"}</span></div>
          <div className="progress-main"><strong>{progress ? `${progress.kind} · page ${progress.page}` : "No run"}</strong><span>{progress ? `${formatNumber(progress.loaded)} accounts received` : "Run cloud crawl để bắt đầu telemetry"}</span></div>
          <div className="progress-meta"><span>Elapsed <b>{formatDuration(progress?.elapsedMs)}</b></span><span>Page latency <b>{formatDuration(progress?.pageLatencyMs)}</b></span><span>Next page <b>{progress?.hasNextPage == null ? "—" : progress.hasNextPage ? "yes" : "no"}</b></span></div>
          <div className="log-box">{logs.length ? logs.slice().reverse().map((item, i) => <div className="log-line" key={`${item.kind}-${item.page}-${item.at || i}-${i}`}><code>{item.at ? new Date(item.at).toLocaleTimeString("vi-VN") : "now"}</code><span>{item.kind}</span><span>page {item.page}</span><span>{formatNumber(item.loaded)} users</span><span>{item.pageLatencyMs != null ? `${item.pageLatencyMs} ms` : ""}</span></div>) : <div className="empty-log">Chưa có telemetry.</div>}</div>
        </article>

        <article className="panel validation-panel">
          <div className="panel-head"><div><span className="section-kicker">CLOUD VALIDATION</span><h2>Cross-device integrity</h2></div><span className={`score ${passCount === validations.length ? "pass" : "neutral"}`}>{passCount}/{validations.length}</span></div>
          <div className="checks">{validations.map((item) => <div className="check" key={item.label}><span className={item.ok ? "check-icon ok" : "check-icon fail"}>{item.ok ? "✓" : "×"}</span><div><b>{item.label}</b><small>{item.detail}</small></div></div>)}</div>
        </article>
      </section>

      <section className="diff-grid">
        <article className="metric panel danger"><span>{selfTarget ? "Mất follower" : "Target mất follower"}</span><strong>{cloudLatest ? formatNumber(changes.lostFollowers.length) : "—"}</strong><small>{hasPreviousCloudRun ? "previous complete run → latest" : "first cloud run"}</small></article>
        <article className="metric panel warning"><span>{selfTarget ? "Bạn đã unfollow" : "Target đã unfollow"}</span><strong>{cloudLatest ? formatNumber(changes.unfollowed.length) : "—"}</strong><small>{hasPreviousCloudRun ? "previous complete run → latest" : "first cloud run"}</small></article>
        <article className="metric panel success"><span>Follower mới</span><strong>{cloudLatest ? formatNumber(changes.newFollowers.length) : "—"}</strong><small>Supabase diff</small></article>
        <article className="metric panel info"><span>Following mới</span><strong>{cloudLatest ? formatNumber(changes.newFollowing.length) : "—"}</strong><small>Supabase diff</small></article>
      </section>

      <section className="two-col">
        <article className="panel sample-panel"><div className="panel-head"><div><span className="section-kicker">CLOUD SAMPLE</span><h2>Followers</h2></div><span>{sampleFollowers.length} shown</span></div><div className="sample-list">{sampleFollowers.length ? sampleFollowers.map((u) => <div className="sample-user" key={userKey(u)}><b>@{u.username || "unknown"}</b><code>{u.id || "no-id"}</code><small>{u.fullName || "—"}</small></div>) : <div className="placeholder">No follower data.</div>}</div></article>
        <article className="panel sample-panel"><div className="panel-head"><div><span className="section-kicker">CLOUD SAMPLE</span><h2>Following</h2></div><span>{sampleFollowing.length} shown</span></div><div className="sample-list">{sampleFollowing.length ? sampleFollowing.map((u) => <div className="sample-user" key={userKey(u)}><b>@{u.username || "unknown"}</b><code>{u.id || "no-id"}</code><small>{u.fullName || "—"}</small></div>) : <div className="placeholder">No following data.</div>}</div></article>
      </section>

      <section className="panel history-panel">
        <div className="panel-head"><div><span className="section-kicker">SUPABASE HISTORY</span><h2>Complete runs của target</h2></div><span>{cloudHistory.length} runs</span></div>
        <div className="history-table"><div className="history-row history-head"><span>Time</span><span>Followers</span><span>Following</span><span>Duration</span><span>Run ID</span></div>{cloudHistory.length ? cloudHistory.map((run) => <div className="history-row" key={run.id}><span>{formatDate(run.finished_at || run.created_at)}</span><span>{formatNumber(run.crawled_followers)}</span><span>{formatNumber(run.crawled_following)}</span><span>{formatDuration(run.duration_ms)}</span><span>{run.id.slice(0, 10)}</span></div>) : <div className="placeholder">Chưa có complete cloud run cho target này.</div>}</div>
      </section>

      <footer>Supabase là source of truth cho history/diff. Local browser chỉ giữ cache. Một run upload thiếu Followers/Following sẽ không được dùng để suy luận unfollow.</footer>
    </main>
  );
}
