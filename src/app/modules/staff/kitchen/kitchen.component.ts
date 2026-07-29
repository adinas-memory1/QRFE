import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Subject, filter, take, takeUntil, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { UserContextModel } from '../../../core/models/userContextModel';
import { TablesService } from '../../../core/services/tables-service/tables.service';
import { TableDTO } from '../../../core/models/restaurantTablesModel';
import { OrderSyncService } from '../../../core/services/order-service/order-sync.service';
import { SseEvent } from '../../../core/models/sseModel';
import {
  CartItem,
  OrderUpdatedSSEPayload,
} from '../../../core/models/orderingModel';
import { MenuItemServiceService } from '../../../core/services/menu-item-service/menu-item-service.service';
import { MenuItem } from '../../../core/models/menu/menuItem';
import { isSetMenuOrderLine, SetMenuDTO, setMenuToMenuItem } from '../../../core/models/menu/setMenu';
import {
  cartLineFromOrderRaw,
  isBarCartLine,
  isKitchenCartLine,
  menuItemsByIdMap,
} from '../../../core/models/menu/cart-item-category';
import { normalizeMenuItemCategory } from '../../../core/models/menu/menu-item-category';
import {
  ButtonDirective,
  CardBodyComponent,
  CardComponent,
  CardHeaderComponent,
  ColComponent,
  RowComponent,
  TableDirective
} from '@coreui/angular';
import { KitchenService } from '../../../core/services/kitchen-service/kitchen.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { OfflineDbService } from '../../../core/offline/offline-db';
import { NotificationSoundService, type NotificationSoundKind } from '../../../core/services/sound/notification-sound.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  isIncompleteOrderUpdatedPayload,
  resolveBaselineCart,
  resolveIsNewStationOrder,
  shouldClearStationOrder,
} from '../station-order-snapshot.util';
import { kitchenDebugLog } from './kitchen-debug.logger';

type MarkKind = 'added' | 'updated' | 'deleted';
type ItemMark = { kind: MarkKind; until: number };

type KitchenLineItem = {
  id: string; // orderItemId (preferred) or synthetic key
  orderItemId?: string;
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  mark?: ItemMark;
  opText?: string;
};

type KitchenOrder = {
  restaurantId: string;
  tableId: string;
  tableName: string;
  orderId: string;
  lastActionAt: string;
  items: KitchenLineItem[];
};

@Component({
  selector: 'app-kitchen',
  standalone: true,
  templateUrl: './kitchen.component.html',
  styleUrls: ['./kitchen.component.scss'],
  imports: [
    RowComponent,
    ColComponent,
    CardComponent,
    CardHeaderComponent,
    CardBodyComponent,
    TableDirective,
    ButtonDirective,
    NgFor,
    NgIf,
    NgClass,
    DatePipe,
    TranslocoPipe,
  ]
})
export class KitchenComponent implements OnInit, OnDestroy {
  private readonly transloco = inject(TranslocoService);
  private destroy$ = new Subject<void>();
  private restaurantId = '';
  private hydrating = false;
  soundEnabled = false;
  soundMuted = false;
  private get debugSoundsEnabled(): boolean {
    try { return localStorage.getItem('debugSounds') === '1'; } catch { return false; }
  }
  private debugSound(...args: unknown[]): void {
    if (!this.debugSoundsEnabled) return;
    // eslint-disable-next-line no-console
    console.debug('[KitchenSound]', ...args);
  }

  tablesById: Record<string, TableDTO> = {};
  ordersByTableId: Record<string, KitchenOrder> = {}; // derived from Dexie carts
  private menuItemsById: Record<string, MenuItem | undefined> = {};
  private todaySetMenu: SetMenuDTO | null = null;

  private orderIdToTableId: Record<string, string> = {};
  private expandedTableIds = new Set<string>();

