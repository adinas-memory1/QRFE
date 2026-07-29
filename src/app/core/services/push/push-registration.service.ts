import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter, firstValueFrom, take } from 'rxjs';
import {
  ActionPerformed,
  PushNotificationSchema,
  PushNotifications,
  RegistrationError,
  Token,
} from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/auth.service';
import { ClientInstanceService, clientInstanceIdsMatch } from '../device/client-instance.service';
import { DeviceFeedbackService } from '../device/device-feedback.service';
import { RuntimePlatformService } from '../../platform/runtime-platform.service';
import { HttpClient } from '@angular/common/http';
import {
  PushNotificationCopyService,
  WaiterPushEventType,
} from './push-notification-copy.service';
import { PickupVibrate } from '../../plugins/pickup-vibrate.plugin';
import { AppToastService } from '../toast-service/toast-service.service';
import { TranslocoService } from '@jsverse/transloco';
import {
  guestWaiterChannelId,
  guestWaiterChannelSoundPromptKey,
} from './guest-waiter-channel';

const WAITER_CALL_CHANNEL_ID = 'waiter_call_v5';
const ALERT_DEBOUNCE_MS = 5000;
const WAITER_CHANNEL_SOUND_PROMPT_KEY = 'qrfe.waiterCallChannelSoundPrompted';

export type PickupAlertSource = 'sse' | 'fcm';

export interface DeliverPickupAlertOptions {
  eventType: WaiterPushEventType;
  tableId: string;
  tableName?: string | null;
  clientInstanceId?: string | null;
  source: PickupAlertSource;
}

export interface DeliverGuestWaiterAlertOptions {
  tableId: string;
  tableName?: string | null;
  source: PickupAlertSource;
}

/**
 * Pickup alerts on native Android:
 * - Background/killed: data-only FCM → native tray (pickup: waiter_call_v5; guest: guest_waiter_{restaurantId}).
 * - Foreground: SSE → haptics + in-app toast; Capacitor presentationOptions=[] suppresses FCM banner.
 * - PWA/browser: SSE → LocalNotifications when tab hidden.
 */
@Injectable({ providedIn: 'root' })
export class PushRegistrationService {
  readonly #http = inject(HttpClient);
  readonly #auth = inject(AuthService);
  readonly #router = inject(Router);
  readonly #platform = inject(RuntimePlatformService);
  readonly #clientInstance = inject(ClientInstanceService);
  readonly #deviceFeedback = inject(DeviceFeedbackService);
  readonly #copy = inject(PushNotificationCopyService);
  readonly #toast = inject(AppToastService);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);

  readonly #apiUrl = environment.apiUrl;
  #currentToken: string | null = null;
  #listenersAttached = false;
  #localNotificationId = 1;
  readonly #lastAlertAtByKey = new Map<string, number>();
  #resumeFlushAttached = false;
  /** Cached from App.getState / appStateChange — getState() can be stale in background. */
  #appIsActive: boolean | null = null;

  init(): void {
    this.ensureHapticResumeFlush();

    if (!this.#platform.isNative) {
      return;
    }

    this.#auth
      .getUserContext()
      .pipe(
        filter((u) => !!u && !!this.#auth.getUserRestaurantId()),
        take(1),
        takeUntilDestroyed(this.#destroyRef),
      )
      .subscribe(() => {
        void this.ensureRegistered();
        void this.postStoredTokenIfReady();
      });

    this.#auth.loggedIn$.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe(() => {
      void this.ensureRegistered();
      void this.postStoredTokenIfReady();
      void this.ensureGuestWaiterChannelForCurrentRestaurant();
    });
  }

  /** Retry backend registration when FCM token arrived before auth context was ready. */
  private async postStoredTokenIfReady(): Promise<void> {
    const token = this.#currentToken;
    if (!token) return;
    await this.sendTokenToBackend(token);
  }

