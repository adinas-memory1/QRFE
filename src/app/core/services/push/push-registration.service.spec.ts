import { TestBed } from '@angular/core/testing';
import { PushRegistrationService } from './push-registration.service';
import { RuntimePlatformService } from '../../platform/runtime-platform.service';
import { DeviceFeedbackService } from '../device/device-feedback.service';
import { PushNotificationCopyService } from './push-notification-copy.service';
import { AppToastService } from '../toast-service/toast-service.service';
import { TranslocoService } from '@jsverse/transloco';
import { AuthService } from '../../auth/auth.service';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { ClientInstanceService } from '../device/client-instance.service';

describe('PushRegistrationService deliverPickupAlert', () => {
  let service: PushRegistrationService;
  let deviceFeedback: jasmine.SpyObj<DeviceFeedbackService & { pulsePickup: jasmine.Spy }>;
  let toast: jasmine.SpyObj<Pick<AppToastService, 'info'>>;
  let clientInstance: jasmine.SpyObj<Pick<ClientInstanceService, 'whenReady'>>;
  const nativePlatform: RuntimePlatformService = {
    isNative: true,
    capabilities: {
      surface: 'capacitor-android',
      isNative: true,
      shouldAlignApiUrlToPageHost: false,
      serviceWorkerExpected: false,
      hapticsBackend: 'none',
      clientInstanceStorage: 'preferences',
    },
    shouldAlignApiUrlToPageHost: false,
    serviceWorkerExpected: false,
  } as RuntimePlatformService;

  beforeEach(() => {
    deviceFeedback = jasmine.createSpyObj('DeviceFeedbackService', [
      'notifyPickupFromPush',
      'pulsePickup',
    ]);
    deviceFeedback.pulsePickup.and.returnValue(Promise.resolve(true));
    toast = jasmine.createSpyObj('AppToastService', ['info']);
    clientInstance = jasmine.createSpyObj('ClientInstanceService', ['whenReady']);
    clientInstance.whenReady.and.resolveTo('waiter-device-1');

    TestBed.configureTestingModule({
      providers: [
        PushRegistrationService,
        { provide: RuntimePlatformService, useValue: nativePlatform },
        { provide: DeviceFeedbackService, useValue: deviceFeedback },
        {
          provide: PushNotificationCopyService,
          useValue: {
            titleFor: (t: string) => t,
            bodyFor: () => 'body',
          },
        },
        { provide: AppToastService, useValue: toast },
        { provide: TranslocoService, useValue: { translate: (k: string) => k } },
        { provide: AuthService, useValue: { getUserContext: () => ({ pipe: () => ({}) }) } },
        { provide: HttpClient, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: ClientInstanceService, useValue: clientInstance },
      ],
    });

    service = TestBed.inject(PushRegistrationService);
  });

  it('isNativeInBackground treats inactive app as background', () => {
    const probe = service as unknown as { isNativeInBackground: (appActive: boolean | null) => boolean };
    expect(probe.isNativeInBackground(false)).toBeTrue();
    expect(probe.isNativeInBackground(null)).toBeTrue();
    expect(probe.isNativeInBackground(true)).toBeFalse();
  });

  it('skips delivery for fcm source', async () => {
    await service.deliverPickupAlert({
      eventType: 'BarWaiterCall',
      tableId: 'table-bar',
      source: 'fcm',
    });
    expect(deviceFeedback.notifyPickupFromPush).not.toHaveBeenCalled();
  });

  it('shows foreground toast only on targeted waiter device', async () => {
    spyOn(
      service as unknown as { isDebounced: (key: string) => boolean },
      'isDebounced',
    ).and.returnValue(false);

    const appModule = await import('@capacitor/app');
    spyOn(appModule.App, 'getState').and.resolveTo({ isActive: true });

    await service.deliverPickupAlert({
      eventType: 'KitchenWaiterCall',
      tableId: 'table-kitchen',
      tableName: 'T1',
      clientInstanceId: 'waiter-device-2',
      source: 'sse',
    });

    expect(toast.info).not.toHaveBeenCalled();
  });

  it('shows foreground toast when clientInstanceId matches local device', async () => {
    spyOn(
      service as unknown as { isDebounced: (key: string) => boolean },
      'isDebounced',
    ).and.returnValue(false);

    const appModule = await import('@capacitor/app');
    spyOn(appModule.App, 'getState').and.resolveTo({ isActive: true });

    await service.deliverPickupAlert({
      eventType: 'KitchenWaiterCall',
      tableId: 'table-kitchen',
      tableName: 'T1',
      clientInstanceId: 'waiter-device-1',
      source: 'sse',
    });

    expect(toast.info).toHaveBeenCalled();
    expect(deviceFeedback.pulsePickup).toHaveBeenCalledWith(
      'kitchen',
      'table-kitchen',
      'foreground-sse',
    );
  });
});
