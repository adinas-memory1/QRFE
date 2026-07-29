// order-sync.service.ts
import { Injectable, NgZone, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, of, timer, firstValueFrom } from 'rxjs';
import { take, catchError, filter, map } from 'rxjs/operators';
import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source';
import { environment } from '../../../../environments/environment';
import { SseEvent } from '../../models/sseModel';
import { AuthService } from '../../auth/auth.service';
import { NativeAuthTokenService } from '../../auth/native-auth-token.service';
import { isAssignedRestaurantId, shouldRunRestaurantRealtimeSync } from '../../auth/restaurant-id.util';
import { OfflineSyncSchedulerService } from '../../offline/offline-sync-scheduler.service';
import { OfflineQueueProcessor } from '../../offline/offline-queue-processor.service';
import { OfflineDbService } from '../../offline/offline-db';
import { OnlineStateService } from '../../offline/online-state-service';
import { OfflinePrintContextService } from '../../offline/offline-print-context.service';
import { OfflinePrintConfigDto } from '../../offline/offline-print-config.model';
import { OfflinePolicyService } from '../../offline/offline-policy.service';
import { OfflineSyncLockService } from '../../offline/offline-sync-lock.service';
import { SseConnectivityService } from '../../offline/sse-connectivity.service';
import { RestaurantCurrencyService } from '../../offline/restaurant-currency.service';
import { Capacitor } from '@capacitor/core';
import { agentDebugLog } from '../../debug/agent-debug.logger';

@Injectable({
  providedIn: 'root'
})
export class OrderSyncService {
  private apiUrl = environment.apiUrl;
  private controller: AbortController | null = null;
  private lastRestaurantId: string | null = null;
  private pendingOpenRestaurantId: string | null = null;
  private connectedRestaurantId: string | null = null;
  private readonly tabId = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  /**
   * Same-browser only: Edge tabs share with Edge; Chrome with Chrome.
   * Cross-browser delivery relies on each browser having its own live SSE connection to the API.
   */
  private readonly bc: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('qrfe-internal-sse') : null;

  // reconnect / refresh control
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 8;
  private baseReconnectDelayMs = 1000;
  private isRefreshing = false;
  private syncInProgress = false;
  private snapshotRefreshInProgress = false;
  private lastSnapshotRefreshAt = 0;
  private readonly snapshotRefreshMinIntervalMs = 3000;
  private watermarkSequence = 0;
  /** Last order-sync SSE sequence dispatched to the app (gap detection vs watermark). */
  private lastDispatchedSequence = 0;
  private watermarkDropRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly watermarkDropRefreshDebounceMs = 250;

  // event stream
  private eventsSubject = new Subject<SseEvent<any>>();
  public events$ = this.eventsSubject.asObservable();

  private snapshotRefreshedSubject = new Subject<{ restaurantId: string; activeGuestWaiterCalls: string[] }>();
  /** Emitted after /api/sync snapshot is applied to Dexie (resume, SSE reconnect, etc.). */
  readonly snapshotRefreshed$ = this.snapshotRefreshedSubject.asObservable();

  private readonly reconcilingSubject = new BehaviorSubject(false);
  /** True while post-offline-queue /api/sync reconciliation runs. */
  readonly isReconciling$ = this.reconcilingSubject.asObservable();

  // optional buffering while reconnecting
  private bufferWhileReconnecting = true;
  private eventBuffer: SseEvent<any>[] = [];
  private maxBufferSize = 200;
  private readonly restaurantCurrency = inject(RestaurantCurrencyService);

  private toSseHttpError(status: number, wwwAuthenticate: string | null): Error & { status: number; wwwAuthenticate?: string } {
    const e = new Error(`SSE subscribe failed: HTTP ${status}`) as Error & { status: number; wwwAuthenticate?: string };
    e.status = status;
    if (wwwAuthenticate) e.wwwAuthenticate = wwwAuthenticate;
    return e;
  }

