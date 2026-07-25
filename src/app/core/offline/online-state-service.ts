import { Injectable, inject, Injector } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SseConnectivityService } from './sse-connectivity.service';
import { logConnectivityDebug } from './connectivity-debug.logger';

function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.() === true
  );
}

/** Gateway/proxy blips during SSE zombie recovery — not true offline when browser is online. */
function isTransientGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

@Injectable({ providedIn: 'root' })
export class OnlineStateService {
  private readonly injector = inject(Injector);
  private _isOnline = true;
  get isOnline() { return this._isOnline; }
  private apiUrl = environment.apiUrl;

  private onlineSubject = new BehaviorSubject<boolean>(true);
  readonly online$ = this.onlineSubject.asObservable();

  private resumeConnectivitySubject = new Subject<void>();
  /** After connectivity confirmed on resume (tab visible / app foreground). */
  readonly resumeConnectivityOk$ = this.resumeConnectivitySubject.asObservable();

  private readonly pingOkSubject = new Subject<void>();
  /** Emits when connectivity is confirmed (SSE pulse or bootstrap ping-lite). */
  readonly pingOk$ = this.pingOkSubject.asObservable();

  private heartbeatInProgress: Promise<boolean> | null = null;

  private resumeCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resumeCheckDebounceMs = 300;
  private lastResumePipelineAt = 0;
  private readonly resumePipelineCooldownMs = 3000;
  private lastForcedPingAt = 0;
  private readonly forcedPingMinIntervalMs = 2000;
  private resumeCheckInProgress = false;
  private supplementalHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Fast offline/online detection alongside SSE pulse (max ~10s when API stops). */
  private readonly supplementalHeartbeatMs = 5_000;