  private marksByTableId: Record<string, Record<string, ItemMark>> = {};
  private clearMarkTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private lastOpTextByTableId: Record<string, Record<string, string>> = {};
  private deletedShadowsByTableId: Record<string, Record<string, KitchenLineItem & { _until: number }>> = {};
  private readonly markMs = 90_000;
  private pendingSoundKind: NotificationSoundKind | null = null;
  private pendingSoundTimer: ReturnType<typeof setTimeout> | null = null;
  private seenServerOrderIds = new Set<string>();
  private lastToastAtByKey: Record<string, number> = {};
  private readonly recentSseSequences: number[] = [];
  private readonly recentSseSequenceSet = new Set<number>();
  private readonly maxRecentSseSequences = 300;
  private lastOrderUpdatedKeyByTableId: Record<string, string> = {};
  private lastCartSnapshotByTableId: Record<string, CartItem[]> = {};
  private lastAppliedSequenceByTableId: Record<string, number> = {};
  private lastAppliedActionAtMsByTableId: Record<string, number> = {};
  private orderUpdatedChainByTableId = new Map<string, Promise<void>>();
  private applyingOrderUpdateTables = new Set<string>();
  private toastOnce(key: string, ms: number, fn: () => void): void {
    const now = Date.now();
    if (now - (this.lastToastAtByKey[key] ?? 0) < ms) return;
    this.lastToastAtByKey[key] = now;
    fn();
  }

  private tableLabel(tableId: string): string {
    return this.tablesById[tableId]?.tableName ?? tableId;
  }

  private isSetMenuLine(c: CartItem): boolean {
    return isSetMenuOrderLine(
      c.item.menuItemId,
      c.item.category,
      this.todaySetMenu?.linkedMenuItemId
    );
  }

  private setMenuDisplayName(): string {
    return this.transloco.translate('kitchen.setMenuName');
  }

  private displayNameForCartItem(c: CartItem): string {
    if (this.isSetMenuLine(c)) return this.setMenuDisplayName();
    const name = (c.item.menuItemName ?? '').trim();
    return name && name !== '—' ? name : '—';
  }

  private displayCategoryForCartItem(c: CartItem): string {
    if (this.isSetMenuLine(c)) return '';
    return normalizeMenuItemCategory(c.item.category) ?? c.item.category ?? '';
  }

  get orders(): KitchenOrder[] {
    return Object.values(this.ordersByTableId)
      .sort((a, b) => (b.lastActionAt ?? '').localeCompare(a.lastActionAt ?? ''));
  }

  constructor(
    private auth: AuthService,
    private tablesService: TablesService,
    private menuItemService: MenuItemServiceService,
    private sse: OrderSyncService,
    private kitchenApi: KitchenService,
    private toast: AppToastService,
    private offlineDB: OfflineDbService,
    private sounds: NotificationSoundService,
  ) {}

