import { TestBed } from '@angular/core/testing';
import { OfflineSyncLockService } from './offline-sync-lock.service';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import { environment } from '../../../environments/environment';
import { ClientInstanceService } from '../services/device/client-instance.service';
import { CLIENT_INSTANCE_HEADER } from '../interceptors/client-instance.interceptor';
import { OnlineStateService } from './online-state-service';

describe('OfflineSyncLockService', () => {
  let service: OfflineSyncLockService;
  let httpMock: HttpTestingController;
  const apiUrl = environment.apiUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        OfflineSyncLockService,
        {
          provide: AuthService,
          useValue: {
            getUserSnapshot: () => ({ restaurantId: 'rest-1', role: 'manager' }),
            getUserRestaurantId: () => 'rest-1',
            getUserRole: () => 'manager',
          },
        },
        {
          provide: ClientInstanceService,
          useValue: { whenReady: () => Promise.resolve('test-device-id') },
        },
        {
          provide: OnlineStateService,
          useValue: { isOnline: true },
        },
      ],
    });

    service = TestBed.inject(OfflineSyncLockService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('setRestaurantSyncLocked updates observable', () => {
    const values: boolean[] = [];
    service.restaurantSyncLocked$.subscribe(v => values.push(v));
    service.setRestaurantSyncLocked(true);
    service.setRestaurantSyncLocked(false);
    expect(values).toEqual([false, true, false]);
  });

  it('beginSync marks restaurant locked locally', async () => {
    const promise = service.beginSync();
    await Promise.resolve();
    const req = httpMock.expectOne(r => r.url === `${apiUrl}/api/offline-sync/begin`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get(CLIENT_INSTANCE_HEADER)).toBe('test-device-id');
    req.flush({ acquired: true });
    await expectAsync(promise).toBeResolvedTo(true);
    expect(service.isRestaurantSyncLocked()).toBeTrue();
  });

  it('completeSync clears local lock state', async () => {
    service.setRestaurantSyncLocked(true);
    (service as unknown as { localLockHeld: boolean }).localLockHeld = true;

    const promise = service.completeSync();
    await Promise.resolve();
    const req = httpMock.expectOne(r => r.url === `${apiUrl}/api/offline-sync/complete`);
    req.flush({ released: true });
    await expectAsync(promise).toBeResolvedTo(true);
    expect(service.isRestaurantSyncLocked()).toBeFalse();
  });

  it('refreshStatus does not clear secondary awaiting when unlocked', async () => {
    service.setSecondaryAwaitingPrimaryReconnect(true);
    const promise = service.refreshStatus();
    const req = httpMock.expectOne(r => r.url === `${apiUrl}/api/offline-sync/status`);
    req.flush({ locked: false });
    await promise;
    expect(service.isSecondaryAwaitingPrimaryReconnect()).toBeTrue();
  });
});
