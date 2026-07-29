/** Agent debug — session e9be21; POST to API + local Cursor ingest */
import { environment } from '../../../environments/environment';

const DEBUG_SESSION = 'e9be21';
const DEBUG_STORAGE_KEY = `debug-${DEBUG_SESSION}`;
const DEBUG_POST_URL = `${environment.apiUrl.replace(/\/$/, '')}/api/debug/agent-log`;
const DEBUG_INGEST_URL = 'http://127.0.0.1:7761/ingest/1418246a-67e2-4be2-9f84-77b49dcc9c16';
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

  const body = JSON.stringify(entry);
  const headers = {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': DEBUG_SESSION,
  };
  fetch(DEBUG_POST_URL, { method: 'POST', headers, body }).catch(() => {});
  fetch(DEBUG_INGEST_URL, { method: 'POST', headers, body }).catch(() => {});
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