  ngOnInit(): void {
    this.sounds.armOnce();
    this.soundEnabled = this.sounds.isUnlocked;
    this.soundMuted = this.getSoundMuted();
    this.sse.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(ev => this.handleSseEvent(ev));

    this.sse.snapshotRefreshed$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.hydrating) return;
        void this.rebuildFromDexie().then(() => {
          // #region agent log
          kitchenDebugLog('H5', 'kitchen.snapshotRefreshed', 'rebuild-done', {
            orderCount: Object.keys(this.ordersByTableId).length,
            tableIds: Object.keys(this.ordersByTableId),
          });
          // #endregion
        });
      });

    // UI should reflect Dexie: rebuild when carts mutate.
    this.offlineDB.cartsChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async ({ tableId }) => {
        if (this.hydrating) return;
        if (this.applyingOrderUpdateTables.has(tableId)) return;
        await this.rebuildFromDexie(tableId);
      });

    this.auth.getUserContext()
      .pipe(
        takeUntil(this.destroy$),
        filter((user): user is UserContextModel => !!user?.restaurantId),
        take(1)
      )
      .subscribe(async user => {
        this.restaurantId = user.restaurantId!;
        // Ensure SSE is started in THIS tab as well (reliable even if app init was hidden).
        this.sse.listenToRestaurantEvents(this.restaurantId);
        const [tables, menu] = await Promise.all([
          this.tablesService.getAllWithFallback(this.restaurantId),
          this.menuItemService.getAllWithFallback(this.restaurantId),
        ]);

        this.menuItemsById = menuItemsByIdMap(menu?.menuItems ?? []);
        this.todaySetMenu = menu?.todaySetMenu ?? null;
        this.tablesById = Object.fromEntries(tables.map(t => [t.tableId, t]));
        await this.hydrateFromBackend(tables);
        await this.rebuildFromDexie();
      });
  }

  private getSoundMuted(): boolean {
    try { return localStorage.getItem('kitchenSoundMuted') === '1'; } catch { return false; }
  }

  private setSoundMuted(muted: boolean): void {
    this.soundMuted = muted;
    try { localStorage.setItem('kitchenSoundMuted', muted ? '1' : '0'); } catch { /* ignore */ }
  }

  async toggleSound(): Promise<void> {
    if (!this.soundEnabled) {
      // Must be called from a click: unlock audio, then unmute.
      const ok = await this.sounds.unlockFromGesture();
      this.soundEnabled = ok;
      if (!ok) return;
    }

    if (this.soundMuted) {
      this.setSoundMuted(false);
      this.sounds.play('uiToggle');
    } else {
      this.setSoundMuted(true);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    Object.values(this.clearMarkTimers).forEach(t => clearTimeout(t));
  }

  private readonly pickupInFlightByTable = new Set<string>();

  async callWaiterForPickup(tableId: string): Promise<void> {
    if (!this.restaurantId) return;
    const inFlightKey = `${this.restaurantId}:${tableId}`;
    if (this.pickupInFlightByTable.has(inFlightKey)) return;
    this.pickupInFlightByTable.add(inFlightKey);
    try {
      await firstValueFrom(this.kitchenApi.callWaiterForPickup(this.restaurantId, tableId));
      this.toast.success(this.transloco.translate('kitchen.toastWaiterOk'));
    } catch (err) {
      console.error('[Kitchen] callWaiterForPickup failed', err);
      this.toast.error(this.transloco.translate('kitchen.toastWaiterFail'));
    } finally {
      setTimeout(() => this.pickupInFlightByTable.delete(inFlightKey), 3000);
    }
  }

  private handleSseEvent({ EventType, Data, Sequence }: SseEvent<any>) {
    // #region agent log
    kitchenDebugLog('H3', 'kitchen.handleSseEvent', 'sse-event-entry', {
      eventType: EventType,
      sequence: Sequence,
    });
    // #endregion
    if (typeof Sequence === 'number' && Sequence > 0) {
      if (this.recentSseSequenceSet.has(Sequence)) {
        kitchenDebugLog('H4', 'kitchen.handleSseEvent', 'sequence-dedup-skip', {
          eventType: EventType,
          sequence: Sequence,
        });
        return;
      }
      this.recentSseSequenceSet.add(Sequence);
      this.recentSseSequences.push(Sequence);
      if (this.recentSseSequences.length > this.maxRecentSseSequences) {
        const old = this.recentSseSequences.shift();
        if (typeof old === 'number') this.recentSseSequenceSet.delete(old);
      }
    }
    switch (EventType) {
      case 'OrderUpdated': {
        const payload = Data as OrderUpdatedSSEPayload;
        const rawItems = (payload as { Items?: unknown[]; items?: unknown[] }).Items
          ?? (payload as { items?: unknown[] }).items
          ?? [];
        kitchenDebugLog('H4', 'kitchen.handleSseEvent', 'order-updated-received', {
          sequence: Sequence,
          tableId: (payload as { TableId?: string; tableId?: string }).TableId
            ?? (payload as { tableId?: string }).tableId,
          orderId: (payload as { OrderId?: string; orderId?: string }).OrderId
            ?? (payload as { orderId?: string }).orderId,
          itemCount: (payload as { ItemCount?: number; itemCount?: number }).ItemCount
            ?? (payload as { itemCount?: number }).itemCount,
          itemsLen: rawItems.length,
        });
        this.enqueueOrderUpdated(payload, Sequence);
        break;
      }
      case 'OrderItemAdded': {
        // Intentionally ignored: we compute UI changes + granular toasts from OrderUpdated diffs.
        break;
      }
      case 'OrderItemQuantityUpdated': {
        // Authoritative cart + marks come from OrderUpdated (same as manage-orders).
        break;
      }
      case 'OrderItemDeleted': {
        // Intentionally ignored: we compute delete from OrderUpdated diffs.
        break;
      }
      case 'OrderClosedWithPayment': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId') ?? '';
        const orderId = this.sseField<string>(Data, 'OrderId', 'orderId') ?? '';
        kitchenDebugLog('H1', 'kitchen.handleSseEvent', 'order-closed-received', {
          tableId,
          orderId,
          sequence: Sequence,
        });
        if (tableId) this.enqueueOrderClosed(tableId, orderId);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Initial load should reflect server truth. `getAllWithFallback` already calls
   * GET …/get-tables-status, which returns each table’s open order — no per-table
   * list-open-order calls (avoids N duplicate HTTP requests on kitchen/bar entry).
   */
  private async hydrateFromBackend(tables: TableDTO[]): Promise<void> {
    if (!this.restaurantId) return;

    this.hydrating = true;
    try {
      for (const t of tables) {
        const tableId = t.tableId;
        if (!tableId) continue;

        const order = t.order;
        if (!order?.orderId || order.orderId.startsWith('local-')) {
          await this.offlineDB.deleteCart(tableId);
          continue;
        }

        await this.offlineDB.saveOrderSnapshot(tableId, order);
      }
    } finally {
      this.hydrating = false;
    }
  }

  toggleExpanded(tableId: string) {
    if (this.expandedTableIds.has(tableId)) this.expandedTableIds.delete(tableId);
    else this.expandedTableIds.add(tableId);
  }

  isExpanded(tableId: string) {
    return this.expandedTableIds.has(tableId);
  }

  private filterFood(items: CartItem[]): CartItem[] {
    return items.filter(c => isKitchenCartLine(c));
  }

  private enqueueOrderUpdated(payload: OrderUpdatedSSEPayload, envelopeSequence?: number): void {
    const tableId = this.tableIdFromPayload(payload);
    if (!tableId) return;

    const prev = this.orderUpdatedChainByTableId.get(tableId) ?? Promise.resolve();
    const next = prev
      .then(() => this.applyOrderUpdated(payload, envelopeSequence))
      .catch(err => console.error('[Kitchen] applyOrderUpdated failed', err));
    this.orderUpdatedChainByTableId.set(tableId, next);
    void next.finally(() => {
      if (this.orderUpdatedChainByTableId.get(tableId) === next) {
        this.orderUpdatedChainByTableId.delete(tableId);
      }
    });
  }

  private enqueueOrderClosed(tableId: string, orderId?: string): void {
    const prev = this.orderUpdatedChainByTableId.get(tableId) ?? Promise.resolve();
    const next = prev
      .then(() => this.clearTableOrder(tableId, orderId))
      .catch(err => console.error('[Kitchen] clearTableOrder failed', err));
    this.orderUpdatedChainByTableId.set(tableId, next);
    void next.finally(() => {
      if (this.orderUpdatedChainByTableId.get(tableId) === next) {
        this.orderUpdatedChainByTableId.delete(tableId);
      }
    });
  }

  private sseField<T>(data: unknown, pascalKey: string, camelKey: string): T | undefined {
    const record = data as Record<string, T | undefined>;
    return record[pascalKey] ?? record[camelKey];
  }

  private tableIdFromPayload(payload: OrderUpdatedSSEPayload): string {
    return this.sseField<string>(payload, 'TableId', 'tableId') ?? '';
  }

  private orderIdFromPayload(payload: OrderUpdatedSSEPayload): string {
    return this.sseField<string>(payload, 'OrderId', 'orderId') ?? '';
  }

  private itemCountFromPayload(payload: OrderUpdatedSSEPayload, nextCart: CartItem[]): number {
    const explicit = this.sseField<number>(payload, 'ItemCount', 'itemCount');
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
    return nextCart.reduce((sum, line) => sum + line.quantity, 0);
  }

  private async clearTableOrder(tableId: string, orderId?: string): Promise<void> {
    kitchenDebugLog('H1', 'kitchen.clearTableOrder', 'clear-invoked', { tableId, orderId });
    delete this.ordersByTableId[tableId];
    delete this.lastCartSnapshotByTableId[tableId];
    delete this.lastOrderUpdatedKeyByTableId[tableId];
    delete this.lastAppliedSequenceByTableId[tableId];
    delete this.lastAppliedActionAtMsByTableId[tableId];
    delete this.marksByTableId[tableId];
    delete this.lastOpTextByTableId[tableId];
    delete this.deletedShadowsByTableId[tableId];
    this.expandedTableIds.delete(tableId);

    if (orderId) {
      delete this.orderIdToTableId[orderId];
    } else {
      for (const [oid, tid] of Object.entries(this.orderIdToTableId)) {
        if (tid === tableId) delete this.orderIdToTableId[oid];
      }
    }

    this.applyingOrderUpdateTables.add(tableId);
    try {
      await this.offlineDB.deleteCart(tableId);
    } finally {
      this.applyingOrderUpdateTables.delete(tableId);
    }
  }

  private isStaleOrderUpdated(
    tableId: string,
    lastActionAt: string,
    envelopeSequence?: number,
  ): boolean {
    if (typeof envelopeSequence === 'number' && envelopeSequence > 0) {
      const lastSeq = this.lastAppliedSequenceByTableId[tableId] ?? 0;
      return envelopeSequence <= lastSeq;
    }

    const actionAtMs = Date.parse(lastActionAt);
    if (!Number.isFinite(actionAtMs)) return false;
    const lastMs = this.lastAppliedActionAtMsByTableId[tableId] ?? 0;
    return actionAtMs < lastMs;
  }

  private markOrderUpdatedApplied(
    tableId: string,
    lastActionAt: string,
    envelopeSequence?: number,
  ): void {
    if (typeof envelopeSequence === 'number' && envelopeSequence > 0) {
      this.lastAppliedSequenceByTableId[tableId] = envelopeSequence;
    }

    const actionAtMs = Date.parse(lastActionAt);
    if (Number.isFinite(actionAtMs)) {
      this.lastAppliedActionAtMsByTableId[tableId] = Math.max(
        this.lastAppliedActionAtMsByTableId[tableId] ?? 0,
        actionAtMs,
      );
    }
  }

  private async applyOrderUpdated(payload: OrderUpdatedSSEPayload, envelopeSequence?: number) {
    const tableId = this.tableIdFromPayload(payload);
    const orderId = this.orderIdFromPayload(payload);
    const lastActionAt =
      this.sseField<string>(payload, 'LastActionAt', 'lastActionAt') ?? new Date().toISOString();

    if (!tableId || !orderId) {
      kitchenDebugLog('H2', 'kitchen.applyOrderUpdated', 'missing-ids-skip', {
        tableId,
        orderId,
        payloadKeys: Object.keys(payload as object),
        envelopeSequence,
      });
      return;
    }

    const dedupeKey =
      typeof envelopeSequence === 'number' && envelopeSequence > 0
        ? `${orderId}:seq:${envelopeSequence}`
        : `${orderId}:${lastActionAt}`;
    if (this.lastOrderUpdatedKeyByTableId[tableId] === dedupeKey) {
      kitchenDebugLog('H4', 'kitchen.applyOrderUpdated', 'dedupe-key-skip', {
        tableId,
        orderId,
        dedupeKey,
        envelopeSequence,
      });
      return;
    }
    if (this.isStaleOrderUpdated(tableId, lastActionAt, envelopeSequence)) {
      kitchenDebugLog('H3', 'kitchen.applyOrderUpdated', 'stale-skip', {
        tableId,
        orderId,
        lastActionAt,
        envelopeSequence,
        lastSeq: this.lastAppliedSequenceByTableId[tableId] ?? 0,
        lastActionMs: this.lastAppliedActionAtMsByTableId[tableId] ?? 0,
      });
      return;
    }

    this.orderIdToTableId[orderId] = tableId;

    const rawItems = (this.sseField<any[]>(payload, 'Items', 'items') ?? []) as any[];
    const nextCart: CartItem[] = rawItems.map(i => {
      const menuItemId: string = String(i?.MenuItemId ?? i?.menuItemId ?? '');
      const linkedId = this.todaySetMenu?.linkedMenuItemId ?? '';
      if (linkedId && menuItemId.toLowerCase() === linkedId.toLowerCase() && this.todaySetMenu) {
        return {
          item: setMenuToMenuItem(this.todaySetMenu, this.transloco.getActiveLang()),
          quantity: Number(i?.Quantity ?? i?.quantity ?? 0),
          orderItemId: (i?.OrderItemId ?? i?.orderItemId) as string | undefined,
        };
      }
      return cartLineFromOrderRaw(i as Record<string, unknown>, this.menuItemsById);
    });

    const itemCount = this.itemCountFromPayload(payload, nextCart);
    if (isIncompleteOrderUpdatedPayload(itemCount, nextCart.length)) {
      kitchenDebugLog('H1', 'kitchen.applyOrderUpdated', 'incomplete-payload-skip', {
        tableId,
        orderId,
        itemCount,
        nextCartLen: nextCart.length,
        envelopeSequence,
      });
      void this.sse.refreshRestaurantSnapshot?.({ force: true });
      return;
    }
    if (shouldClearStationOrder(itemCount, nextCart.length)) {
      kitchenDebugLog('H1', 'kitchen.applyOrderUpdated', 'should-clear-order', {
        tableId,
        orderId,
        itemCount,
        nextCartLen: nextCart.length,
        envelopeSequence,
      });
      this.lastOrderUpdatedKeyByTableId[tableId] = dedupeKey;
      this.markOrderUpdatedApplied(tableId, lastActionAt, envelopeSequence);
      await this.clearTableOrder(tableId, orderId);
      return;
    }

    const existing = await resolveBaselineCart(
      tableId,
      orderId,
      this.lastCartSnapshotByTableId[tableId],
      tid => this.offlineDB.loadCartRecord(tid),
    );
    const prevFood = this.filterFood(existing);
    const nextFood = this.filterFood(nextCart);
    const memoryLen = this.lastCartSnapshotByTableId[tableId]?.length ?? 0;
    const addedIds = nextFood
      .filter(n => {
        const id = n.orderItemId ?? `menu:${n.item.menuItemId}`;
        return !prevFood.some(p => (p.orderItemId ?? `menu:${p.item.menuItemId}`) === id);
      })
      .map(n => n.item.menuItemName ?? n.item.menuItemId);
    kitchenDebugLog('H2', 'kitchen.applyOrderUpdated', 'diff-baseline', {
      tableId,
      orderId,
      memorySnapshotLen: memoryLen,
      baselineLen: existing.length,
      prevFoodLen: prevFood.length,
      nextFoodLen: nextFood.length,
      nextCartLen: nextCart.length,
      addedLineNames: addedIds,
      envelopeSequence,
    });
    const isServerOrderId = !!orderId && !orderId.startsWith('local-');
    const isNewOrder = resolveIsNewStationOrder(
      orderId,
      nextFood.length,
      prevFood.length,
      this.seenServerOrderIds,
    );
    if (isServerOrderId) this.seenServerOrderIds.add(orderId);

    if (isNewOrder && !this.hydrating && !document.hidden && !this.soundMuted) {
      this.sounds.play('newOrder');
    }
    if (isNewOrder) {
      const label = this.tableLabel(tableId);
      this.toastOnce(`newOrder:${orderId}`, 2000, () =>
        this.toast.sticky(
          this.transloco.translate('kitchen.toastNewOrderBody', { table: label }),
          this.transloco.translate('kitchen.toastNewOrderTitle'),
          'success'
        )
      );
    }
    this.diffAndMark(tableId, prevFood, nextFood, isNewOrder);

    // Update in-memory snapshot for next diffs/toasts (avoid Dexie race across tabs).
    this.lastCartSnapshotByTableId[tableId] = nextCart;
    this.lastOrderUpdatedKeyByTableId[tableId] = dedupeKey;
    this.markOrderUpdatedApplied(tableId, lastActionAt, envelopeSequence);

    this.applyingOrderUpdateTables.add(tableId);
    try {
      await this.offlineDB.saveCart(tableId, nextCart, orderId, true);
      await this.rebuildFromDexie(tableId, lastActionAt);
      const mappedLen = this.ordersByTableId[tableId]?.items.length ?? 0;
      kitchenDebugLog('H5', 'kitchen.applyOrderUpdated', 'after-rebuild', {
        tableId,
        orderId,
        orderVisible: !!this.ordersByTableId[tableId],
        mappedKitchenLines: mappedLen,
        envelopeSequence,
      });
    } finally {
      this.applyingOrderUpdateTables.delete(tableId);
    }
  }

  private async rebuildFromDexie(tableId?: string, lastActionAt?: string) {
    if (!this.restaurantId) return;

    if (tableId) {
      const record = await this.offlineDB.loadCartRecord(tableId);
      if (!record?.orderId || record.orderId.startsWith('local-')) {
        delete this.ordersByTableId[tableId];
        delete this.lastCartSnapshotByTableId[tableId];
        return;
      }
      this.seenServerOrderIds.add(record.orderId);
      this.orderIdToTableId[record.orderId] = tableId;
      this.lastCartSnapshotByTableId[tableId] = record.items ?? [];

      const mapped = this.mapCartToKitchenItems(tableId, record.items);
      if (!mapped.length) {
        delete this.ordersByTableId[tableId];
        return;
      }

      this.ordersByTableId[tableId] = {
        restaurantId: this.restaurantId,
        tableId,
        tableName: this.tablesById[tableId]?.tableName ?? '—',
        orderId: record.orderId,
        lastActionAt: lastActionAt ?? new Date().toISOString(),
        items: mapped
      };
      return;
    }

    const carts = await this.offlineDB.loadAllCarts();
    for (const [tId, items] of Object.entries(carts)) {
      const record = await this.offlineDB.loadCartRecord(tId);
      if (!record?.orderId || record.orderId.startsWith('local-')) continue;
      this.seenServerOrderIds.add(record.orderId);
      this.orderIdToTableId[record.orderId] = tId;
      this.lastCartSnapshotByTableId[tId] = items ?? [];
      const mapped = this.mapCartToKitchenItems(tId, items);
      if (!mapped.length) continue;
      this.ordersByTableId[tId] = {
        restaurantId: this.restaurantId,
        tableId: tId,
        tableName: this.tablesById[tId]?.tableName ?? '—',
        orderId: record.orderId,
        lastActionAt: new Date().toISOString(),
        items: mapped
      };
    }
  }

  private mapCartToKitchenItems(tableId: string, cart: CartItem[]): KitchenLineItem[] {
    const live = cart
      .filter(c => isKitchenCartLine(c));
    const mapped = live
      .map(c => {
        const id = c.orderItemId ?? `menu:${c.item.menuItemId}`;
        const mark = this.marksByTableId[tableId]?.[id];
        const opText = this.lastOpTextByTableId[tableId]?.[id];
        const line = {
          id,
          orderItemId: c.orderItemId,
          menuItemId: c.item.menuItemId,
          name: this.displayNameForCartItem(c),
          category: this.displayCategoryForCartItem(c),
          quantity: c.quantity,
          mark: mark && mark.until > Date.now() ? mark : undefined,
          opText: opText ?? undefined,
        };
        return line;
      });

    const liveIds = new Set(mapped.map(x => x.id));
    const shadows = Object.values(this.deletedShadowsByTableId[tableId] ?? {})
      .filter(s => s._until > Date.now() && !liveIds.has(s.id))
      .map(({ _until, ...it }) => it);

    return [...mapped, ...shadows];
  }

  private setMark(tableId: string, itemId: string, kind: MarkKind, playSound: boolean = true) {
    const until = Date.now() + this.markMs;
    (this.marksByTableId[tableId] ??= {})[itemId] = { kind, until };
    if (playSound) this.queueSound(kind);
    const timerKey = `${tableId}:${itemId}`;
    if (this.clearMarkTimers[timerKey]) clearTimeout(this.clearMarkTimers[timerKey]);
    this.clearMarkTimers[timerKey] = setTimeout(() => {
      const m = this.marksByTableId[tableId]?.[itemId];
      if (m && m.until <= Date.now()) delete this.marksByTableId[tableId][itemId];
    }, this.markMs + 250);
  }

  private setOpText(tableId: string, itemId: string, text: string): void {
    (this.lastOpTextByTableId[tableId] ??= {})[itemId] = text;
  }

  private setDeletedShadow(tableId: string, itemId: string, item: KitchenLineItem): void {
    const until = Date.now() + this.markMs;
    (this.deletedShadowsByTableId[tableId] ??= {})[itemId] = { ...item, _until: until };
  }

  private queueSound(kind: MarkKind) {
    if (this.hydrating) return;
    if (document.hidden) return;
    if (this.soundMuted) return;

    this.debugSound('queueSound', { kind, hydrating: this.hydrating, hidden: document.hidden, muted: this.soundMuted });

    const mapped: NotificationSoundKind | null =
      kind === 'added' ? 'itemAdded'
        : kind === 'updated' ? 'qtyUpdated'
          : kind === 'deleted' ? 'itemDeleted'
            : null;
    if (!mapped) return;

    const priority: Record<NotificationSoundKind, number> = {
      newOrder: 4,
      itemDeleted: 3,
      itemAdded: 2,
      qtyUpdated: 1,
      uiToggle: 0
    };

    this.pendingSoundKind =
      (!this.pendingSoundKind || priority[mapped] >= priority[this.pendingSoundKind])
        ? mapped
        : this.pendingSoundKind;
    if (this.pendingSoundTimer) return;

    this.pendingSoundTimer = setTimeout(() => {
      this.pendingSoundTimer = null;
      const k = this.pendingSoundKind;
      this.pendingSoundKind = null;
      if (k) this.sounds.play(k);
    }, 0);
  }

  private diffAndMark(tableId: string, prev: CartItem[], next: CartItem[], isNewOrder: boolean) {
    const keyOf = (c: CartItem) => c.orderItemId ?? `menu:${c.item.menuItemId}`;
    const prevById = new Map(prev.map(p => [keyOf(p), p]));
    const nextById = new Map(next.map(n => [keyOf(n), n]));

    for (const [id, n] of nextById.entries()) {
      const p = prevById.get(id);
      if (!p) {
        this.setMark(tableId, id, 'added', !isNewOrder);
        if (!isNewOrder) {
          const label = this.tableLabel(tableId);
          this.toastOnce(`itemAdded:${tableId}:${id}`, 1500, () =>
            this.toast.sticky(
              this.transloco.translate('kitchen.toastNewItemBody', {
                name: this.displayNameForCartItem(n),
                qty: String(n.quantity),
                table: label
              }),
              this.transloco.translate('kitchen.toastNewItemTitle'),
              'info'
            )
          );
        }
      } else if (p.quantity !== n.quantity) {
        this.setMark(tableId, id, 'updated');
        const label = this.tableLabel(tableId);
        const prevQty = p.quantity;
        const nextQty = n.quantity;
        const arrow = nextQty > prevQty ? '↑' : '↓';
        this.setOpText(tableId, id, `${arrow} ${prevQty} → ${nextQty}`);
        if (nextQty > prevQty) {
          this.toastOnce(`qtyUp:${tableId}:${id}`, 1200, () =>
            this.toast.info(
              this.transloco.translate('kitchen.toastQtyUpBody', {
                name: this.displayNameForCartItem(n),
                prev: String(prevQty),
                next: String(nextQty),
                table: label
              }),
              this.transloco.translate('kitchen.toastQtyUpTitle'),
              8000
            )
          );
        } else {
          this.toastOnce(`qtyDown:${tableId}:${id}`, 1200, () =>
            this.toast.info(
              this.transloco.translate('kitchen.toastQtyDownBody', {
                name: this.displayNameForCartItem(n),
                prev: String(prevQty),
                next: String(nextQty),
                table: label
              }),
              this.transloco.translate('kitchen.toastQtyDownTitle'),
              8000
            )
          );
        }
      }
    }
    // Skip deletion detection when: new order (prev items belong to a different order)
    // or next is empty (order close — not a real item deletion).
    if (!isNewOrder && next.length > 0) {
      for (const id of prevById.keys()) {
        if (!nextById.has(id)) {
          this.setMark(tableId, id, 'deleted');
          const label = this.tableLabel(tableId);
          const prevItem = prevById.get(id);
          const name = prevItem ? this.displayNameForCartItem(prevItem) : 'Item';
          const qty = prevItem?.quantity ?? 0;
          this.setOpText(tableId, id, '× removed');
          if (prevItem) {
            this.setDeletedShadow(tableId, id, {
              id,
              orderItemId: prevItem.orderItemId,
              menuItemId: prevItem.item.menuItemId,
              name: this.displayNameForCartItem(prevItem),
              category: this.displayCategoryForCartItem(prevItem),
              quantity: prevItem.quantity,
              mark: { kind: 'deleted', until: Date.now() + this.markMs },
              opText: '× removed',
            });
          }
          this.toastOnce(`itemDeleted:${tableId}:${id}`, 1500, () =>
            this.toast.sticky(
              this.transloco.translate('kitchen.toastItemDeletedBody', { name, table: label }),
              this.transloco.translate('kitchen.toastItemDeletedTitle'),
              'warning'
            )
          );
        }
      }
    }
  }
}

