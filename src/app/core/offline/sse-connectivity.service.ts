import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Subject } from 'rxjs';
import { OnlineStateService } from './online-state-service';
import { logConnectivityDebug } from './connectivity-debug.logger';

/** Must stay aligned with SSEController KeepAliveLoop delay (seconds) + grace. */
export const SSE_PULSE_INTERVAL_MS = 5_000;
export const SSE_STALE_GRACE_MS = 1_000;
/** Allow one missed pulse before offline (2× interval + grace). */
export const STALE_THRESHOLD_MS = SSE_PULSE_INTERVAL_MS * 2 + SSE_STALE_GRACE_MS;
const STALE_WATCH_INTERVAL_MS = 1_000;
const OFFLINE_DEBOUNCE_MS = 2_000;
const FAST_OFFLINE_DEBOUNCE_MS = 500;

@Injectable({ providedIn: 'root' })
export class SseConnectivityService {
  private readonly onlineState = inject(OnlineStateService);

  private lastActivityAt = 0;
  private lastPulseAt = 0;
  private streamOpen = false;
  private sseReconnecting = false;
  private offlineDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private staleWatchTimer: ReturnType<typeof setInterval> | null = null;
  private bootstrapFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * fetch()-based SSE (fetch-event-source) can go "zombie" on some mobile network transitions:
   * the underlying stream stops yielding data but never fires onerror/close, so streamOpen stays
   * true forever while no pulses arrive. The stale-watch below is the only thing that can detect
   * this (via pulse age) — when it does, force the consumer to abort + recreate the connection
   * instead of just flipping isOnline and passively waiting for the dead stream to notice itself.
   */
  private readonly forceReconnectSubject = new Subject<void>();
  readonly forceReconnect$ = this.forceReconnectSubject.asObservable();

  constructor() {
    this.startStaleWatch();
  }

  /** True when the restaurant SSE stream is open — ping-lite must not drive online/offline. */
  isStreamActive(): boolean {
    return this.streamOpen;
  }

  reportStreamOpened(): void {
    this.sseReconnecting = false;
    this.streamOpen = true;
    this.lastActivityAt = Date.now();
    this.lastPulseAt = this.lastActivityAt;
    this.clearOfflineDebounce();
    this.clearBootstrapFallback();
    this.onlineState.setOnlineFromConnectivitySource();
    this.onlineState.notifyConnectivityPulse();
  }

  reportStreamActivity(_eventType?: string): void {
    if (!this.streamOpen) {
      return;
    }
    if (_eventType === 'reconnect-check') {
      return;
    }
    const isPulse = _eventType === 'ConnectivityPulse';
    if (isPulse) {
      this.lastPulseAt = Date.now();
      this.lastActivityAt = this.lastPulseAt;
      if (!this.onlineState.isOnline) {
        this.clearOfflineDebounce();
        this.onlineState.setOnlineFromConnectivitySource();
      }
      this.onlineState.notifyConnectivityPulse();
      return;
    }
    this.lastActivityAt = Date.now();
  }

  reportStreamError(isAuth401: boolean): void {
    if (isAuth401 || this.sseReconnecting) {
      return;
    }
    const pulseFresh =
      this.lastPulseAt > 0 && Date.now() - this.lastPulseAt < STALE_THRESHOLD_MS;
    if (this.streamOpen && pulseFresh) {
      return;
    }
    if (this.lastPulseAt === 0) {
      return;
    }
    this.scheduleOffline('sse-error');
  }

  /** Intentional SSE reconnect — do not mark offline until the new stream opens or errors. */
  reportStreamReconnecting(): void {
    this.sseReconnecting = true;
    this.streamOpen = false;
    this.clearOfflineDebounce();
  }

  reportStreamClosed(): void {
    const hadSuccessfulStream = this.lastPulseAt > 0;
    this.streamOpen = false;
    if (this.sseReconnecting) {
      return;
    }
    if (!hadSuccessfulStream) {
      return;
    }
    this.scheduleOffline('sse-closed');
  }

  reportHttpNetworkFailure(): void {
    const pulseAge = this.lastPulseAt > 0 ? Date.now() - this.lastPulseAt : null;
    logConnectivityDebug('H3', 'sse-connectivity.reportHttpNetworkFailure', 'http-network-failure', {
      streamOpen: this.streamOpen,
      pulseAgeMs: pulseAge,
      appOnline: this.onlineState.isOnline,
      native: Capacitor.isNativePlatform(),
    });
    // Android background: unrelated API calls (lock poll, sync) fail while SSE is still healthy.
    if (this.streamOpen && Capacitor.isNativePlatform()) {
      const pulseAge = this.lastPulseAt > 0 ? Date.now() - this.lastPulseAt : Number.POSITIVE_INFINITY;
      if (pulseAge < STALE_THRESHOLD_MS) {
        return;
      }
    }
    this.scheduleOffline('http-network');
  }

  /** Fallback when SSE is not yet connected (login, pre-restaurant). */
  scheduleBootstrapConnectivityCheck(delayMs = 3_000): void {
    this.clearBootstrapFallback();
    this.bootstrapFallbackTimer = setTimeout(() => {
      this.bootstrapFallbackTimer = null;
      if (!this.streamOpen && !this.onlineState.isOnline) {
        void this.onlineState.confirmConnectivity(true);
      }
    }, delayMs);
  }

