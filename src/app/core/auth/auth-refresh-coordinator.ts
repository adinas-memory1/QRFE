const LOCK_KEY = 'qrfe-auth-refresh-lock';
const LOCK_TTL_MS = 20_000;
const ORPHAN_PROBE_MS = 400;
const TAB_ID = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

const refreshChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('qrfe-auth-refresh') : null;

let lifecycleBound = false;

type LockPayload = { owner: string; startedAt: number };

/** Shared across tabs — web auth cookies are also shared per browser profile. */
function lockStorage(): Storage | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage;
  }
  return null;
}

function readLock(): LockPayload | null {
  const store = lockStorage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(LOCK_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LockPayload;
    if (!parsed?.owner || !parsed?.startedAt) {
      return null;
    }
    if (Date.now() - parsed.startedAt > LOCK_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLock(owner: string): void {
  const store = lockStorage();
  if (!store) {
    return;
  }
  try {
    const payload: LockPayload = { owner, startedAt: Date.now() };
    store.setItem(LOCK_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

function clearLock(owner: string): void {
  const store = lockStorage();
  if (!store) {
    return;
  }
  try {
    const current = readLock();
    if (!current || current.owner === owner) {
      store.removeItem(LOCK_KEY);
    }
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function notifyRefreshDone(ok: boolean): void {
  refreshChannel?.postMessage({ type: 'refresh-done', ok, owner: TAB_ID });
}

function waitForRefreshDone(maxMs: number): Promise<boolean> {
  if (!refreshChannel) {
    return sleep(maxMs).then(() => false);
  }
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(false), maxMs);
    const onMessage = (ev: MessageEvent<{ type?: string; ok?: boolean }>) => {
      if (ev.data?.type !== 'refresh-done') {
        return;
      }
      finish(!!ev.data.ok);
    };
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      refreshChannel.removeEventListener('message', onMessage);
      resolve(ok);
    };
    refreshChannel.addEventListener('message', onMessage);
  });
}

async function isForeignLockHolderAlive(owner: string): Promise<boolean> {
  if (!refreshChannel || owner === TAB_ID) {
    return false;
  }
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(false), ORPHAN_PROBE_MS);
    const onMessage = (ev: MessageEvent<{ type?: string; owner?: string }>) => {
      if (ev.data?.type === 'refresh-probe-ack' && ev.data.owner === owner) {
        finish(true);
      }
    };
    const finish = (alive: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      refreshChannel.removeEventListener('message', onMessage);
      resolve(alive);
    };
    refreshChannel.addEventListener('message', onMessage);
    refreshChannel.postMessage({ type: 'refresh-probe', requester: TAB_ID, targetOwner: owner });
  });
}

function isDocumentReload(): boolean {
  if (typeof performance === 'undefined') {
    return false;
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === 'reload';
}

function clearRefreshLockOnReload(): void {
  if (!isDocumentReload()) {
    return;
  }
  const store = lockStorage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(LOCK_KEY);
  } catch {
    // ignore
  }
}

function clearForeignLockIfOrphan(reason: 'bootstrap' | 'reload'): boolean {
  const existing = readLock();
  if (!existing || existing.owner === TAB_ID) {
    return false;
  }
  clearLock(existing.owner);
  return true;
}

async function clearOrphanForeignLock(): Promise<boolean> {
  const existing = readLock();
  if (!existing || existing.owner === TAB_ID) {
    return false;
  }
  if (isDocumentReload()) {
    return clearForeignLockIfOrphan('reload');
  }
  const alive = await isForeignLockHolderAlive(existing.owner);
  if (alive) {
    return false;
  }
  clearLock(existing.owner);
  return true;
}

function bindRefreshCoordinatorLifecycle(): void {
  if (lifecycleBound || typeof window === 'undefined') {
    return;
  }
  lifecycleBound = true;
  window.addEventListener('pagehide', () => clearLock(TAB_ID));
  refreshChannel?.addEventListener('message', (ev: MessageEvent<{ type?: string; targetOwner?: string }>) => {
    if (ev.data?.type !== 'refresh-probe') {
      return;
    }
    const lock = readLock();
    if (lock?.owner === TAB_ID && ev.data.targetOwner === TAB_ID) {
      refreshChannel?.postMessage({ type: 'refresh-probe-ack', owner: TAB_ID });
    }
  });
}

/** Call once on app bootstrap (before auth refresh). */
export function initRefreshCoordinator(): void {
  bindRefreshCoordinatorLifecycle();
  clearRefreshLockOnReload();
  clearForeignLockIfOrphan('bootstrap');
}

export function tryAcquireRefreshLeaderSync(): 'leader' | 'follower' | 'contended' {
  bindRefreshCoordinatorLifecycle();
  clearRefreshLockOnReload();
  if (isDocumentReload()) {
    clearForeignLockIfOrphan('reload');
  }
  const existing = readLock();
  if (existing) {
    if (existing.owner !== TAB_ID) {
      return 'contended';
    }
    // Same tab already holds the lock (concurrent refresh pipeline).
    return 'contended';
  }
  writeLock(TAB_ID);
  const after = readLock();
  if (after?.owner !== TAB_ID) {
    return 'contended';
  }
  return 'leader';
}

/** Cross-tab / cross-bootstrap singleflight for refresh (rotation revokes reused tokens). */
export async function acquireRefreshLeader(): Promise<'leader' | 'follower'> {
  bindRefreshCoordinatorLifecycle();

  const existing = readLock();
  if (existing?.owner !== TAB_ID) {
    await clearOrphanForeignLock();
  }

  const role = tryAcquireRefreshLeaderSync();
  if (role === 'leader') {
    return 'leader';
  }

  await waitForRefreshDone(LOCK_TTL_MS);
  return 'follower';
}

export function releaseRefreshLeader(ok: boolean): void {
  clearLock(TAB_ID);
  notifyRefreshDone(ok);
}

/** Test helper: clear cross-tab refresh lock between specs. */
export function resetRefreshCoordinatorForTests(): void {
  const store = lockStorage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(LOCK_KEY);
  } catch {
    // ignore
  }
}
