/** Agent debug logger — no-op (ingest / remote debug calls removed). */
export function agentDebugLog(
  _hypothesisId: string,
  _location: string,
  _message: string,
  _data: Record<string, unknown> = {},
  _runId = 'pre-fix',
): void {
  /* intentionally empty */
}

/** DevTools fallback stub (session debug storage removed). */
export function dumpAgentDebugLogsFromSession(): string {
  return '[]';
}
