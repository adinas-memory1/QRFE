import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { RuntimePlatformService } from '../../platform/runtime-platform.service';
import { ClientInstanceService, clientInstanceIdsMatch } from './client-instance.service';

const PICKUP_VIBRATE_MS = 500;
const DEBOUNCE_MS = 2000;

export type PickupReadyKind = 'kitchen' | 'bar';

export interface PickupReadyNotifyOptions {
  tableId: string;
  clientInstanceId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DeviceFeedbackService {
  private readonly lastVibrateAtByTable = new Map<string, number>();

  constructor(
    private readonly clientInstance: ClientInstanceService,
    private readonly platform: RuntimePlatformService,
  ) {}

  /**
   * Vibrate only when the SSE/FCM payload targets this device's client instance id.
   * Waits for Capacitor Preferences id before comparing (same rules as b8e1d845).
   */
  notifyPickupReady(kind: PickupReadyKind, options: PickupReadyNotifyOptions): void {
    void this.deliverPickupReady(kind, options);
  }

  /** FCM/SSE on this device — vibrate only when payload targets this client instance. */
  notifyPickupFromPush(
    kind: PickupReadyKind,
    tableId: string,
    clientInstanceId?: string | null,
  ): void {
    void this.deliverPickupReady(kind, { tableId, clientInstanceId });
  }

  /**
   * Debounced pickup haptic — native PickupVibrate first, then Capacitor Haptics / navigator.
   * Returns true when a vibrate backend succeeded.
   */
  async pulsePickup(
    kind: PickupReadyKind,
    tableId: string,
    _source?: string,
  ): Promise<boolean> {
    const normalizedTableId = tableId?.trim();
    if (!normalizedTableId) {
      return false;
    }

    const now = Date.now();
    const debounceKey = `${kind}:${normalizedTableId}`;
    const last = this.lastVibrateAtByTable.get(debounceKey) ?? 0;
    if (now - last < DEBOUNCE_MS) {
      return false;
    }

    this.lastVibrateAtByTable.set(debounceKey, now);
    return this.vibrate(PICKUP_VIBRATE_MS);
  }

  /** Guest waiter call — broadcast to all staff devices (no ClientInstanceId gate). */
  notifyGuestWaiterCall(tableId: string): void {
    void this.deliverGuestWaiterCall(tableId);
  }

  private async deliverPickupReady(
    kind: PickupReadyKind,
    options: PickupReadyNotifyOptions,
  ): Promise<void> {
    const targetId = (options.clientInstanceId ?? '').trim();
    const tableId = options.tableId?.trim();
    const localId = await this.clientInstance.whenReady();
    const matches = !!localId && clientInstanceIdsMatch(targetId, localId);

    if (!targetId || !tableId) {
      return;
    }
    if (!matches) {
      return;
    }

    await this.pulsePickup(kind, tableId, 'ready');
  }

  private async deliverGuestWaiterCall(tableId: string): Promise<void> {
    const normalizedTableId = tableId?.trim();
    if (!normalizedTableId) {
      return;
    }

    const now = Date.now();
    const debounceKey = `guest:${normalizedTableId}`;
    const last = this.lastVibrateAtByTable.get(debounceKey) ?? 0;
    if (now - last < DEBOUNCE_MS) {
      return;
    }

    this.lastVibrateAtByTable.set(debounceKey, now);
    await this.vibrate(PICKUP_VIBRATE_MS);
  }

  private async vibrate(durationMs: number): Promise<boolean> {
    // Android WebView exposes navigator.vibrate but it is ineffective — use native alert first.
    if (Capacitor.isNativePlatform()) {
      try {
        const { PickupVibrate } = await import('../../plugins/pickup-vibrate.plugin');
        await PickupVibrate.pulse();
        return true;
      } catch {
        // fall through
      }

      if (this.platform.capabilities.hapticsBackend === 'capacitor-haptics') {
        try {
          const { Haptics } = await import('@capacitor/haptics');
          await Haptics.vibrate({ duration: durationMs });
          return true;
        } catch {
          try {
            const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
            await Haptics.impact({ style: ImpactStyle.Heavy });
            return true;
          } catch {
            // fall through
          }
        }
      }
    }

    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(durationMs);
        return true;
      }
    } catch {
      // ignore
    }

    return false;
  }
}
