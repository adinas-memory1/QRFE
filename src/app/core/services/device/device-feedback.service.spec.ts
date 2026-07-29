import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { DeviceFeedbackService } from './device-feedback.service';
import { ClientInstanceService } from './client-instance.service';
import { RuntimePlatformService } from '../../platform/runtime-platform.service';

describe('DeviceFeedbackService', () => {
  let service: DeviceFeedbackService;
  let localId: string;
  let vibrateSpy: jasmine.Spy;

  beforeEach(() => {
    localId = 'test-client-instance-id';
    vibrateSpy = jasmine.createSpy('vibrate');

    TestBed.configureTestingModule({
      providers: [
        DeviceFeedbackService,
        {
          provide: ClientInstanceService,
          useValue: {
            getId: () => localId,
            isAvailable: () => true,
            whenReady: () => Promise.resolve(localId),
          },
        },
        {
          provide: RuntimePlatformService,
          useValue: {
            capabilities: { hapticsBackend: 'vibrate' },
          },
        },
      ],
    });

    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrateSpy,
    });

    service = TestBed.inject(DeviceFeedbackService);
  });

  it('vibrates when client instance id matches', fakeAsync(() => {
    service.notifyPickupReady('kitchen', {
      tableId: 'table-1',
      clientInstanceId: localId,
    });
    flushMicrotasks();
    expect(vibrateSpy).toHaveBeenCalledWith(500);
  }));

  it('does not vibrate when client instance id differs', () => {
    service.notifyPickupReady('bar', {
      tableId: 'table-1',
      clientInstanceId: 'other-device',
    });
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it('does not vibrate when client instance id is missing', () => {
    service.notifyPickupReady('kitchen', {
      tableId: 'table-1',
      clientInstanceId: null,
    });
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it('debounces repeat pickup for same table', fakeAsync(() => {
    service.notifyPickupReady('kitchen', { tableId: 'table-1', clientInstanceId: localId });
    flushMicrotasks();
    service.notifyPickupReady('kitchen', { tableId: 'table-1', clientInstanceId: localId });
    flushMicrotasks();
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
  }));

  it('notifyPickupFromPush vibrates only for matching client instance', fakeAsync(() => {
    service.notifyPickupFromPush('kitchen', 'table-k', localId);
    flushMicrotasks();
    expect(vibrateSpy).toHaveBeenCalledWith(500);
    vibrateSpy.calls.reset();
    service.notifyPickupFromPush('kitchen', 'table-k', 'other-device');
    flushMicrotasks();
    expect(vibrateSpy).not.toHaveBeenCalled();
  }));

  it('pulsePickup returns true when navigator vibrate succeeds', async () => {
    const ok = await service.pulsePickup('bar', 'table-x', 'test');
    expect(ok).toBeTrue();
    expect(vibrateSpy).toHaveBeenCalledWith(500);
  });

  it('pulsePickup debounces kitchen and bar on same table independently', fakeAsync(() => {
    service.pulsePickup('kitchen', 'table-1', 'test');
    service.pulsePickup('bar', 'table-1', 'test');
    flushMicrotasks();
    expect(vibrateSpy).toHaveBeenCalledTimes(2);
  }));
});
