/** Debug-only connectivity trail (session 25e5dc). Safe for production: no tokens/PII. */
const DEBUG_SESSION_ID = '25e5dc';
const STORAGE_KEY = `urs-connectivity-debug-${DEBUG_SESSION_ID}`;
const MAX_EVENTS = 120;

export interface ConnectivityDebugEvent {
  sessionId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
}

function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://local');
    const path = u.pathname.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    );
    return path + (u.search ? '?…' : '');
  } catch {
    return raw.split('?')[0]?.slice(0, 80) ?? 'unknown';
  }
}

function readBuffer(): ConnectivityDebugEvent[] {
  if (typeof sessionStorage === 'undefined') {
    return [];
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as ConnectivityDebugEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffer(events: ConnectivityDebugEvent[]): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // quota — drop oldest half
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-Math.floor(MAX_EVENTS / 2))));
  }
}

export function logConnectivityDebug(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
): void {
  const event: ConnectivityDebugEvent = {
    sessionId: DEBUG_SESSION_ID,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };

  const next = [...readBuffer(), event];
  writeBuffer(next);

  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[urs-connectivity]', message, data);
  }
}

export function logConnectivityHttpFailure(url: string, hypothesisId = 'H3'): void {
  logConnectivityDebug(hypothesisId, 'auth.interceptor', 'http-status-0', {
    url: sanitizeUrl(url),
    navigatorOnLine: typeof navigator !== 'undefined' ? navigator.onLine : null,
  });
}

export function dumpConnectivityDebug(): ConnectivityDebugEvent[] {
  return readBuffer();
}

declare global {
  interface Window {
    __ursConnectivityDebug?: {
      dump: () => ConnectivityDebugEvent[];
      clear: () => void;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__ursConnectivityDebug = {
    dump: dumpConnectivityDebug,
    clear: () => sessionStorage.removeItem(STORAGE_KEY),
  };
}
