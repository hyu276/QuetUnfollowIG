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
  if (!target) return "Not resolved";
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
    const retry = window.setTimeout(() => window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin), 700);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("pointermove", onPointerMove);
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
    setError("");
    setBusy(true);
    setLogs([]);
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
      { label: "Follower count matches array", ok: latest.counts.followers === latest.followers.length, detail: `${latest.counts.followers} / ${latest.followers.length}` },
      { label: "Following count matches array", ok: latest.counts.following === latest.following.length, detail: `${latest.counts.following} / ${latest.following.length}` },
      { label: "Followers have unique IDs", ok: uniqueCount(latest.followers) === latest.followers.length, detail: `${uniqueCount(latest.followers)} unique` },
      { label: "Following have unique IDs", ok: uniqueCount(latest.following) === latest.following.length, detail: `${uniqueCount(latest.following)} unique` },
      { label: "Baseline exists", ok: Boolean(baseline), detail: baseline ? formatDate(baseline.crawledAt) : "missing" },
      { label: "Target numeric ID exists", ok: Boolean(latest.targetId || latest.accountId), detail: latest.targetId || latest.accountId }
    ];
    const ef = latest.expectedCounts?.followers;
    const eg = latest.expectedCounts?.following;
    if (ef != null) result.push({ label: "Followers match profile count", ok: latest.counts.followers === ef, detail: `${latest.counts.followers} / expected ${ef}` });
    if (eg != null) result.push({ label: "Following match profile count", ok: latest.counts.following === eg, detail: `${latest.counts.following} / expected ${eg}` });
    return result;
  }, [latest, baseline]);

  const passCount = validations.filter((v) => v.ok).length;
  const sampleFollowers = latest?.followers.slice(0, 12) || [];
  const sampleFollowing = latest?.following.slice(0, 12) || [];
  const selfTarget = Boolean(target?.isSelf || (target && target.id === status?.loggedInUserId));
  const expectedForProgress = progress?.kind === "followers" ? target?.expectedFollowers : target?.expectedFollowing;
  const progressPercent = expectedForProgress && progress ? Math.min(100, Math.max(0, (progress.loaded / expectedForProgress) * 100)) : null;
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
            <a href="#realtime">Realtime</a>
            <a href="#changes">Changes</a>
            <a href="#history">History</a>
          </div>
          <div className={`nav-status ${bridgeReady ? "is-online" : "is-offline"}`}>
            <span className="nav-status-dot" />
            <span>{bridgeReady ? `Bridge ${bridgeVersion}` : "Bridge offline"}</span>
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
          <div className="hero-title" aria-label="Know who stays. See who leaves.">
            <span className="word reveal-2">Know who stays.</span>
            <span className="word reveal-3">See who leaves.</span>
          </div>
          <p className="hero-description reveal-4">
            A local-first Instagram relationship tracker. Crawl what your signed-in session can see, keep snapshots, and know exactly what changed.
          </p>
          <div className="hero-actions reveal-5">
            <a className="button button-primary" href="#control">Open live console</a>
            <a className="button button-dark" href="#realtime">See telemetry <span>↘</span></a>
          </div>
        </div>

        <div className="hero-console-stage reveal-6">
          <div className="hero-console-glow" />
          <div className="hero-console">
            <div className="console-bar">
              <div className="console-dots"><span /><span /><span /></div>
              <div className="console-title">live crawl / {target?.username ? `@${target.username}` : "target"}</div>
              <div className={`console-live ${busy ? "is-running" : ""}`}><span />{busy ? "CRAWLING" : "READY"}</div>
            </div>
            <div className="console-body">
              <div className="console-profile">
                <div className="console-avatar">{target?.username?.slice(0, 1).toUpperCase() || "@"}</div>
                <div>
                  <span className="console-label">TARGET</span>
                  <strong>{targetLabel(target, status?.loggedInUserId)}</strong>
                  <small>{target ? `${target.isPrivate ? "Private" : "Public"} · ${target.resolver || "resolved"}` : "Waiting for connection"}</small>
                </div>
              </div>
              <div className="console-numbers">
                <div><span>Followers</span><strong>{latest ? formatNumber(latest.counts.followers) : "—"}</strong></div>
                <div><span>Following</span><strong>{latest ? formatNumber(latest.counts.following) : "—"}</strong></div>
                <div><span>Snapshots</span><strong>{tracker?.snapshotCount ?? 0}</strong></div>
              </div>
              <div className="console-progress">
                <div className="console-progress-row">
                  <span>{progress ? `${progress.kind} · page ${progress.page}` : "Crawler idle"}</span>
                  <strong>{progress ? `${formatNumber(progress.loaded)} received` : "0 received"}</strong>
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
            </div>
          </div>
        </div>
      </section>

      <section className="content-section under-hero" id="control">
        <div className="section-wrap">
          <div className="section-heading reveal-on-scroll">
            <span className="section-tag"><i>01</i> Control</span>
            <div>
              <h2>Point the crawler.<br />Keep the session private.</h2>
              <p>Pair with the extension, choose a visible Instagram target, and run the same crawler that stores your snapshots locally.</p>
            </div>
          </div>

          <div className="control-card hazy-card">
            <div className="control-copy">
              <span className="mini-label">PAIRING + TARGET</span>
              <h3>Choose what to inspect.</h3>
              <p>Leave target blank to crawl your own account. You can also paste an @username, username, or Instagram profile URL.</p>
              <div className={`bridge-inline ${bridgeReady ? "is-online" : ""}`}><span />{bridgeReady ? "Extension bridge detected" : "Reload extension to connect"}</div>
            </div>
            <div className="control-form">
              <label>
                <span>Pairing key</span>
                <input value={pairingKey} onChange={(e) => setPairingKey(e.target.value)} placeholder="Paste extension pairing key" spellCheck={false} />
              </label>
              <label>
                <span>Instagram target</span>
                <input value={targetUsername} onChange={(e) => setTargetUsername(e.target.value)} placeholder="@target_username · blank = me" spellCheck={false} />
              </label>
              <div className="control-buttons">
                <button className="button button-white" onClick={connect} disabled={!bridgeReady || busy}>Resolve + connect</button>
                <button className="button button-primary" onClick={crawl} disabled={!status?.loggedInUserId || busy}>{busy ? "Crawling…" : "Run live crawl"}</button>
                <button className="button button-ghost" onClick={resetBaseline} disabled={!tracker?.latest || busy}>Reset baseline</button>
              </div>
            </div>
            {error ? <div className="notice notice-error"><span>!</span><p>{error}</p></div> : null}
            {latest?.warnings?.length ? <div className="notice notice-warning"><span>!</span><p>{latest.warnings.join(" ")}</p></div> : null}
          </div>

          <div className="metric-cards">
            <article className="metric-card hazy-card">
              <div className="metric-icon">01</div>
              <span>Viewer session</span>
              <strong>{status?.loggedInUserId ? "Detected" : "—"}</strong>
              <small>{status?.loggedInUserId ? `ID ${status.loggedInUserId}` : "Connect to verify"}</small>
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
              <strong>{latest ? formatNumber(latest.counts.followers) : "—"}</strong>
              <small>expected {formatNumber(latest?.expectedCounts?.followers)}</small>
            </article>
            <article className="metric-card hazy-card">
              <div className="metric-icon">04</div>
              <span>Following</span>
              <strong>{latest ? formatNumber(latest.counts.following) : "—"}</strong>
              <small>expected {formatNumber(latest?.expectedCounts?.following)}</small>
            </article>
          </div>

          {target ? <div className="target-strip hazy-card">
            <span><b>Target ID</b>{target.id}</span>
            <span><b>Visibility</b>{target.isPrivate ? "Private" : "Public"}</span>
            <span><b>Viewer follows</b>{target.viewerFollows ? "Yes" : "No / unknown"}</span>
            <span><b>Follows viewer</b>{target.followsViewer ? "Yes" : "No / unknown"}</span>
            <span><b>Last duration</b>{formatDuration(latest?.durationMs)}</span>
          </div> : null}
        </div>
      </section>

      <section className="content-section grey-section" id="realtime">
        <div className="section-wrap">
          <div className="section-heading">
            <span className="section-tag"><i>02</i> Realtime</span>
            <div>
              <h2>Watch every page<br />as Instagram answers.</h2>
              <p>Page count, latency, pagination state and snapshot integrity stay visible while the extension works.</p>
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
                <small>{progress ? `${formatNumber(progress.loaded)} accounts received${progress.target?.username ? ` from @${progress.target.username}` : ""}` : "Run a crawl to stream telemetry"}</small>
              </div>
              <div className="telemetry-stats">
                <span><small>Elapsed</small><b>{formatDuration(progress?.elapsedMs)}</b></span>
                <span><small>Page latency</small><b>{formatDuration(progress?.pageLatencyMs)}</b></span>
                <span><small>Next page</small><b>{progress?.hasNextPage == null ? "—" : progress.hasNextPage ? "Yes" : "No"}</b></span>
              </div>
              <div className="log-window">
                <div className="log-header"><span>TIME</span><span>LIST</span><span>PAGE</span><span>USERS</span><span>LATENCY</span></div>
                {logs.length ? logs.slice().reverse().map((item, i) => (
                  <div className="log-entry" key={`${item.kind}-${item.page}-${item.at || i}-${i}`}>
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
                <div><span className="mini-label">VALIDATION</span><h3>Snapshot integrity</h3></div>
                <div className={`integrity-score ${integrityPerfect ? "is-perfect" : ""}`}>
                  <strong>{validations.length ? `${passCount}/${validations.length}` : "—"}</strong>
                  <span>{integrityPerfect ? "PASS" : "CHECK"}</span>
                </div>
              </div>
              <div className="integrity-list">
                {validations.length ? validations.map((item) => (
                  <div className="integrity-item" key={item.label}>
                    <span className={`integrity-icon ${item.ok ? "ok" : "fail"}`}>{item.ok ? "✓" : "×"}</span>
                    <div><b>{item.label}</b><small>{item.detail}</small></div>
                  </div>
                )) : <div className="empty-state tall">No snapshot to validate yet.</div>}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="content-section" id="changes">
        <div className="section-wrap">
          <div className="section-heading">
            <span className="section-tag"><i>03</i> Changes</span>
            <div>
              <h2>Diffs that read<br />at a glance.</h2>
              <p>Every card compares the current target against its own baseline under the current viewer session.</p>
            </div>
          </div>

          <div className="change-grid">
            <article className="change-card hazy-card tone-red">
              <div className="change-symbol">−</div><span>{selfTarget ? "Lost followers" : "Target lost followers"}</span>
              <strong>{diff ? formatNumber(diff.lostFollowers.length) : "—"}</strong><small>baseline → latest</small>
            </article>
            <article className="change-card hazy-card tone-amber">
              <div className="change-symbol">↘</div><span>{selfTarget ? "You unfollowed" : "Target unfollowed"}</span>
              <strong>{diff ? formatNumber(diff.unfollowed.length) : "—"}</strong><small>baseline → latest</small>
            </article>
            <article className="change-card hazy-card tone-green">
              <div className="change-symbol">+</div><span>New followers</span>
              <strong>{diff ? formatNumber(diff.newFollowers.length) : "—"}</strong><small>baseline → latest</small>
            </article>
            <article className="change-card hazy-card tone-blue">
              <div className="change-symbol">↗</div><span>New following</span>
              <strong>{diff ? formatNumber(diff.newFollowing.length) : "—"}</strong><small>baseline → latest</small>
            </article>
          </div>

          <div className="sample-grid">
            <article className="sample-card hazy-card">
              <div className="card-topline"><div><span className="mini-label">RAW SAMPLE</span><h3>Followers</h3></div><span>{sampleFollowers.length} shown</span></div>
              <div className="people-list">
                {sampleFollowers.length ? sampleFollowers.map((u) => (
                  <div className="person-row" key={userKey(u)}>
                    <div className="person-avatar">{u.username?.slice(0, 1).toUpperCase() || "?"}</div>
                    <div><b>@{u.username || "unknown"}</b><small>{u.fullName || "Instagram user"}</small></div>
                    <code>{u.id || "no-id"}</code>
                  </div>
                )) : <div className="empty-state tall">No follower data.</div>}
              </div>
            </article>
            <article className="sample-card hazy-card">
              <div className="card-topline"><div><span className="mini-label">RAW SAMPLE</span><h3>Following</h3></div><span>{sampleFollowing.length} shown</span></div>
              <div className="people-list">
                {sampleFollowing.length ? sampleFollowing.map((u) => (
                  <div className="person-row" key={userKey(u)}>
                    <div className="person-avatar">{u.username?.slice(0, 1).toUpperCase() || "?"}</div>
                    <div><b>@{u.username || "unknown"}</b><small>{u.fullName || "Instagram user"}</small></div>
                    <code>{u.id || "no-id"}</code>
                  </div>
                )) : <div className="empty-state tall">No following data.</div>}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="content-section grey-section" id="history">
        <div className="section-wrap">
          <div className="section-heading">
            <span className="section-tag"><i>04</i> History</span>
            <div>
              <h2>Every crawl leaves<br />a clean checkpoint.</h2>
              <p>History is lightweight here; full follower/following arrays remain inside extension storage.</p>
            </div>
          </div>

          <article className="history-card hazy-card">
            <div className="card-topline">
              <div><span className="mini-label">TARGET HISTORY</span><h3>Snapshots · {targetLabel(target, status?.loggedInUserId)}</h3></div>
              <span>{tracker?.snapshotCount || 0} snapshots</span>
            </div>
            <div className="history-table">
              <div className="history-row history-head"><span>Time</span><span>Followers</span><span>Following</span><span>Duration</span><span>Snapshot</span></div>
              {tracker?.history?.length ? [...tracker.history].reverse().map((s) => (
                <div className="history-row" key={s.id}>
                  <span>{formatDate(s.crawledAt)}</span><span>{formatNumber(s.counts.followers)}</span><span>{formatNumber(s.counts.following)}</span><span>{formatDuration(s.durationMs)}</span><code>{s.id.slice(0, 10)}</code>
                </div>
              )) : <div className="empty-state tall">No snapshot history for this target yet.</div>}
            </div>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand"><span className="brand-mark"><span /></span><strong>QuetUnfollowIG</strong><p>Local snapshots. Session-bound access. No Instagram cookie sent to the website.</p></div>
          <div className="footer-links"><a href="#control">Control</a><a href="#realtime">Realtime</a><a href="#changes">Changes</a><a href="#history">History</a></div>
        </div>
        <div className="footer-bottom"><span>UNOFFICIAL INSTAGRAM ANALYTICS TOOL</span><span>Private targets are only crawlable when the signed-in session can view them.</span></div>
      </footer>
    </main>
  );
}