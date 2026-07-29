/** Agent debug ingest — session e9be21, LAN :80 */
const DEBUG_INGEST = 'http://192.168.43.142/ingest/1418246a-67e2-4be2-9f84-77b49dcc9c16';
const DEBUG_SESSION = 'e9be21';

export function agentDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
  runId = 'pre-fix',
): void {
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DEBUG_SESSION,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION,
      hypothesisId,
      location,
      message,
      data,
      runId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
