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
  targetFullName?: string; targetIsPrivate?: boolean; targetViewerFollows?: boolean; resolver?: string;
  expectedCounts?: { followers: number | null; following: number | null };
  crawledAt: string; durationMs?: number; followers: IGUser[]; following: IGUser[];
  counts: { followers: number; following: number }; warnings?: string[];
};
type SnapshotSummary = { id: string; crawledAt: string; durationMs?: number; counts: { followers: number; following: number } };
type WebTracker = {
  viewerAccountId: string; targetId: string; targetUsername: string; targetFullName?: string; targetIsPrivate: boolean;
  baseline: Snapshot | null; latest: Snapshot | null; history: SnapshotSummary[]; snapshotCount: number;
};
type StatusResult = { loggedInUserId: string | null; target: TargetProfile | null; tracker: WebTracker | null };
type ProgressEvent = {
  kind: "followers" | "following"; loaded: number; page: number; elapsedMs?: number; pageLatencyMs?: number;
  hasNextPage?: boolean; at?: string; target?: { id: string; username: string; isPrivate: boolean };
};
type PendingRequest = { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: ReturnType<typeof setTimeout> };

const SOURCE = "quet-unfollow-ig-web";

function userKey(user: IGUser) { return user.id ? `id:${user.id}` : `username:${user.username.toLowerCase()}`; }
function diffUsers(before: IGUser[] = [], after: IGUser[] = []) {
  const beforeMap = new Map(before.map((u) => [userKey(u), u]));
  const afterMap = new Map(after.map((u) => [userKey(u), u]));
  return {
    removed: [...beforeMap].filter(([k]) => !afterMap.has(k)).map(([, u]) => u),
    added: [...afterMap].filter(([k]) => !beforeMap.has(k)).map(([, u]) => u)
  };
}
function formatNumber(value?: number | null) { return value == null ? "—" : new Intl.NumberFormat("vi-VN").format(value); }
function formatDuration(ms?: number) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}
function uniqueCount(users: IGUser[]) { return new Set(users.map(userKey)).size; }
function targetLabel(target: TargetProfile | null, viewerId?: string | null) {
  if (!target) return "—";
  if (target.isSelf || target.id === viewerId) return "Your account";
  return target.username ? `@${target.username}` : `ID ${target.id}`;
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

    window.addEventListener("message", onMessage);
    window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin);
    const retry = window.setTimeout(() => window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin), 700);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("message", onMessage);
      for (const req of pending.current.values()) clearTimeout(req.timeout);
      pending.current.clear();
    };
  }, []);

  function request<T>(action: "GET_STATUS" | "CRAWL_NOW" | "RESET_BASELINE", payload: Record<string, unknown> = {}, key = pairingKey) {
    return new Promise<T>((resolve, reject) => {
      if (!bridgeReady) return reject(new Error("Không phát hiện extension bridge. Reload extension rồi reload website."));
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("Bridge request timeout."));
      }, action === "CRAWL_NOW" ? 20 * 60_000 : 20_000);
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
      const result = await request<StatusResult>("GET_STATUS", { targetUsername: targetUsername.trim() }, key);
      setStatus(result);
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

  async function resetBaseline() {
    setError("");
    try {
      await request("RESET_BASELINE", { targetUsername: targetUsername.trim() });
      setStatus(await request<StatusResult>("GET_STATUS", { targetUsername: targetUsername.trim() }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  const target = status?.target || null;
  const tracker = status?.tracker || null;
  const latest = tracker?.latest || null;
  const baseline = tracker?.baseline || null;
  const diff = useMemo(() => {
    if (!latest || !baseline) return null;
    const followers = diffUsers(baseline.followers, latest.followers);
    const following = diffUsers(baseline.following, latest.following);
    return { lostFollowers: followers.removed, newFollowers: followers.added, unfollowed: following.removed, newFollowing: following.added };
  }, [latest, baseline]);

  const validations = useMemo(() => {
    if (!latest) return [];
    const result = [
      { label: "Follower count khớp array", ok: latest.counts.followers === latest.followers.length, detail: `${latest.counts.followers} / ${latest.followers.length}` },
      { label: "Following count khớp array", ok: latest.counts.following === latest.following.length, detail: `${latest.counts.following} / ${latest.following.length}` },
      { label: "Followers không duplicate", ok: uniqueCount(latest.followers) === latest.followers.length, detail: `${uniqueCount(latest.followers)} unique` },
      { label: "Following không duplicate", ok: uniqueCount(latest.following) === latest.following.length, detail: `${uniqueCount(latest.following)} unique` },
      { label: "Baseline tồn tại", ok: Boolean(baseline), detail: baseline ? formatDate(baseline.crawledAt) : "missing" },
      { label: "Target numeric ID tồn tại", ok: Boolean(latest.targetId || latest.accountId), detail: latest.targetId || latest.accountId }
    ];
    const ef = latest.expectedCounts?.followers;
    const eg = latest.expectedCounts?.following;
    if (ef != null) result.push({ label: "Followers khớp profile count", ok: latest.counts.followers === ef, detail: `${latest.counts.followers} / expected ${ef}` });
    if (eg != null) result.push({ label: "Following khớp profile count", ok: latest.counts.following === eg, detail: `${latest.counts.following} / expected ${eg}` });
    return result;
  }, [latest, baseline]);

  const passCount = validations.filter((v) => v.ok).length;
  const sampleFollowers = latest?.followers.slice(0, 12) || [];
  const sampleFollowing = latest?.following.slice(0, 12) || [];
  const selfTarget = Boolean(target?.isSelf || (target && target.id === status?.loggedInUserId));

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">LIVE CRAWLER VALIDATION CONSOLE</div>
          <h1>QuetUnfollowIG</h1>
          <p className="lede">Crawl chính tài khoản đang đăng nhập hoặc bất kỳ target mà session đó có thể xem trên Instagram.</p>
        </div>
        <div className={`bridge-pill ${bridgeReady ? "ok" : "bad"}`}><span className="status-dot" />{bridgeReady ? `Extension bridge v${bridgeVersion}` : "Extension bridge chưa phát hiện"}</div>
      </header>

      <section className="connect-card panel">
        <div><span className="section-kicker">PAIRING + TARGET</span><h2>Chọn account cần crawl</h2><p>Để trống target = tài khoản của bạn. Có thể nhập @username, username hoặc Instagram profile URL.</p></div>
        <div className="connect-row">
          <input value={pairingKey} onChange={(e) => setPairingKey(e.target.value)} placeholder="Pairing key…" spellCheck={false} />
          <input value={targetUsername} onChange={(e) => setTargetUsername(e.target.value)} placeholder="@target_username · blank = me" spellCheck={false} />
          <button onClick={connect} disabled={!bridgeReady || busy}>Resolve + Connect</button>
          <button className="primary" onClick={crawl} disabled={!status?.loggedInUserId || busy}>{busy ? "Crawling…" : "Run live crawl"}</button>
          <button onClick={resetBaseline} disabled={!tracker?.latest || busy}>Reset baseline</button>
        </div>
        {error ? <div className="error-box">{error}</div> : null}
        {latest?.warnings?.length ? <div className="error-box">{latest.warnings.join(" ")}</div> : null}
      </section>

      <section className="metric-grid">
        <article className="metric panel"><span>Viewer session</span><strong>{status?.loggedInUserId ? "Detected" : "—"}</strong><small>{status?.loggedInUserId ? `ID ${status.loggedInUserId}` : "Connect để kiểm tra"}</small></article>
        <article className="metric panel"><span>Target</span><strong>{targetLabel(target, status?.loggedInUserId)}</strong><small>{target ? `${target.isPrivate ? "Private" : "Public"} · ${target.resolver || "resolver n/a"}` : "Chưa resolve"}</small></article>
        <article className="metric panel"><span>Followers</span><strong>{latest ? formatNumber(latest.counts.followers) : "—"}</strong><small>{latest ? `profile expected ${formatNumber(latest.expectedCounts?.followers)}` : "Chưa có snapshot"}</small></article>
        <article className="metric panel"><span>Following</span><strong>{latest ? formatNumber(latest.counts.following) : "—"}</strong><small>{latest ? `profile expected ${formatNumber(latest.expectedCounts?.following)}` : "Chưa có snapshot"}</small></article>
      </section>

      {target ? <section className="toolbar panel">
        <div className="comparison-meta">
          Target ID <b>{target.id}</b> · {target.isPrivate ? "private" : "public"} · viewer follows target: <b>{target.viewerFollows ? "yes" : "no / unknown"}</b> · target follows viewer: <b>{target.followsViewer ? "yes" : "no / unknown"}</b> · snapshots: <b>{tracker?.snapshotCount || 0}</b> · last duration: <b>{formatDuration(latest?.durationMs)}</b>
        </div>
      </section> : null}

      <section className="two-col">
        <article className="panel progress-panel">
          <div className="panel-head"><div><span className="section-kicker">REALTIME</span><h2>Crawl progress</h2></div><span className={`run-state ${busy ? "running" : "idle"}`}>{busy ? "RUNNING" : "IDLE"}</span></div>
          <div className="progress-main"><strong>{progress ? `${progress.kind} · page ${progress.page}` : "No run"}</strong><span>{progress ? `${formatNumber(progress.loaded)} accounts received${progress.target?.username ? ` from @${progress.target.username}` : ""}` : "Run live crawl để bắt đầu telemetry"}</span></div>
          <div className="progress-meta"><span>Elapsed <b>{formatDuration(progress?.elapsedMs)}</b></span><span>Page latency <b>{formatDuration(progress?.pageLatencyMs)}</b></span><span>Next page <b>{progress?.hasNextPage == null ? "—" : progress.hasNextPage ? "yes" : "no"}</b></span></div>
          <div className="log-box">{logs.length ? logs.slice().reverse().map((item, i) => <div className="log-line" key={`${item.kind}-${item.page}-${item.at || i}-${i}`}><code>{item.at ? new Date(item.at).toLocaleTimeString("vi-VN") : "now"}</code><span>{item.kind}</span><span>page {item.page}</span><span>{formatNumber(item.loaded)} users</span><span>{item.pageLatencyMs != null ? `${item.pageLatencyMs} ms` : ""}</span></div>) : <div className="empty-log">Chưa có telemetry.</div>}</div>
        </article>

        <article className="panel validation-panel">
          <div className="panel-head"><div><span className="section-kicker">VALIDATION</span><h2>Snapshot integrity</h2></div><span className={`score ${validations.length && passCount === validations.length ? "pass" : "neutral"}`}>{validations.length ? `${passCount}/${validations.length}` : "—"}</span></div>
          <div className="checks">{validations.length ? validations.map((item) => <div className="check" key={item.label}><span className={item.ok ? "check-icon ok" : "check-icon fail"}>{item.ok ? "✓" : "×"}</span><div><b>{item.label}</b><small>{item.detail}</small></div></div>) : <div className="placeholder">Chưa có snapshot để validate.</div>}</div>
        </article>
      </section>

      <section className="diff-grid">
        <article className="metric panel danger"><span>{selfTarget ? "Mất follower" : "Target mất follower"}</span><strong>{diff ? formatNumber(diff.lostFollowers.length) : "—"}</strong><small>baseline → latest</small></article>
        <article className="metric panel warning"><span>{selfTarget ? "Bạn đã unfollow" : "Target đã unfollow"}</span><strong>{diff ? formatNumber(diff.unfollowed.length) : "—"}</strong><small>baseline → latest</small></article>
        <article className="metric panel success"><span>Follower mới</span><strong>{diff ? formatNumber(diff.newFollowers.length) : "—"}</strong><small>baseline → latest</small></article>
        <article className="metric panel info"><span>Following mới</span><strong>{diff ? formatNumber(diff.newFollowing.length) : "—"}</strong><small>baseline → latest</small></article>
      </section>

      <section className="two-col">
        <article className="panel sample-panel"><div className="panel-head"><div><span className="section-kicker">RAW SAMPLE</span><h2>Followers</h2></div><span>{sampleFollowers.length} shown</span></div><div className="sample-list">{sampleFollowers.length ? sampleFollowers.map((u) => <div className="sample-user" key={userKey(u)}><b>@{u.username || "unknown"}</b><code>{u.id || "no-id"}</code><small>{u.fullName || "—"}</small></div>) : <div className="placeholder">No follower data.</div>}</div></article>
        <article className="panel sample-panel"><div className="panel-head"><div><span className="section-kicker">RAW SAMPLE</span><h2>Following</h2></div><span>{sampleFollowing.length} shown</span></div><div className="sample-list">{sampleFollowing.length ? sampleFollowing.map((u) => <div className="sample-user" key={userKey(u)}><b>@{u.username || "unknown"}</b><code>{u.id || "no-id"}</code><small>{u.fullName || "—"}</small></div>) : <div className="placeholder">No following data.</div>}</div></article>
      </section>

      <section className="panel history-panel">
        <div className="panel-head"><div><span className="section-kicker">TARGET HISTORY</span><h2>Snapshots của target hiện tại</h2></div><span>{tracker?.snapshotCount || 0} snapshots</span></div>
        <div className="history-table"><div className="history-row history-head"><span>Time</span><span>Followers</span><span>Following</span><span>Duration</span><span>ID</span></div>{tracker?.history?.length ? [...tracker.history].reverse().map((s) => <div className="history-row" key={s.id}><span>{formatDate(s.crawledAt)}</span><span>{formatNumber(s.counts.followers)}</span><span>{formatNumber(s.counts.following)}</span><span>{formatDuration(s.durationMs)}</span><span>{s.id.slice(0, 10)}</span></div>) : <div className="placeholder">Chưa có snapshot history cho target này.</div>}</div>
      </section>

      <footer>Tool chỉ crawl dữ liệu mà session Instagram hiện tại có thể truy cập. Private account không có quyền xem sẽ bị từ chối; website không nhận cookie Instagram.</footer>
    </main>
  );
}
