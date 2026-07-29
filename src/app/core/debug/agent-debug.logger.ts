/** Agent debug — session e9be21 @ 192.168.43.142 only */
const DEBUG_SESSION = 'e9be21';
const DEBUG_STORAGE_KEY = `debug-${DEBUG_SESSION}`;
const DEBUG_POST_URL = 'http://192.168.43.142/api/debug/agent-log';

type DebugEntry = {
  sessionId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  runId: string;
  timestamp: number;
};

function persistSessionFallback(entry: DebugEntry): void {
  try {
    const raw = sessionStorage.getItem(DEBUG_STORAGE_KEY);
    const arr: DebugEntry[] = raw ? (JSON.parse(raw) as DebugEntry[]) : [];
    arr.push(entry);
    if (arr.length > 400) {
      arr.splice(0, arr.length - 400);
    }
    sessionStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore quota / private mode */
  }
}

export function agentDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = 'pre-fix',
): void {
  const entry: DebugEntry = {
    sessionId: DEBUG_SESSION,
    hypothesisId,
    location,
    message,
    data,
    runId,
    timestamp: Date.now(),
  };

  // #region agent log
  persistSessionFallback(entry);

  fetch(DEBUG_POST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DEBUG_SESSION,
    },
    body: JSON.stringify(entry),
  }).catch(() => {});
  // #endregion
}

/** DevTools fallback: copy(sessionStorage.getItem('debug-e9be21')) */
export function dumpAgentDebugLogsFromSession(): string {
  try {
    return sessionStorage.getItem(DEBUG_STORAGE_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}