  requestReconnectCheck(): void {
    if (this.streamOpen) {
      this.reportStreamActivity('reconnect-check');
      return;
    }
    void this.onlineState.confirmConnectivity(true);
  }

  reportNativeNetworkAvailable(): void {
    if (this.streamOpen) {
      this.requestReconnectCheck();
      return;
    }
    void this.onlineState.confirmConnectivity(true);
  }

  reportNativeNetworkLost(): void {
    this.scheduleOffline('native-network-lost');
  }

  /** Ping-lite failed — only when SSE is not active (bootstrap / pre-stream). */
  reportPingFailed(reason: string): void {
    logConnectivityDebug('H4', 'sse-connectivity.reportPingFailed', 'ping-failed', {
      reason,
      streamOpen: this.streamOpen,
      appOnline: this.onlineState.isOnline,
      pulseAgeMs: this.lastPulseAt > 0 ? Date.now() - this.lastPulseAt : null,
    });
    if (this.streamOpen) {
      return;
    }
    this.onlineState.setOfflineFromConnectivitySource(reason);
  }

  /** Ping-lite succeeded — only when SSE is not active. */
  reportPingSuccess(): void {
    // Stale streamOpen after offline abort must not block recovery.
    if (this.streamOpen && this.onlineState.isOnline) {
      return;
    }
    if (this.streamOpen) {
      this.streamOpen = false;
    }
    this.clearOfflineDebounce();
    this.onlineState.setOnlineFromConnectivitySource('ping-lite-ok');
  }

  private scheduleOffline(reason: string): void {
    logConnectivityDebug('H2', 'sse-connectivity.scheduleOffline', 'offline-scheduled', {
      reason,
      streamOpen: this.streamOpen,
      pulseAgeMs: this.lastPulseAt > 0 ? Date.now() - this.lastPulseAt : null,
      appOnline: this.onlineState.isOnline,
      debouncePending: this.offlineDebounceTimer !== null,
    });
    if (this.onlineState.isOnline === false && reason === 'stale-watch') {
      // Already offline: still clear zombie streamOpen so ping-lite can restore online.
      if (this.streamOpen) {
        this.streamOpen = false;
      }
      return;
    }
    const debounceMs = this.offlineDebounceMsFor(reason);
    if (this.offlineDebounceTimer !== null) {
      return;
    }
    this.offlineDebounceTimer = setTimeout(() => {
      this.offlineDebounceTimer = null;
      const pulseStale = this.lastPulseAt > 0 && Date.now() - this.lastPulseAt > STALE_THRESHOLD_MS;
      const pulseAgeMs = this.lastPulseAt > 0 ? Date.now() - this.lastPulseAt : null;
      const zombieStream = pulseStale && this.streamOpen;
      const stale = !this.streamOpen || pulseStale;
      logConnectivityDebug('H2', 'sse-connectivity.scheduleOffline', 'offline-debounce-fired', {
        reason,
        pulseAgeMs,
        pulseStale,
        streamOpen: this.streamOpen,
        zombieStream,
        stale,
        appOnline: this.onlineState.isOnline,
      });
      if (zombieStream) {
        // Abort zombie stream without marking offline (mutation-driven offline).
        // Consumer must not blindly reopen — ping/online first (see forceReconnect$ handler).
        this.streamOpen = false;
        this.forceReconnectSubject.next();
        return;
      }
      if (reason === 'http-network' || reason === 'native-network-lost') {
        this.onlineState.setOfflineFromConnectivitySource(reason);
        return;
      }
      if (stale) {
        this.onlineState.setOfflineFromConnectivitySource(reason);
      }
    }, debounceMs);
  }

  private offlineDebounceMsFor(reason: string): number {
    if (reason === 'http-network' || reason === 'native-network-lost' || reason === 'stale-watch') {
      return 0;
    }
    if (reason === 'sse-error' || reason === 'sse-closed') {
      return FAST_OFFLINE_DEBOUNCE_MS;
    }
    return OFFLINE_DEBOUNCE_MS;
  }

  private clearOfflineDebounce(): void {
    if (this.offlineDebounceTimer !== null) {
      clearTimeout(this.offlineDebounceTimer);
      this.offlineDebounceTimer = null;
    }
  }

  private clearBootstrapFallback(): void {
    if (this.bootstrapFallbackTimer !== null) {
      clearTimeout(this.bootstrapFallbackTimer);
      this.bootstrapFallbackTimer = null;
    }
  }

  private startStaleWatch(): void {
    if (this.staleWatchTimer !== null) {
      return;
    }
    this.staleWatchTimer = setInterval(() => {
      if (!this.streamOpen || this.lastPulseAt === 0) {
        return;
      }
      if (Date.now() - this.lastPulseAt > STALE_THRESHOLD_MS) {
        this.scheduleOffline('stale-watch');
      }
    }, STALE_WATCH_INTERVAL_MS);
  }
}
