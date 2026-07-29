import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { OrderSyncService } from './order-sync.service';
import { AuthService } from '../../auth/auth.service';
import { OfflineSyncSchedulerService } from '../../offline/offline-sync-scheduler.service';
import { OfflineQueueProcessor } from '../../offline/offline-queue-processor.service';
import { OfflineDbService } from '../../offline/offline-db';
import { OnlineStateService } from '../../offline/online-state-service';
import { Observable, Subject, of, firstValueFrom, BehaviorSubject } from 'rxjs';
import { OfflinePolicyService } from '../../offline/offline-policy.service';
import { OfflineSyncLockService } from '../../offline/offline-sync-lock.service';
import { SseConnectivityService } from '../../offline/sse-connectivity.service';
import { UserContextModel } from '../../models/userContextModel';

describe('OrderSyncService', () => {
  let service: OrderSyncService;
  let auth: jasmine.SpyObj<AuthService>;
  let dbSpy: jasmine.SpyObj<OfflineDbService>;
  let resumeConnectivityOk$: Subject<void>;
  let pingOk$: Subject<void>;
  let onlineState: {
    isOnline: boolean;
    setOffline: jasmine.Spy;
    setOnline: jasmine.Spy;
    confirmConnectivity: jasmine.Spy;
    online$: Observable<boolean>;
    resumeConnectivityOk$: Observable<void>;
    pingOk$: Observable<void>;
  };
  let fetchSpy: jasmine.Spy;
  let queueDrained$: Subject<void>;
  let syncSchedulerSpy: jasmine.SpyObj<OfflineSyncSchedulerService>;
  let userSubject: BehaviorSubject<UserContextModel | null>;

  function lastSyncFetchUrl(): string {
    const syncCalls = fetchSpy.calls.all().filter(c => String(c.args[0]).includes('/api/sync'));
    return syncCalls.length ? String(syncCalls[syncCalls.length - 1].args[0]) : '';
  }

  beforeEach(() => {
    auth = jasmine.createSpyObj('AuthService', [
      'refreshUserContext',
      'clearUser',
      'isAuthenticated',
      'getUserRestaurantId',
      'getUserRole',
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.refreshUserContext.and.returnValue(of(null));
    auth.getUserRestaurantId.and.returnValue(null);
    auth.getUserRole.and.returnValue('staff');

    syncSchedulerSpy = jasmine.createSpyObj('OfflineSyncSchedulerService', [
      'runWhenAllowed',
      'isReconnectPending',
      'isReconnectWorkflowActive',
    ]);
    syncSchedulerSpy.runWhenAllowed.and.returnValue(Promise.resolve());
    syncSchedulerSpy.isReconnectPending.and.returnValue(false);
    syncSchedulerSpy.isReconnectWorkflowActive.and.returnValue(false);
    const offlineSyncLockSpy = jasmine.createSpyObj('OfflineSyncLockService', [
      'setRestaurantSyncLocked',
      'beginSync',
      'completeSync',
    ]);
    Object.defineProperty(offlineSyncLockSpy, 'restaurantSyncLocked$', {
      value: new BehaviorSubject(false).asObservable(),
    });
    Object.defineProperty(offlineSyncLockSpy, 'secondaryAwaitingPrimaryReconnect$', {
      value: new BehaviorSubject(false).asObservable(),
    });
    userSubject = new BehaviorSubject<UserContextModel | null>({
      id: 'u1',
      role: 'staff',
      isOfflinePrimaryDevice: true,
    });
    queueDrained$ = new Subject<void>();
    dbSpy = jasmine.createSpyObj('OfflineDbService', [
      'getPendingActions',
      'getPendingActionsForRestaurant',
      'markActionDone',
      'setOffline',
      'applySyncSnapshot',
    ]);
    dbSpy.getPendingActions.and.returnValue(Promise.resolve([]));
    dbSpy.getPendingActionsForRestaurant.and.returnValue(Promise.resolve([]));
    dbSpy.applySyncSnapshot.and.returnValue(Promise.resolve());

    resumeConnectivityOk$ = new Subject<void>();
    pingOk$ = new Subject<void>();
    onlineState = {
      isOnline: true,
      setOffline: jasmine.createSpy('setOffline'),
      setOnline: jasmine.createSpy('setOnline'),
      confirmConnectivity: jasmine.createSpy('confirmConnectivity').and.resolveTo(true),
      online$: of(true),
      resumeConnectivityOk$: resumeConnectivityOk$.asObservable(),
      pingOk$: pingOk$.asObservable(),
    };

    fetchSpy = jasmine.createSpy('fetch').and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ Watermark: { Sequence: 12 }, Tables: [{ tableId: 't1' }] }),
      }),
    );
    spyOn(window, 'fetch').and.callFake(fetchSpy);

    TestBed.configureTestingModule({
      providers: [
        OrderSyncService,
        OfflinePolicyService,
        { provide: AuthService, useValue: { ...auth, user$: userSubject.asObservable() } },
        { provide: OfflineSyncSchedulerService, useValue: syncSchedulerSpy },
        { provide: OfflineSyncLockService, useValue: offlineSyncLockSpy },
        { provide: OfflineQueueProcessor, useValue: { queueDrained$: queueDrained$.asObservable() } },
        { provide: OfflineDbService, useValue: dbSpy },
        { provide: OnlineStateService, useValue: onlineState },
        {
          provide: SseConnectivityService,
          useValue: {
            ...jasmine.createSpyObj('SseConnectivityService', [
              'reportStreamOpened',
              'reportStreamActivity',
              'reportStreamError',
              'reportStreamClosed',
              'scheduleBootstrapConnectivityCheck',
            ]),
            forceReconnect$: new Subject<void>().asObservable(),
          },
        },
      ],
    });

    service = TestBed.inject(OrderSyncService);
    spyOn(service, 'close').and.stub();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('handleSseError when backend is down', () => {
    beforeEach(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    });

    it('does not call refreshUserContext when already offline', () => {
      onlineState.isOnline = false;

      (service as any).handleSseError('restaurant-1', new Error('SSE subscribe failed: HTTP 504'));

      expect(auth.refreshUserContext).not.toHaveBeenCalled();
      expect(auth.clearUser).not.toHaveBeenCalled();
    });

    it('schedules reconnect without clearing session when offline', fakeAsync(() => {
      onlineState.isOnline = false;
      spyOn(service as any, 'openConnection').and.stub();

      (service as any).handleSseError('restaurant-1', new Error('network'));
      tick(1000);

      expect(auth.refreshUserContext).not.toHaveBeenCalled();
      expect(auth.clearUser).not.toHaveBeenCalled();
    }));

    it('does not clear user after max reconnect attempts while offline', () => {
      onlineState.isOnline = false;
      (service as any).reconnectAttempts = 8;
      (service as any).maxReconnectAttempts = 8;

      (service as any).scheduleSseReconnect('restaurant-1');

      expect(auth.clearUser).not.toHaveBeenCalled();
      expect(service.close).toHaveBeenCalled();
    });

    it('on transient refresh failure while authenticated, schedules reconnect instead of logout', fakeAsync(() => {
      onlineState.isOnline = true;
      auth.refreshUserContext.and.returnValue(of(null));
      auth.isAuthenticated.and.returnValue(true);
      spyOn(service as any, 'scheduleSseReconnect').and.callThrough();

      (service as any).handleSseError('restaurant-1', new Error('SSE error'));
      tick();

      expect(auth.refreshUserContext).toHaveBeenCalledWith({ redirectOnFailure: false });
      expect(auth.clearUser).not.toHaveBeenCalled();
      expect((service as any).scheduleSseReconnect).toHaveBeenCalledWith('restaurant-1');
    }));
  });

  describe('refreshRestaurantSnapshot', () => {
    beforeEach(() => {
      (service as any).lastRestaurantId = 'restaurant-1';
      spyOn(service as any, 'openConnection').and.stub();
    });

    it('calls /api/sync, applies snapshot, and emits snapshotRefreshed$', async () => {
      const emitted = firstValueFrom(service.snapshotRefreshed$);

      const ok = await service.refreshRestaurantSnapshot();

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
      expect(lastSyncFetchUrl()).toContain('/api/sync?restaurantId=restaurant-1');
      expect(dbSpy.applySyncSnapshot).toHaveBeenCalled();
      const tablesArg = dbSpy.applySyncSnapshot.calls.mostRecent().args[0] as { tableId: string }[];
      expect(tablesArg[0]?.tableId).toBe('t1');
      await expectAsync(emitted).toBeResolvedTo({ restaurantId: 'restaurant-1', activeGuestWaiterCalls: [] });
    });

    it('returns false when offline without fromResume', async () => {
      onlineState.isOnline = false;

      const ok = await service.refreshRestaurantSnapshot();

      expect(ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('syncs from resume even when isOnline flag is false', async () => {
      onlineState.isOnline = false;

      const ok = await service.refreshRestaurantSnapshot({ fromResume: true });

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('falls back to auth restaurantId when lastRestaurantId is null', async () => {
      (service as any).lastRestaurantId = null;
      auth.getUserRestaurantId.and.returnValue('auth-restaurant-id');

      const ok = await service.refreshRestaurantSnapshot({ fromResume: true });

      expect(ok).toBe(true);
      expect(lastSyncFetchUrl()).toContain('restaurantId=auth-restaurant-id');
    });

    it('returns false when no restaurant id', async () => {
      (service as any).lastRestaurantId = null;
      auth.getUserRestaurantId.and.returnValue(null);

      const ok = await service.refreshRestaurantSnapshot();

      expect(ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips duplicate refresh within min interval', async () => {
      const ok1 = await service.refreshRestaurantSnapshot();
      const ok2 = await service.refreshRestaurantSnapshot();

      expect(ok1).toBe(true);
      expect(ok2).toBe(false);
      expect(fetchSpy.calls.all().filter(c => String(c.args[0]).includes('/api/sync')).length).toBe(1);
    });

    it('force refresh bypasses min interval', async () => {
      await service.refreshRestaurantSnapshot();
      const ok = await service.refreshRestaurantSnapshot({ force: true });

      expect(ok).toBe(true);
      expect(fetchSpy.calls.all().filter(c => String(c.args[0]).includes('/api/sync')).length).toBe(2);
    });

    it('runs sync after resumeConnectivityOk$', async () => {
      (service as any).lastRestaurantId = 'restaurant-1';
      const refreshSpy = spyOn(service, 'refreshRestaurantSnapshot').and.returnValue(Promise.resolve(true));

      resumeConnectivityOk$.next();
      await Promise.resolve();

      expect(refreshSpy).toHaveBeenCalledWith({ fromResume: true });
    });

    it('on 401 refreshes session and retries /api/sync', async () => {
      const user = { id: '1', role: 'staff', restaurantId: 'restaurant-1', restaurantName: 'R', restaurantType: 'Small' };
      auth.refreshUserContext.and.returnValue(of(user));

      let syncAttempt = 0;
      fetchSpy.and.callFake((input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/api/sync')) {
          syncAttempt++;
          if (syncAttempt === 1) {
            return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ Watermark: { Sequence: 3 }, Tables: [] }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      const ok = await service.refreshRestaurantSnapshot({ force: true });

      expect(ok).toBe(true);
      expect(auth.refreshUserContext).toHaveBeenCalledWith({ redirectOnFailure: false });
      expect(syncAttempt).toBe(2);
      expect(dbSpy.applySyncSnapshot).toHaveBeenCalled();
    });

    it('on 401 without successful refresh returns false', async () => {
      auth.refreshUserContext.and.returnValue(of(null));

      fetchSpy.and.returnValue(
        Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
      );

      const ok = await service.refreshRestaurantSnapshot({ force: true });

      expect(ok).toBe(false);
      expect(auth.refreshUserContext).toHaveBeenCalledWith({ redirectOnFailure: false });
      expect(fetchSpy.calls.all().filter(c => String(c.args[0]).includes('/api/sync')).length).toBe(1);
      expect(dbSpy.applySyncSnapshot).not.toHaveBeenCalled();
    });

    it('on 401 while offline does not call refreshUserContext', async () => {
      onlineState.isOnline = false;

      fetchSpy.and.returnValue(
        Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
      );

      const ok = await service.refreshRestaurantSnapshot({ fromResume: true });

      expect(ok).toBe(false);
      expect(auth.refreshUserContext).not.toHaveBeenCalled();
    });

    it('fromResume on non-primary skips scheduler but still calls /api/sync', async () => {
      userSubject.next({
        id: 'u1',
        role: 'staff',
        isOfflinePrimaryDevice: false,
      });
      syncSchedulerSpy.isReconnectPending.and.returnValue(true);
      dbSpy.getPendingActionsForRestaurant.and.returnValue(Promise.resolve([{ id: 'a1' } as never]));

      const ok = await service.refreshRestaurantSnapshot({ fromResume: true, force: true });

      expect(ok).toBe(true);
      expect(syncSchedulerSpy.runWhenAllowed).not.toHaveBeenCalled();
      expect(lastSyncFetchUrl()).toContain('/api/sync?restaurantId=restaurant-1');
    });
  });

  describe('reconcileAfterOfflineSync', () => {
    beforeEach(() => {
      (service as any).lastRestaurantId = 'restaurant-1';
    });

    it('pulls /api/sync and applies snapshot', async () => {
      const emitted = firstValueFrom(service.snapshotRefreshed$);

      const ok = await service.reconcileAfterOfflineSync();

      expect(ok).toBe(true);
      expect(lastSyncFetchUrl()).toContain('/api/sync?restaurantId=restaurant-1');
      expect(dbSpy.applySyncSnapshot).toHaveBeenCalled();
      await expectAsync(emitted).toBeResolvedTo({ restaurantId: 'restaurant-1', activeGuestWaiterCalls: [] });
    });

    it('runs when offline queue drain emits', async () => {
      fetchSpy.calls.reset();
      dbSpy.applySyncSnapshot.calls.reset();

      queueDrained$.next();
      await new Promise<void>(resolve => setTimeout(resolve, 0));

      expect(lastSyncFetchUrl()).toContain('/api/sync?restaurantId=restaurant-1');
      expect(dbSpy.applySyncSnapshot).toHaveBeenCalled();
    });

    it('clears reconciling flag on pingOk$ when snapshot refresh is not in progress', async () => {
      (service as any).reconcilingSubject.next(true);
      pingOk$.next();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      expect(await firstValueFrom(service.isReconciling$)).toBeFalse();
    });
  });
});