  constructor() {
    window.addEventListener('online', () => {
      // Bypass cooldown so recovery is not stuck after a recent failed ping.
      this.lastForcedPingAt = 0;
      void this.confirmConnectivity(true);
    });

    window.addEventListener('offline', () => {
      logConnectivityDebug('H5', 'online-state-service', 'browser-offline-event', {});
      // Do not ping while DNS/network is down — that floods DevTools with ERR_NAME_NOT_RESOLVED.
      this.setOffline('browser-offline');
    });

    if (!isCapacitorNative()) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.triggerResumeCheck();
        }
      });
    }

    this.startSupplementalHeartbeat();
  }

  private startSupplementalHeartbeat(): void {
    if (this.supplementalHeartbeatTimer !== null) {
      return;
    }
    this.supplementalHeartbeatTimer = setInterval(() => {
      // Truly offline (browser): do not flood DNS failures.
      if (!navigator.onLine) {
        return;
      }
      // App offline but browser online: keep probing so we can recover (ping-lite-error path).
      if (this._isOnline && this.injector.get(SseConnectivityService).isStreamActive()) {
        return;
      }
      void this.confirmConnectivity(!this._isOnline);
    }, this.supplementalHeartbeatMs);
  }

  /** Debounced resume entry (PWA Alt+Tab, Capacitor appStateChange). */
  triggerResumeCheck(): void {
    if (this.resumeCheckTimer) {
      clearTimeout(this.resumeCheckTimer);
    }
    this.resumeCheckTimer = setTimeout(() => {
      this.resumeCheckTimer = null;
      void this.runResumeCheck();
    }, this.resumeCheckDebounceMs);
  }

  private async runResumeCheck(): Promise<void> {
    const now = Date.now();
    if (now - this.lastResumePipelineAt < this.resumePipelineCooldownMs) {
      return;
    }
    if (this.resumeCheckInProgress) {
      return;
    }

    this.resumeCheckInProgress = true;
    this.lastResumePipelineAt = now;

    try {
      const ok = await this.confirmConnectivity(true);
      if (!ok) {
        return;
      }
      this.resumeConnectivitySubject.next();
    } finally {
      this.resumeCheckInProgress = false;
    }
  }

  /** Bootstrap ping-lite before SSE is connected. Returns true when server responds OK. */
  async confirmConnectivity(force = false): Promise<boolean> {
    if (!navigator.onLine) {
      this.setOffline('navigator-offline');
      return false;
    }

    const now = Date.now();

    if (force && this._isOnline && now - this.lastForcedPingAt < this.forcedPingMinIntervalMs) {
      return this._isOnline;
    }

    if (this.heartbeatInProgress) {
      return this.heartbeatInProgress;
    }

    if (force) {
      this.lastForcedPingAt = now;
    }

    this.heartbeatInProgress = this.executePing();
    return this.heartbeatInProgress;
  }

  private async executePing(): Promise<boolean> {
    const pingUrl = `${this.apiUrl}/api/ping-lite`;
    const startedAt = Date.now();
    const sseConnectivity = this.injector.get(SseConnectivityService);
    const streamActiveBefore = sseConnectivity.isStreamActive();
    logConnectivityDebug('H1', 'online-state-service.executePing', 'ping-start', {
      streamActive: streamActiveBefore,
      appOnline: this._isOnline,
      navigatorOnLine: navigator.onLine,
      timeoutMs: 3000,
    });
    try {
      const hasAbortTimeout =
        typeof AbortSignal !== 'undefined' &&
        typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === 'function';

      const res = await fetch(pingUrl, {
        method: 'HEAD',
        cache: 'no-store',
        ...(hasAbortTimeout ? { signal: AbortSignal.timeout(3000) } : {}),
      });
      const ok = res.ok || res.status < 500;
      const streamActive = sseConnectivity.isStreamActive();
      logConnectivityDebug('H1', 'online-state-service.executePing', 'ping-end', {
        ok,
        status: res.status,
        durationMs: Date.now() - startedAt,
        streamActive,
        appOnlineBefore: this._isOnline,
      });
      // Recovery: successful ping must mark online even if SSE flag is stale after abort.
      if (ok && !this._isOnline) {
        this.notifyConnectivityPulse();
        sseConnectivity.reportPingSuccess();
        return true;
      }
      if (streamActive) {
        return ok;
      }
      if (ok) {
        this.notifyConnectivityPulse();
        sseConnectivity.reportPingSuccess();
      } else if (isTransientGatewayStatus(res.status) && navigator.onLine) {
        logConnectivityDebug('H5', 'online-state-service.executePing', 'ping-transient-gateway', {
          status: res.status,
          streamActive,
          appOnlineBefore: this._isOnline,
        });
      } else {
        sseConnectivity.reportPingFailed('ping-lite-fail');
      }
      return ok;
    } catch (err) {
      const streamActive = sseConnectivity.isStreamActive();
      const errName = err instanceof Error ? err.name : 'unknown';
      logConnectivityDebug('H1', 'online-state-service.executePing', 'ping-error', {
        errName,
        durationMs: Date.now() - startedAt,
        streamActive,
        appOnlineBefore: this._isOnline,
        willReportFailed: !streamActive,
      });
      if (!streamActive) {
        sseConnectivity.reportPingFailed('ping-lite-error');
      }
      return false;
    } finally {
      this.heartbeatInProgress = null;
    }
  }

  notifyConnectivityPulse(): void {
    this.pingOkSubject.next();
  }

  setOfflineFromConnectivitySource(reason?: string): void {
    this.setOffline(reason);
  }

  setOnlineFromConnectivitySource(reason?: string): void {
    this.setOnline(reason);
  }

  setOffline(reason?: string): void {
    if (!this._isOnline) return;
    logConnectivityDebug('H2', 'online-state-service.setOffline', 'transition-offline', {
      reason: reason ?? 'unknown',
      navigatorOnLine: navigator.onLine,
    });
    this._isOnline = false;
    this.onlineSubject.next(false);
  }

  setOnline(reason?: string): void {
    if (this._isOnline) return;
    logConnectivityDebug('H2', 'online-state-service.setOnline', 'transition-online', {
      reason: reason ?? 'unknown',
      navigatorOnLine: navigator.onLine,
    });
    this._isOnline = true;
    this.onlineSubject.next(true);
  }
}