  constructor(private auth: AuthService,
    private nativeAuthTokens: NativeAuthTokenService,
    private ngZone: NgZone,
    private syncScheduler: OfflineSyncSchedulerService,
    private queueProcessor: OfflineQueueProcessor,
    private offlineDB: OfflineDbService,
    private onlineStateService: OnlineStateService,
    private offlinePrintContext: OfflinePrintContextService,
    private offlinePolicy: OfflinePolicyService,
    private offlineSyncLock: OfflineSyncLockService,
    private sseConnectivity: SseConnectivityService,
  ) {
    // Cross-tab fanout: if one tab receives SSE, share it to others.
    this.bc?.addEventListener('message', (ev: MessageEvent) => {
      const msg = ev.data as { sourceTabId?: string; sse?: SseEvent<any> } | null;
      const sse = msg?.sse;
      if (!sse) return;
      if (msg?.sourceTabId && msg.sourceTabId === this.tabId) return; // ignore own echoes
      this.ngZone.run(() => {
        if (sse.EventType === 'RestaurantSyncLocked') {
          this.offlineSyncLock.setRestaurantSyncLocked(true);
          return;
        }
        if (sse.EventType === 'RestaurantSyncUnlocked') {
          this.offlineSyncLock.setRestaurantSyncLocked(false);
          this.offlineSyncLock.setSecondaryAwaitingPrimaryReconnect(false);
          void this.refreshRestaurantSnapshot({ force: true });
          return;
        }
        this.noteDispatchedSequence(sse.Sequence);
        this.eventsSubject.next(sse);
      });
    });

    this.onlineStateService.resumeConnectivityOk$
      .subscribe(() => {
        if (!this.syncScheduler.isReconnectWorkflowActive()) {
          void this.refreshRestaurantSnapshot({ fromResume: true });
        }
        this.flushPendingSseConnection();
      });

    this.onlineStateService.pingOk$.subscribe(() => {
      if (!this.snapshotRefreshInProgress) {
        this.reconcilingSubject.next(false);
      }
      const rid = this.resolveRestaurantId();
      if (rid && !this.controller && this.onlineStateService.isOnline) {
        this.reconnectAttempts = 0;
        this.openConnection(rid);
      }
    });

    if (!Capacitor.isNativePlatform()) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.flushPendingSseConnection();
        }
      });
    }

    this.onlineStateService.online$
      .pipe(filter(isOnline => isOnline))
      .subscribe(() => {
        const rid = this.resolveRestaurantId();
        if (!rid) return;
        if (!this.controller) {
          this.reconnectAttempts = 0;
          this.openConnection(rid);
        }
      });

    // Abort SSE immediately when app goes offline — stops fetchEventSource retry flood.
    this.onlineStateService.online$
      .pipe(filter(isOnline => !isOnline))
      .subscribe(() => {
        this.pendingOpenRestaurantId = this.connectedRestaurantId ?? this.lastRestaurantId;
        this.isRefreshing = false;
        this.reconnectAttempts = 0;
        // close(false) clears streamOpen via reportStreamReconnecting — otherwise ping-lite
        // recovery is ignored forever (isStreamActive stays true while app is offline).
        this.close(false);
      });

    // Stale-watch zombie (or similar): abort stream; only reopen after connectivity probe.
    this.sseConnectivity.forceReconnect$.subscribe(() => {
      const rid = this.connectedRestaurantId ?? this.resolveRestaurantId();
      this.close(false);
      this.reconnectAttempts = 0;
      this.pendingOpenRestaurantId = rid;
      if (!navigator.onLine || !this.onlineStateService.isOnline) {
        return;
      }
      void this.onlineStateService.confirmConnectivity(true).then(ok => {
        if (!ok || !this.onlineStateService.isOnline || !rid || this.controller) {
          return;
        }
        this.openConnection(rid);
      });
    });

    this.queueProcessor.queueDrained$
      .subscribe(() => {
        if (!this.syncScheduler.isReconnectWorkflowActive()) {
          void this.reconcileAfterOfflineSync();
        }
      });

    this.sseConnectivity.scheduleBootstrapConnectivityCheck();
  }

  private resolveRestaurantId(): string | null {
    if (!shouldRunRestaurantRealtimeSync(this.auth.getUserRole())) {
      return null;
    }
    if (this.lastRestaurantId && isAssignedRestaurantId(this.lastRestaurantId)) {
      return this.lastRestaurantId;
    }
    const fromAuth = this.auth.getUserRestaurantId();
    return typeof fromAuth === 'string' && isAssignedRestaurantId(fromAuth) ? fromAuth : null;
  }

  async trySyncNow() {
    if (this.syncInProgress) return;
    if (!this.onlineStateService.isOnline) return;
    this.syncInProgress = true;

    try {
      await this.syncScheduler.runWhenAllowed();
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * After offline queue drain, pull authoritative table state via GET /api/sync (batch).
   * Replaces per-table polling; snapshotRefreshed$ reloads Manage Orders UI.
   */
  async reconcileAfterOfflineSync(): Promise<boolean> {
    const restaurantId = this.resolveRestaurantId();
    if (!restaurantId || !this.onlineStateService.isOnline) {
      return false;
    }
    if (this.reconcilingSubject.value) {
      return false;
    }

    this.reconcilingSubject.next(true);
    try {
      await this.syncRestaurantState(restaurantId, 'reconcileAfterOfflineSync');
      return true;
    } catch (e) {
      console.warn('[OrderSync] reconcileAfterOfflineSync failed', e);
      return false;
    } finally {
      this.reconcilingSubject.next(false);
    }
  }

  /**
   * Pull authoritative restaurant snapshot from GET /api/sync and apply to Dexie.
   * Used when returning from background where SSE events may have been missed.
   */
  async refreshRestaurantSnapshot(options?: { fromResume?: boolean; force?: boolean }): Promise<boolean> {
    const restaurantId = this.resolveRestaurantId();
    if (!restaurantId) {
      return false;
    }
    if (!options?.fromResume && !this.onlineStateService.isOnline) {
      return false;
    }
    const now = Date.now();
    if (!options?.force && now - this.lastSnapshotRefreshAt < this.snapshotRefreshMinIntervalMs) {
      return false;
    }
    if (this.snapshotRefreshInProgress) {
      return false;
    }

    this.snapshotRefreshInProgress = true;
    let succeeded = false;
    try {
      await this.syncRestaurantState(restaurantId, 'refreshRestaurantSnapshot');
      if (!this.controller) {
        this.openConnection(restaurantId);
      }
      succeeded = true;
      return true;
    } catch (e) {
      console.warn('[OrderSync] refreshRestaurantSnapshot failed', e);
      return false;
    } finally {
      this.snapshotRefreshInProgress = false;
      if (succeeded) {
        this.lastSnapshotRefreshAt = Date.now();
      }
    }
  }


  listenToRestaurantEvents<T = any>(restaurantId: string): Observable<SseEvent<T>> {
    if (!isAssignedRestaurantId(restaurantId)) {
      return this.events$ as Observable<SseEvent<T>>;
    }
    // start connection immediately
    this.lastRestaurantId = restaurantId;
    this.openConnection(restaurantId);
    return this.events$ as Observable<SseEvent<T>>;
  }

  close(markOffline = true) {
    if (markOffline) {
      this.sseConnectivity.reportStreamClosed();
    } else {
      this.sseConnectivity.reportStreamReconnecting();
    }
    try {
      console.warn('[SSE][internal] close() called');
      this.controller?.abort();
    } catch { /* ignore */ }
    this.controller = null;
    this.connectedRestaurantId = null;
    this.eventBuffer = [];
  }

  /** PWA tabs defer SSE while hidden; native keeps the stream alive for instant pickup alerts. */
  private deferSseWhileHidden(): boolean {
    if (Capacitor.isNativePlatform()) {
      return false;
    }
    return document.hidden;
  }

  /** Opens deferred SSE after tab/app becomes visible or native network returns. */
  flushPendingSseConnection(): void {
    const rid = this.pendingOpenRestaurantId ?? this.resolveRestaurantId();
    if (!rid || this.controller) {
      return;
    }
    this.openConnection(rid);
  }

  private openConnection(restaurantId: string) {
    // already connected to the same restaurant
    if (this.controller && this.connectedRestaurantId === restaurantId) {
      return;
    }
    if (this.deferSseWhileHidden()) {
      this.pendingOpenRestaurantId = restaurantId;
      return;
    }
    if (!this.onlineStateService.isOnline) {
      this.pendingOpenRestaurantId = restaurantId;
      this.lastRestaurantId = restaurantId;
      return;
    }
    this.pendingOpenRestaurantId = null;
    // ensure single controller/connection (switching restaurants)
    if (this.controller) this.close(false);
    this.controller = new AbortController();
    this.connectedRestaurantId = restaurantId;

    const url = `${this.apiUrl.replace(/\/$/, '')}/sse/internal/restaurant/${restaurantId}`;

    // reset reconnect attempts on manual open
    // (we'll increment on failures)
    // Note: fetchEventSource will keep the connection open until aborted or network error
    fetchEventSource(url, {
      method: 'GET',
      credentials: 'include',
      headers: this.nativeAuthTokens.authHeaders(),
      signal: this.controller.signal,
      /**
       * Default library behaviour aborts SSE while the document is hidden, which drops events
       * with no backfill — bad for Kitchen/Bar when another browser places orders or the tab
       * is in the background. Keep the stream alive whenever possible.
       */
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) {
          const www = response.headers.get('www-authenticate');
          throw this.toSseHttpError(response.status, www);
        }
        const contentType = response.headers.get('content-type');
        if (!contentType?.startsWith(EventStreamContentType)) {
          throw new Error(`SSE expected ${EventStreamContentType}, got: ${contentType ?? 'none'}`);
        }
        this.sseConnectivity.reportStreamOpened();

        // #region agent log
        agentDebugLog('H3', 'order-sync.onopen', 'sse-connected', {
          restaurantId,
          hasBearer: !!this.nativeAuthTokens.getAccessToken(),
        });
        // #endregion

        const reconnectBusy = this.syncScheduler.isReconnectWorkflowActive();
        if (!reconnectBusy) {
          void this.refreshRestaurantSnapshot();
        }

        this.ngZone.run(() => {
          this.reconnectAttempts = 0;
        });
        // Lock status comes from RestaurantSyncLocked/Unlocked SSE; avoid status poll on every reconnect.
      },
      onmessage: (msg) => {
        this.ngZone.run(() => {
          // msg.event comes from SSE "event:" field (if server sets it)
          // msg.data is the SSE "data:" payload (string)
          let raw: any;
          try {
            raw = JSON.parse(msg.data);
          } catch {
            raw = msg.data;
          }

          const EventType = msg.event || raw?.EventType || raw?.event || raw?.type || '';

          this.sseConnectivity.reportStreamActivity(EventType);

          if (EventType === 'ConnectivityPulse') {
            return;
          }

          // support both envelopes:
          // A) { EventType, Data, Sequence, RestaurantId, InitiatedBy }
          // B) payload-only (no wrapper) -> treat raw as Data
          let Data: any = raw?.Data ?? raw?.data ?? raw;
          if (typeof Data === 'string') {
            try { Data = JSON.parse(Data); } catch { /* keep string */ }
          }

          const Sequence = raw?.Sequence ?? raw?.sequence ?? 0;
          const RestaurantId =
            raw?.RestaurantId ??
            raw?.restaurantId ??
            Data?.RestaurantId ??
            Data?.restaurantId ??
            restaurantId;
          const InitiatedBy = raw?.InitiatedBy ?? raw?.initiatedBy ?? 'unknown';

          // ignore "empty" keepalive-like messages
          if (!EventType && (typeof msg.data === 'string') && msg.data.trim() === '') return;

          const sse: SseEvent<any> = { EventType, Data, Sequence, RestaurantId, InitiatedBy };

          if (EventType === 'RestaurantSyncLocked') {
            this.offlineSyncLock.setRestaurantSyncLocked(true);
            try {
              this.bc?.postMessage({ sourceTabId: this.tabId, sse });
            } catch { /* ignore */ }
            return;
          }
          if (EventType === 'RestaurantSyncUnlocked') {
            this.offlineSyncLock.setRestaurantSyncLocked(false);
            this.offlineSyncLock.setSecondaryAwaitingPrimaryReconnect(false);
            void this.refreshRestaurantSnapshot({ force: true });
            try {
              this.bc?.postMessage({ sourceTabId: this.tabId, sse });
            } catch { /* ignore */ }
            return;
          }

          if (Sequence && Sequence < this.watermarkSequence) {
            if (this.isOrderSyncEventType(EventType)) {
              // #region agent log
              agentDebugLog('H3', 'order-sync.onmessage', 'watermark-drop', {
                eventType: EventType,
                sequence: Sequence,
                watermarkSequence: this.watermarkSequence,
              });
              // #endregion
              this.scheduleRefreshAfterWatermarkDrop();
            }
            return;
          }

          if (
            Sequence
            && this.isOrderSyncEventType(EventType)
            && this.lastDispatchedSequence > 0
            && Sequence > this.lastDispatchedSequence + 1
          ) {
            this.scheduleRefreshAfterWatermarkDrop();
          }

          if (this.isRefreshing && this.bufferWhileReconnecting) {
            this.bufferEvent(sse);
          } else {
            if (this.isOrderSyncEventType(EventType)) {
              this.noteDispatchedSequence(Sequence);
            }
            // #region agent log
            agentDebugLog('H3', 'order-sync.onmessage', 'dispatch', {
              eventType: EventType,
              sequence: Sequence,
              watermarkSequence: this.watermarkSequence,
              buffered: false,
            });
            // #endregion
            this.eventsSubject.next(sse);
          }

          // also broadcast to other tabs (best-effort)
          try {
            this.bc?.postMessage({ sourceTabId: this.tabId, sse });
          } catch {
            // ignore
          }
        });
      },
      onerror: (err) => {
        // fetchEventSource retries forever unless onerror throws — stop hard while offline.
        if (!navigator.onLine || !this.onlineStateService.isOnline) {
          this.pendingOpenRestaurantId = restaurantId;
          this.ngZone.run(() => {
            try {
              this.controller?.abort();
            } catch {
              /* ignore */
            }
            this.controller = null;
            this.connectedRestaurantId = null;
          });
          throw err instanceof Error ? err : new Error(String(err ?? 'SSE offline'));
        }

        // fetchEventSource calls onerror on network/auth issues
        console.error('[SSE][internal] error', err);
        const status = (err as { status?: number })?.status;
        const msg = String((err as Error)?.message ?? '');
        const isAuth401 = status === 401 || msg.includes('HTTP 401') || msg.includes('invalid_token');

        // #region agent log
        agentDebugLog('H3', 'order-sync.onerror', 'sse-error', {
          restaurantId,
          status: status ?? null,
          isAuth401,
          message: msg.slice(0, 120),
        });
        // #endregion

        // 401 (expired token) is NOT "offline". Let refresh flow handle it.
        if (!isAuth401) {
          this.sseConnectivity.reportStreamError(isAuth401);
        }
        this.ngZone.run(() => {
          // if server sends a specific auth error payload, you can detect it here
          // fallback: treat any error as potential auth issue and try refresh
          this.handleSseError(restaurantId, err);
        });
      },
      // optional: onclose not provided by fetchEventSource; errors will be routed to onerror
    }).catch(err => {
      // fetchEventSource may reject on abort or fatal errors
      this.ngZone.run(() => this.handleSseError(restaurantId, err));
    });
  }

  private async syncRestaurantState(restaurantId: string, caller = 'unknown'): Promise<void> {
    const url = `${this.apiUrl.replace(/\/$/, '')}/api/sync?restaurantId=${encodeURIComponent(restaurantId)}`;
    let lastError: unknown;
    let refreshedAfter401 = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: this.nativeAuthTokens.authHeaders(),
        });
        if (res.status === 401) {
          if (!refreshedAfter401 && this.onlineStateService.isOnline) {
            refreshedAfter401 = true;
            const refreshed = await this.ensureFreshSession();
            if (refreshed) {
              continue;
            }
          }
          throw new Error('Sync failed: HTTP 401');
        }
        if (!res.ok) {
          throw new Error(`Sync failed: HTTP ${res.status}`);
        }

        const json = await res.json() as any;

        const watermark = json?.Watermark ?? json?.watermark;
        const seq = watermark?.Sequence ?? watermark?.sequence ?? 0;
        if (typeof seq === 'number' && seq > this.watermarkSequence) {
          this.watermarkSequence = seq;
          if (seq > this.lastDispatchedSequence) {
            this.lastDispatchedSequence = seq;
          }
        }

        const tables = (json?.Tables ?? json?.tables ?? []) as any[];
        const activeGuestWaiterCalls = this.parseActiveGuestWaiterCalls(json);
        // Set operating currency before snapshot write so Dexie carts stamp RON/EUR correctly.
        await this.restaurantCurrency.setFromSync(
          restaurantId,
          (json as Record<string, unknown>)['Currency']
          ?? (json as Record<string, unknown>)['currency'],
        );
        await this.offlineDB.applySyncSnapshot(tables as any);
        await this.applyOfflinePrintConfigFromSync(json, restaurantId);
        this.lastSnapshotRefreshAt = Date.now();
        this.ngZone.run(() => {
          this.snapshotRefreshedSubject.next({ restaurantId, activeGuestWaiterCalls });
        });
        return;
      } catch (e) {
        lastError = e;
        const is401 = e instanceof Error && e.message.includes('HTTP 401');
        if (is401) {
          break;
        }
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
    throw lastError;
  }

  private async applyOfflinePrintConfigFromSync(
    json: Record<string, unknown>,
    restaurantId: string,
  ): Promise<void> {
    const raw =
      (json['OfflinePrintConfig'] as OfflinePrintConfigDto | undefined) ??
      (json['offlinePrintConfig'] as OfflinePrintConfigDto | undefined);
    if (!raw) {
      return;
    }
    await this.offlinePrintContext.applyFromSyncSnapshot(raw, restaurantId);
  }

  private parseActiveGuestWaiterCalls(json: Record<string, unknown>): string[] {
    const raw =
      (json['ActiveGuestWaiterCalls'] as unknown) ??
      (json['activeGuestWaiterCalls'] as unknown);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map(v => String(v ?? '').trim())
      .filter(Boolean);
  }

  /** Renew access cookie via refresh-token; shared by /api/sync and SSE reconnect. */
  private async ensureFreshSession(): Promise<boolean> {
    if (!this.onlineStateService.isOnline) {
      return false;
    }
    const user = await firstValueFrom(
      this.auth.refreshUserContext({ redirectOnFailure: false }).pipe(
        catchError(err => {
          console.error('[OrderSync] refreshUserContext failed', err);
          return of(null);
        }),
        map(u => u ?? null),
      ),
    );
    // Only treat an actual refreshed user as success. Still-authenticated + null user means
    // refresh failed transiently — callers schedule reconnect / skip useless 401 retries.
    return user != null;
  }

  private noteDispatchedSequence(sequence: number | undefined): void {
    if (typeof sequence !== 'number' || sequence <= 0) {
      return;
    }
    if (sequence > this.lastDispatchedSequence) {
      this.lastDispatchedSequence = sequence;
    }
  }

  private scheduleRefreshAfterWatermarkDrop(): void {
    if (this.watermarkDropRefreshTimer !== null) {
      return;
    }
    this.watermarkDropRefreshTimer = setTimeout(() => {
      this.watermarkDropRefreshTimer = null;
      void this.refreshRestaurantSnapshot({ force: true });
    }, this.watermarkDropRefreshDebounceMs);
  }

  private isOrderSyncEventType(eventType: string): boolean {
    return eventType === 'OrderUpdated'
      || eventType === 'OrderItemAdded'
      || eventType === 'OrderItemQuantityUpdated'
      || eventType === 'OrderItemDeleted'
      || eventType === 'NewOrderPublicEvent'
      || eventType === 'NewOrderPrivateEvent';
  }

  private bufferEvent(ev: SseEvent<any>) {
    if (this.eventBuffer.length >= this.maxBufferSize) this.eventBuffer.shift();
    this.eventBuffer.push(ev);
  }

  private flushBuffer() {
    if (!this.bufferWhileReconnecting) return;
    while (this.eventBuffer.length) {
      const ev = this.eventBuffer.shift()!;
      this.noteDispatchedSequence(ev.Sequence);
      this.eventsSubject.next(ev);
    }
  }

  private handleSseError(restaurantId: string, err: any) {
    if (this.deferSseWhileHidden()) {
      this.pendingOpenRestaurantId = restaurantId;
      return;
    }
    if (this.isRefreshing) return;

    // Offline: wait for online$ — do not refresh-token or schedule reconnect loops.
    if (!this.onlineStateService.isOnline || !navigator.onLine) {
      this.pendingOpenRestaurantId = restaurantId;
      return;
    }

    // Try to refresh session once, serialized (only when online)
    this.isRefreshing = true;

    void this.ensureFreshSession().then(refreshed => {
      this.isRefreshing = false;

      if (refreshed) {
        // refresh OK -> reopen connection (reset reconnect attempts)
        this.reconnectAttempts = 0;
        // small delay to allow cookies/session to settle
        setTimeout(() => {
          this.openConnection(restaurantId);
          // flush any buffered events after connection established
          // note: openConnection resets reconnectAttempts to onopen
          setTimeout(() => this.flushBuffer(), 300);
        }, 300);
        return;
      }

      // refresh failed without clearing session (network/transient) -> backoff reconnect
      if (this.auth.isAuthenticated()) {
        this.scheduleSseReconnect(restaurantId);
        return;
      }

      // Real auth failure — refreshUserContext already cleared session
      this.close();
      this.eventsSubject.next({ EventType: 'SSE_AUTH_FAILED', Data: null, Sequence: 0, RestaurantId: restaurantId, InitiatedBy: 'system' });
    });
  }

  private scheduleSseReconnect(restaurantId: string) {
    this.reconnectAttempts++;
    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      const delay = Math.min(30000, this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1));
      console.warn(`[OrderSync] scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
      timer(delay).pipe(take(1)).subscribe(() => {
        if (this.deferSseWhileHidden()) {
          this.pendingOpenRestaurantId = restaurantId;
          return;
        }
        if (!this.onlineStateService.isOnline) {
          return;
        }
        this.openConnection(restaurantId);
      });
    } else {
      console.warn('[OrderSync] max reconnect attempts reached, waiting for online');
      this.close();
      this.reconnectAttempts = 0;
    }
  }
}