  async ensureRegistered(): Promise<void> {
    if (!this.#platform.isNative) {
      return;
    }

    try {
      await this.attachListeners();
      await this.createAndroidChannels();
      await this.ensureLocalNotificationPermission();
      await this.#clientInstance.whenReady();
      await this.ensureWaiterCallChannelAudible();
      await this.ensureGuestWaiterChannelForCurrentRestaurant();

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        return;
      }

      await PushNotifications.register();
    } catch (err) {
      console.warn('[PushRegistration] setup failed', err);
    }
  }

  private async ensureWaiterCallChannelAudible(): Promise<void> {
    try {
      const status = await PickupVibrate.getWaiterCallChannelStatus();
      if (!status?.supported || !status.channelExists) {
        return;
      }

      const soundDisabled = status.importance === 0 || !status.sound;
      if (!soundDisabled) {
        return;
      }

      if (localStorage.getItem(WAITER_CHANNEL_SOUND_PROMPT_KEY) === '1') {
        return;
      }
      localStorage.setItem(WAITER_CHANNEL_SOUND_PROMPT_KEY, '1');

      this.#toast.info(
        this.#transloco.translate('staff.notifications.enableSoundBody'),
        this.#transloco.translate('staff.notifications.enableSoundTitle'),
        10_000,
      );
      await PickupVibrate.openWaiterCallChannelSettings();
    } catch {
      // ignore
    }
  }

  private async ensureGuestWaiterChannelForCurrentRestaurant(): Promise<void> {
    const restaurantId = this.#auth.getUserRestaurantId();
    if (typeof restaurantId !== 'string' || !restaurantId) {
      return;
    }

    const restaurantName = this.#auth.getUserSnapshot()?.restaurantName ?? null;
    try {
      await PickupVibrate.ensureGuestWaiterChannel({ restaurantId, restaurantName });
      await this.ensureGuestWaiterChannelAudible(restaurantId);
    } catch {
      // ignore
    }
  }

  private async ensureGuestWaiterChannelAudible(restaurantId: string): Promise<void> {
    try {
      const status = await PickupVibrate.getGuestWaiterChannelStatus({ restaurantId });
      if (!status?.supported || !status.channelExists) {
        return;
      }

      const soundDisabled = status.importance === 0 || !status.sound;
      if (!soundDisabled) {
        return;
      }

      const promptKey = guestWaiterChannelSoundPromptKey(restaurantId);
      if (localStorage.getItem(promptKey) === '1') {
        return;
      }
      localStorage.setItem(promptKey, '1');

      this.#toast.info(
        this.#transloco.translate('staff.notifications.enableGuestWaiterSoundBody'),
        this.#transloco.translate('staff.notifications.enableGuestWaiterSoundTitle'),
        10_000,
      );
      await PickupVibrate.openGuestWaiterChannelSettings({ restaurantId });
    } catch {
      // ignore
    }
  }

  /** Guest waiter call from public menu — all staff devices. */
  async deliverGuestWaiterAlert(options: DeliverGuestWaiterAlertOptions): Promise<void> {
    if (options.source === 'fcm') {
      return;
    }

    const debounceKey = `WaiterCall:${options.tableId}`;
    let appActive: boolean | null = null;
    if (this.#platform.isNative) {
      try {
        const { App } = await import('@capacitor/app');
        appActive = (await App.getState()).isActive;
      } catch {
        // ignore
      }
    }

    if (!this.#platform.isNative) {
      if (!document.hidden || this.isDebounced(debounceKey)) {
        return;
      }
      this.markHandled(debounceKey);
      await this.showLocalizedNotification('WaiterCall', options.tableName, 'pwa-sse-guest');
      return;
    }

    if (this.isNativeInBackground(appActive)) {
      this.#deviceFeedback.notifyGuestWaiterCall(options.tableId);
    } else {
      this.#deviceFeedback.notifyGuestWaiterCall(options.tableId);
      if (!this.isDebounced(debounceKey)) {
        const title = this.#copy.titleFor('WaiterCall');
        const body = this.#copy.bodyFor('WaiterCall', options.tableName);
        this.#toast.info(body, title, 8_000);
      }
    }

    if (!this.isDebounced(debounceKey)) {
      this.markHandled(debounceKey);
    }
  }

  /** PWA: LocalNotifications when tab hidden. Native: hybrid FCM tray + haptic fallbacks. */
  async deliverPickupAlert(options: DeliverPickupAlertOptions): Promise<void> {
    if (options.source === 'fcm') {
      return;
    }

    const debounceKey = `${options.eventType}:${options.tableId}`;
    let appActive: boolean | null = null;
    if (this.#platform.isNative) {
      try {
        appActive = (await App.getState()).isActive;
      } catch {
        // ignore
      }
    }

    if (!this.#platform.isNative) {
      if (!document.hidden || this.isDebounced(debounceKey)) {
        return;
      }
      this.markHandled(debounceKey);
      await this.showLocalizedNotification(options.eventType, options.tableName, 'pwa-sse');
      return;
    }

    // Native foreground: show in-app toast (manage-orders is not the only staff route).
    if (appActive === true) {
      const title = this.#copy.titleFor(options.eventType);
      const body = this.#copy.bodyFor(options.eventType, options.tableName ?? undefined);
      this.#toast.info(body, title);
      if (!this.isDebounced(debounceKey)) {
        this.markHandled(debounceKey);
      }
      return;
    }

    // Native background: SSE may still run — pulse if WebView is alive and app not in foreground.
    if (this.isNativeInBackground(appActive)) {
      const kind = options.eventType === 'BarWaiterCall' ? 'bar' : 'kitchen';
      this.#deviceFeedback.notifyPickupFromPush(kind, options.tableId, options.clientInstanceId);
    }
    if (!this.isDebounced(debounceKey)) {
      this.markHandled(debounceKey);
    }
  }

  /** Native background: not explicitly active (null/undefined/false when another app is in front). */
  private isNativeInBackground(appActive: boolean | null): boolean {
    if (!this.#platform.isNative) {
      return false;
    }
    const active = appActive ?? this.#appIsActive;
    return active !== true;
  }

  wasGuestWaiterAlertHandledRecently(tableId: string): boolean {
    return this.isDebounced(`WaiterCall:${tableId}`);
  }

  wasPickupAlertHandledRecently(eventType: WaiterPushEventType, tableId: string): boolean {
    return this.isDebounced(`${eventType}:${tableId}`);
  }

  ensureHapticResumeFlush(): void {
    if (this.#resumeFlushAttached) {
      return;
    }
    this.#resumeFlushAttached = true;

    if (this.#platform.isNative) {
      void import('@capacitor/app').then(({ App }) => {
        void App.getState().then((state) => {
          this.#appIsActive = state.isActive;
        });
        App.addListener('appStateChange', ({ isActive }) => {
          this.#appIsActive = isActive;
          if (isActive) {
            void this.clearDeliveredPushNotifications();
          }
        });
      });
    }
  }

  private isDebounced(debounceKey: string): boolean {
    const lastAt = this.#lastAlertAtByKey.get(debounceKey) ?? 0;
    return Date.now() - lastAt < ALERT_DEBOUNCE_MS;
  }

  private markHandled(debounceKey: string): void {
    this.#lastAlertAtByKey.set(debounceKey, Date.now());
  }

  private async clearDeliveredPushNotifications(): Promise<void> {
    if (!this.#platform.isNative) return;
    try {
      await PushNotifications.removeAllDeliveredNotifications();
    } catch {
      // ignore
    }
  }

  async unregisterCurrentToken(): Promise<void> {
    const token = this.#currentToken;
    const restaurantId = this.#auth.getUserRestaurantId();
    if (!token || typeof restaurantId !== 'string' || !restaurantId) {
      return;
    }

    try {
      await firstValueFrom(
        this.#http.request('DELETE', `${this.#apiUrl}/api/user/device-token`, {
          body: { token, restaurantId },
          withCredentials: true,
        }),
      );
    } catch {
      // ignore logout cleanup errors
    } finally {
      this.#currentToken = null;
    }
  }

  private async attachListeners(): Promise<void> {
    if (this.#listenersAttached) {
      return;
    }
    this.#listenersAttached = true;

    await PushNotifications.addListener('registration', (token: Token) => {
      void this.onToken(token.value);
    });

    await PushNotifications.addListener('registrationError', (err: RegistrationError) => {
      console.warn('[PushRegistration] registration error', err);
    });

    await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      void this.onPushReceived(notification);
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      void this.onPushAction(action);
    });

    await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      void this.#router.navigate(['/staff/manage-orders']);
    });
  }

  private async createAndroidChannels(): Promise<void> {
    // Channel is created in MainActivity (waiter_call_v5) with sound + vibration — do not overwrite via Capacitor.
  }

  private async ensureLocalNotificationPermission(): Promise<void> {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'prompt') {
        await LocalNotifications.requestPermissions();
      }
    } catch {
      // ignore
    }
  }

  private async onToken(token: string): Promise<void> {
    this.#currentToken = token;
    await this.sendTokenToBackend(token);
  }

  private async sendTokenToBackend(token: string): Promise<void> {
    const restaurantId = this.#auth.getUserRestaurantId();
    if (!token || typeof restaurantId !== 'string' || !restaurantId) {
      return;
    }

    const clientInstanceId = await this.#clientInstance.whenReady();

    try {
      await firstValueFrom(
        this.#http.post(
          `${this.#apiUrl}/api/user/device-token`,
          { token, restaurantId, clientInstanceId },
          { withCredentials: true },
        ),
      );
    } catch (err) {
      console.warn('[PushRegistration] token register failed', err);
    }
  }

  private async onPushReceived(notification: PushNotificationSchema): Promise<void> {
    if (!this.#platform.isNative) {
      return;
    }

    const payload = this.parsePayload(notification);
    let appActive = true;
    try {
      const { App } = await import('@capacitor/app');
      appActive = (await App.getState()).isActive;
    } catch {
      // ignore
    }

    if (!payload.eventType) {
      return;
    }

    const tableId = payload.tableId ?? 'unknown';

    if (payload.eventType === 'WaiterCall') {
      if (this.isNativeInBackground(appActive)) {
        this.#deviceFeedback.notifyGuestWaiterCall(tableId);
      } else {
        try {
          const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
          await Haptics.impact({ style: ImpactStyle.Heavy });
        } catch {
          this.#deviceFeedback.notifyGuestWaiterCall(tableId);
        }
      }
      return;
    }

    const kind = payload.eventType === 'BarWaiterCall' ? 'bar' : 'kitchen';
    const localId = await this.#clientInstance.whenReady();
    const matchesTarget = clientInstanceIdsMatch(payload.clientInstanceId, localId);
    if (!matchesTarget) {
      return;
    }

    if (this.isNativeInBackground(appActive)) {
      this.#deviceFeedback.notifyPickupFromPush(kind, tableId, payload.clientInstanceId);
      return;
    }

    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch {
      this.#deviceFeedback.notifyPickupFromPush(kind, tableId, payload.clientInstanceId);
    }
  }

  private async showLocalizedNotification(
    eventType: WaiterPushEventType,
    tableName?: string | null,
    _source = 'unknown',
  ): Promise<void> {
    const title = this.#copy.titleFor(eventType);
    const body = this.#copy.bodyFor(eventType, tableName);
    const id = this.nextLocalNotificationId();
    const restaurantId = this.#auth.getUserRestaurantId();
    const channelId =
      eventType === 'WaiterCall' && typeof restaurantId === 'string' && restaurantId
        ? guestWaiterChannelId(restaurantId)
        : WAITER_CALL_CHANNEL_ID;

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            channelId,
            sound: 'default',
            extra: { eventType, tableName: tableName ?? '' },
          },
        ],
      });
    } catch (err) {
      console.warn('[PushRegistration] local notification failed', err);
    }
  }

  private parsePayload(notification: PushNotificationSchema): {
    eventType: WaiterPushEventType | null;
    tableName: string | null;
    tableId: string | null;
    clientInstanceId: string | null;
  } {
    const raw = (notification.data ?? {}) as Record<string, unknown>;
    const eventType = this.field(raw, 'eventType', 'EventType');
    const tableName = this.field(raw, 'tableName', 'TableName');
    const tableId = this.field(raw, 'tableId', 'TableId');
    const clientInstanceId = this.field(raw, 'clientInstanceId', 'ClientInstanceId');
    return {
      eventType: eventType as WaiterPushEventType | null,
      tableName,
      tableId,
      clientInstanceId,
    };
  }

  private field(
    obj: Record<string, unknown>,
    camel: string,
    pascal: string,
  ): string | null {
    const v = obj[camel] ?? obj[pascal];
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  }

  private nextLocalNotificationId(): number {
    this.#localNotificationId = (this.#localNotificationId % 2_000_000_000) + 1;
    return this.#localNotificationId;
  }

  private async onPushAction(_action: ActionPerformed): Promise<void> {
    await this.#router.navigate(['/staff/manage-orders']);
  }
}
