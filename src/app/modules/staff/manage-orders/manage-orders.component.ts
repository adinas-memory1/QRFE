// ─── IMPORTS ──────────────────────────────────────────────────────────────────
import { FormsModule } from '@angular/forms';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import Fuse from 'fuse.js';
import { IconDirective } from '@coreui/icons-angular';
import {
  BadgeComponent, ButtonCloseDirective, ButtonDirective, CardBodyComponent, CardComponent,
  CardFooterComponent, CardGroupComponent, CardHeaderComponent, CardImgDirective, CardTextDirective,
  CardTitleDirective, ColComponent, ColDirective, DropdownComponent, DropdownItemDirective,
  DropdownMenuDirective, DropdownToggleDirective, ModalBodyComponent, ModalComponent,
  ModalFooterComponent, ModalHeaderComponent, ModalTitleDirective, ModalToggleDirective,
  NavbarComponent, NavbarNavComponent, NavbarTogglerDirective, NavComponent, NavItemComponent,
  NavLinkDirective, OffcanvasBodyComponent, OffcanvasComponent, OffcanvasHeaderComponent,
  OffcanvasTitleDirective, OffcanvasToggleDirective, RowComponent, TableDirective, Tabs2Module,
  TemplateIdDirective, WidgetStatAComponent, WidgetStatFComponent
} from '@coreui/angular';
import { TablesService } from '../../../core/services/tables-service/tables.service';
import { AuthService } from '../../../core/auth/auth.service';
import { formatStaffDisplayName } from '../../../core/auth/user-display-name';
import { TableDTO } from '../../../core/models/restaurantTablesModel';
import { sortTablesByName } from '../../../core/utils/table-sort.util';
import { filter, Subject, take, takeUntil, debounceTime, forkJoin, from, firstValueFrom, pairwise, timeout, TimeoutError } from 'rxjs';
import { NgFor, NgIf, NgStyle, CurrencyPipe, DecimalPipe, JsonPipe, NgClass, DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { cilBellExclamation } from '@coreui/icons';
import { UserContextModel } from '../../../core/models/userContextModel';
import { WaiterCallState } from '../../../core/models/callWaiter/callWaiter';
import { MenuItem } from '../../../core/models/menu/menuItem';
import { SetMenuDTO, setMenuToMenuItem } from '../../../core/models/menu/setMenu';
import { isKitchenCartLine } from '../../../core/models/menu/cart-item-category';
import { MenuItemServiceService } from '../../../core/services/menu-item-service/menu-item-service.service';
import { OrdersService } from '../../../core/services/order-service/orders.service';
import {
  CartItem,
  TableCart,
  OrderUpdatedSSEPayload,
  TableComputedDTO,
  OrderDTO,
  OrderItemDTO,
  applyOrderCurrencyToCart,
  cartItemFromOrderLine,
  cartItemsFromSseLines,
  normalizeCurrencyCode,
  orderDtoFromSsePayload,
  readMoneyAmount,
  readOrderLastInitiatedBy,
  resolveOrderCurrency,
  tableHasActiveOrder,
} from '../../../core/models/orderingModel';
import { OrderSyncService } from '../../../core/services/order-service/order-sync.service';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';
import { OfflineDbService } from '../../../core/offline/offline-db';
import { OfflineQueueProcessor } from '../../../core/offline/offline-queue-processor.service';
import { SseEvent } from '../../../core/models/sseModel';
import { OnlineStateService } from '../../../core/offline/online-state-service';
import { OfflinePolicyService } from '../../../core/offline/offline-policy.service';
import { OfflinePrintContextService } from '../../../core/offline/offline-print-context.service';
import { OfflinePrintService } from '../../../core/offline/offline-print.service';
import { OfflinePrimaryService } from '../../../core/services/offline-primary/offline-primary.service';
import { OfflineSyncSchedulerService } from '../../../core/offline/offline-sync-scheduler.service';
import { RestaurantCurrencyService } from '../../../core/offline/restaurant-currency.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { KitchenService } from '../../../core/services/kitchen-service/kitchen.service';
import { BarService } from '../../../core/services/bar-service/bar.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { PrintJobsService, FiscalPrinterSettingsDto } from '../../../core/services/print-jobs/print-jobs.service';
import { FiscalDocumentsService } from '../../../core/services/fiscal-documents/fiscal-documents.service';
import { canIssueFiscalReceiptForOrder } from '../../../core/fiscal/fiscal-order-print.builder';
import { buildFiscalPrintItems } from '../../../core/fiscal/fiscal-print-payload.builder';
import { DeviceFeedbackService } from '../../../core/services/device/device-feedback.service';
import { PickupNotificationService } from '../../../core/services/pickup/pickup-notification.service';
import {
  ReservationItem,
  ReservationService,
} from '../../../core/services/reservation-service/reservation.service';

/** RFC3339 with browser local timezone offset. */
function toRfc3339WithOffset(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

function localDayBounds(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: toRfc3339WithOffset(start), to: toRfc3339WithOffset(end) };
}

@Component({
  selector: 'app-manage-orders',
  imports: [
    RowComponent, Tabs2Module, FormsModule,
    ColComponent, NgFor, NgIf, TableDirective,
    CardBodyComponent, CurrencyPipe, DecimalPipe, JsonPipe,
    CardComponent, CardGroupComponent, CardHeaderComponent,
    CardFooterComponent, ButtonDirective,
    CardImgDirective, BadgeComponent, ButtonCloseDirective,
    CardTextDirective, CardTitleDirective, ColComponent,
    ColDirective, NgStyle, IconDirective, RouterLink, DatePipe, NgTemplateOutlet,
    OffcanvasBodyComponent, OffcanvasComponent, OffcanvasHeaderComponent,
    OffcanvasTitleDirective, OffcanvasToggleDirective,
    NavComponent, DropdownComponent, DropdownItemDirective,
    DropdownMenuDirective, DropdownToggleDirective,
    NavLinkDirective, NgClass,
    TranslocoPipe,
    ModalComponent,
    ModalHeaderComponent,
    ModalBodyComponent,
    ModalFooterComponent,
    ModalTitleDirective,
  ],
  styleUrls: ['./manage-orders.component.scss'],
  standalone: true,
  templateUrl: './manage-orders.component.html'
})
export class ManageOrdersComponent implements OnInit, OnDestroy {
  icons = { cilBellExclamation };
  private destroy$ = new Subject<void>();
  private readonly recentSseSequences: number[] = [];
  private readonly recentSseSequenceSet = new Set<number>();
  private readonly maxRecentSseSequences = 300;
  private restaurantId = '';
  readonly fiscalStaffConfig = signal<FiscalPrinterSettingsDto | null>(null);
  readonly billStaffConfig = signal<{ defaultBillPrinterId: string | null } | null>(null);

  waiterState: Record<string, WaiterCallState> = {};
  WaiterCallState = WaiterCallState;
  kitchenPickupRequested: Record<string, boolean> = {};
  private kitchenPickupTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  barPickupRequested: Record<string, boolean> = {};
  private barPickupTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private snapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  modalVisible = false;
  categories: string[] = [];
  menuItems: MenuItem[] = [];
  todaySetMenu: SetMenuDTO | null = null;
  setMenuModalVisible = false;
  setMenuQty = 1;
  setMenuTargetTable: TableDTO | null = null;
  forceRefreshAfterUpdate = Date.now();
  tableName: string = '';
  canvasVisible = false;
  selectedCategory: string | null = null;
  tableCarts: TableCart = {};
  currentTableId!: string;
  seatId: string | null = null;
  tables: TableDTO[] = [];
  openTables: TableDTO[] = [];
  closedTables: TableDTO[] = [];
  searchTerm: string = '';
  search$ = new Subject<string>();
  filteredResults: MenuItem[] = [];
  private fuse!: Fuse<MenuItem>;
  selectedTargetTableId: string | null = null;
  orderIsConfirmed = false;
  currentOrderId: string | null = null;
  showCloseConfirm = false;
  private closeInFlight = false;
  resetConfirmVisible = false;

  /**
   * Sursa unică de adevăr pentru disponibilitatea meselor.
   * Derivată din this.tables[] via buildAvailabilityMap și sincronizată în Dexie.
   */
  tablesAvailable: Record<string, boolean> = {};

  tableComputed: Record<string, {
    lastActionAt: string;
    lastAddedItem: string;
    total: number;
    currency: string;
    itemCount: number;
    cssClass: string;
    initiatedBy: string;
  }> = {};

  /** When present, staff mutations are frozen (client is paying). */
  paymentLockedByTable: Record<string, { orderId: string; expiresAtUtc?: string }> = {};
  private paymentLockCheckedAtByOrder: Record<string, number> = {};

  /** Survives SSE snapshots that arrive before forkJoin finishes (re-entry race). */
  private persistedInitiatedBy: Record<string, string> = {};
  private initialTablesLoaded = false;
  bookingsByTableId: Record<string, ReservationItem[]> = {};
  bookingsLoading = false;
  bindOfflinePrimaryInProgress = false;
  /** Tables with local Dexie cart/order on this device (partial offline re-entry). */
  private localSessionTableIds = new Set<string>();

  constructor(
    private tablesService: TablesService,
    private menuItemService: MenuItemServiceService,
    private authService: AuthService,
    private ordersService: OrdersService,
    private sseService: OrderSyncService,
    private kitchenService: KitchenService,
    private barService: BarService,
    private miscService: MiscellaneousService,
    private offlineDB: OfflineDbService,
    private onlineStateService: OnlineStateService,
    private queueProcessor: OfflineQueueProcessor,
    private appToast: AppToastService,
    private transloco: TranslocoService,
    private printJobs: PrintJobsService,
    private deviceFeedback: DeviceFeedbackService,
    private pickupNotification: PickupNotificationService,
    private reservationService: ReservationService,
    private offlinePolicy: OfflinePolicyService,
    private offlinePrimary: OfflinePrimaryService,
    private offlinePrintContext: OfflinePrintContextService,
    private offlinePrintService: OfflinePrintService,
  ) {}

  private readonly syncScheduler = inject(OfflineSyncSchedulerService);
  private readonly restaurantCurrency = inject(RestaurantCurrencyService);
  private readonly fiscalDocuments = inject(FiscalDocumentsService);

  readonly offlineSyncCountdown = toSignal(this.syncScheduler.syncCountdownSeconds$, { initialValue: null });
  /** Display seconds with 0.1 precision (countdown ticks are 100ms). */
  readonly offlineSyncCountdownSeconds = computed(() => {
    const ticks = this.offlineSyncCountdown();
    return ticks === null ? null : (ticks / 10).toFixed(1);
  });
  readonly offlineSyncBlocked = toSignal(this.syncScheduler.syncBlocked$, { initialValue: false });
  readonly offlineSyncBatchDraining = toSignal(this.syncScheduler.batchSyncDraining$, { initialValue: false });
  readonly offlineSyncReconciling = toSignal(this.sseService.isReconciling$, { initialValue: false });
  readonly isReconnectSyncInProgress = computed(
    () =>
      this.offlineSyncCountdown() !== null
      || this.offlineSyncBlocked()
      || this.offlineSyncBatchDraining()
      || this.offlineSyncReconciling(),
  );
  readonly showOfflineSyncModal = computed(
    () => this.isReconnectSyncInProgress(),
  );

  bookingsForTable(tableId: string): ReservationItem[] {
    return this.bookingsByTableId[tableId] ?? [];
  }

  loadTodayBookings(): void {
    if (!this.restaurantId) {
      this.bookingsByTableId = {};
      return;
    }

    const { from, to } = localDayBounds();
    this.bookingsLoading = true;
    this.reservationService
      .list(this.restaurantId, { from, to, includeCancelled: false, take: 200 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (items) => {
          this.bookingsLoading = false;
          const grouped: Record<string, ReservationItem[]> = {};
          for (const item of items) {
            const key = item.tableId;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
          }
          for (const key of Object.keys(grouped)) {
            grouped[key].sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
            );
          }
          this.bookingsByTableId = grouped;
        },
        error: () => {
          this.bookingsLoading = false;
          this.bookingsByTableId = {};
        },
      });
  }

  formatInitiatedBy(raw: string): string {
    const v = (raw ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'stripe') return this.transloco.translate('manageOrders.byCardPayment');
    return raw;
  }

  private currentStaffDisplayName(): string {
    return formatStaffDisplayName(this.authService.getUserSnapshot() ?? {});
  }

  /**
   * Merge "updated by" from dedicated storage + tableComputed.
   * @param replaceTableComputed when true (first init), restore full computed blob from localStorage.
   */
  private capturePersistedInitiatedBy(options?: { replaceTableComputed?: boolean }): void {
    const replaceTableComputed = options?.replaceTableComputed !== false;
    const persisted = this.ordersService.loadComputed() || {};
    const dedicated = this.ordersService.loadInitiatedByMap();

    if (replaceTableComputed) {
      this.tableComputed = persisted;
    }

    for (const [tableId, by] of Object.entries(dedicated)) {
      const v = by?.trim();
      if (v) this.persistedInitiatedBy[tableId] = v;
    }
    for (const [tableId, computed] of Object.entries(persisted)) {
      const by = computed?.initiatedBy?.trim();
      if (by) this.persistedInitiatedBy[tableId] = by;
    }
  }

  /** Re-apply persisted names only when sync/order snapshot has no LastInitiatedBy. */
  private applyPersistedInitiatedByToComputed(): void {
    for (const [tableId, by] of Object.entries(this.persistedInitiatedBy)) {
      if (!by?.trim()) continue;
      const table = this.tables.find(t => t.tableId === tableId);
      if (!table) continue;
      if (readOrderLastInitiatedBy(table.order)) continue;

      const existing = this.tableComputed[tableId];
      if (existing) {
        if (!existing.initiatedBy?.trim()) {
          this.tableComputed[tableId] = { ...existing, initiatedBy: by };
        }
      } else if (!table.isTableOpen || table.order) {
        this.tableComputed[tableId] = {
          lastActionAt: '',
          lastAddedItem: '—',
          total: 0,
          currency: '',
          itemCount: 0,
          cssClass: this.miscService.getTableCss(table, this.waiterState),
          initiatedBy: by,
        };
      }
    }
  }

  private resolveInitiatedBy(tableId: string, sseInitiatedBy?: string | null): string {
    const fromSse = sseInitiatedBy?.trim();
    if (fromSse) {
      return fromSse;
    }
    const table = this.tables.find(t => t.tableId === tableId);
    const fromOrder = readOrderLastInitiatedBy(table?.order);
    if (fromOrder) {
      return fromOrder;
    }
    const fromPersisted = this.persistedInitiatedBy[tableId]?.trim();
    if (fromPersisted) {
      return fromPersisted;
    }
    return this.tableComputed[tableId]?.initiatedBy?.trim() ?? '';
  }

  /** Persist staff names from authoritative order snapshot (/api/sync, REST tables). */
  private applyInitiatedByFromSyncedOrders(): void {
    for (const t of this.tables) {
      const by = readOrderLastInitiatedBy(t.order);
      if (!by || !t.tableId) {
        continue;
      }
      const serverActionAt = this.readOrderLastActionAt(t.order);
      const computedActionAt = this.tableComputed[t.tableId]?.lastActionAt ?? '';
      // Keep a fresher name from SSE if the sync snapshot is behind (e.g. secondary just mutated).
      if (computedActionAt && serverActionAt && serverActionAt < computedActionAt) {
        continue;
      }
      this.rememberInitiatedBy(t.tableId, by);
    }
  }

  private readOrderLastActionAt(order: OrderDTO | null | undefined): string {
    if (!order) {
      return '';
    }
    const rec = order as unknown as Record<string, unknown>;
    const v = rec['lastActionAt'] ?? rec['LastActionAt'] ?? rec['updatedAt'] ?? rec['UpdatedAt'];
    return typeof v === 'string' ? v.trim() : '';
  }

  private rememberInitiatedBy(tableId: string, initiatedBy: string): void {
    const by = initiatedBy?.trim();
    if (!by || !tableId) {
      return;
    }
    this.persistedInitiatedBy[tableId] = by;
    if (this.tableComputed[tableId]) {
      this.tableComputed[tableId] = { ...this.tableComputed[tableId], initiatedBy: by };
    }
    this.ordersService.saveInitiatedByMap(this.persistedInitiatedBy);
  }

  private isPaymentLockedForCurrentTable(): boolean {
    const tableId = this.currentTableId;
    if (!tableId) return false;
    const lock = this.paymentLockedByTable[tableId];
    if (!lock) return false;
    // Only lock the active order context.
    if (!this.currentOrderId) return false;
    return lock.orderId === this.currentOrderId;
  }

  private async ensureNotPaymentLockedAsync(): Promise<boolean> {
    if (!this.isOnline) return true; // offline: keep current behavior
    if (!this.orderIsConfirmed) return true;
    const orderId = this.currentOrderId;
    const tableId = this.currentTableId;
    if (!orderId || orderId.startsWith('local-') || !tableId) return true;

    // fast path if already locked
    if (this.isPaymentLockedForCurrentTable()) return false;

    // cache lock check for 3s per order to avoid spamming
    const now = Date.now();
    const last = this.paymentLockCheckedAtByOrder[orderId] ?? 0;
    if (now - last < 3000) return true;
    this.paymentLockCheckedAtByOrder[orderId] = now;

    try {
      const res = await firstValueFrom(this.ordersService.getOrderPaymentLock(this.restaurantId, orderId));
      if (res?.locked) {
        this.paymentLockedByTable[tableId] = { orderId };
        this.appToast.info(
          this.transloco.translate('manageOrders.orderLockedForPaymentBody'),
          this.transloco.translate('manageOrders.orderLockedForPaymentTitle'),
        );
        return false;
      }
    } catch {
      // if check fails, don't block UX; backend will still return 409
    }
    return true;
  }

  private sseField<T = unknown>(obj: any, pascal: string, camel: string): T | undefined {
    if (!obj) return undefined;
    return (obj[pascal] ?? obj[camel]) as T | undefined;
  }

  private pickupToastMessage(kind: 'kitchen' | 'bar', tableId: string, tableName?: string | null): string {
    const label = (tableName ?? '').trim() || (this.tables.find(t => t.tableId === tableId)?.tableName ?? tableId);
    const titleKey = kind === 'kitchen' ? 'push.kitchenTitle' : 'push.barTitle';
    return `${this.transloco.translate(titleKey)}: ${this.transloco.translate('push.pickupReadyTable', { table: tableName })}`;
  }

  // ─── GETTERS ──────────────────────────────────────────────────────────────────

  get isOnline() { return this.onlineStateService.isOnline; }

  /** Blocks staff POS writes during reconnect UI, offline freeze, or restaurant-wide sync lock. */
  private isPosMutationBlocked(): boolean {
    if (this.isReconnectSyncInProgress()) {
      return true;
    }
    return this.offlinePolicy.shouldFreezePosActions();
  }

  /** Online staff or designated primary device in full-offline mode. */
  get canBypassOfflineUiGates(): boolean {
    if (this.isReconnectSyncInProgress()) {
      return false;
    }
    if (this.offlinePolicy.shouldFreezeForRestaurantSync()) {
      return false;
    }
    return this.isOnline || this.offlinePolicy.canUseFullOffline();
  }

  private hasLocalSessionForTable(tableId: string): boolean {
    return this.localSessionTableIds.has(tableId);
  }

  private async refreshLocalSessionTableIds(): Promise<void> {
    const tableIds = await this.offlineDB.getTableIdsWithLocalSession();
    this.localSessionTableIds = new Set(tableIds);
  }

  isTableActionDisabled(table: TableDTO, requireOnline: boolean): boolean {
    if (this.isReconnectSyncInProgress()) {
      return true;
    }
    if (this.offlinePolicy.shouldFreezeForRestaurantSync()) {
      return true;
    }
    if (!requireOnline) {
      return false;
    }
    if (this.isOnline) {
      return false;
    }
    // Offline: only the bound primary device may operate (semi-offline frozen).
    return !this.offlinePolicy.canUseFullOffline();
  }

  isSetMenuActionDisabled(): boolean {
    if (this.isReconnectSyncInProgress()) {
      return true;
    }
    if (this.offlinePolicy.shouldFreezeForRestaurantSync()) {
      return true;
    }
    if (this.isOnline) {
      return false;
    }
    return !this.offlinePolicy.canUseFullOffline();
  }

  async onTableActionClick(table: TableDTO, requireOnline: boolean): Promise<void> {
    const disabled = this.isTableActionDisabled(table, requireOnline);
    if (disabled) {
      return;
    }
    if (table.order) {
      await this.seeOrder(table);
    } else {
      await this.openTable(table);
    }
  }

  get isRomanianLocale(): boolean {
    return this.transloco.getActiveLang() === 'ro';
  }

  /** Print allowed online, or offline on primary device with cached agent config. */
  get canPrintBill(): boolean {
    if (this.isOnline) {
      return true;
    }
    return this.offlinePolicy.canUseFullOffline() && this.offlinePrintContext.isReadyForOfflinePrint();
  }

  /** Kitchen ESC/POS button: only when a non-fiscal bill printer is registered. */
  get canPrintKitchen(): boolean {
    return !!this.resolveNonFiscalPrinterId();
  }

  get canPrintFiscal(): boolean {
    if (!this.isOnline && this.offlinePolicy.canUseFullOffline()) {
      return this.offlinePrintContext.isReadyForOfflineFiscalPrint();
    }
    const cfg = this.fiscalStaffConfig();
    return !!cfg?.fiscalPrintingEnabled && !!(cfg?.defaultFiscalPrinterId ?? '').trim();
  }

  get canOpenCashDrawer(): boolean {
    return this.canPrintFiscal;
  }

  get shouldShowBindDeviceCta(): boolean {
    return this.offlinePolicy.shouldShowBindDeviceCta();
  }

  get shouldShowOfflinePrimaryDeviceBanner(): boolean {
    return this.offlinePolicy.shouldShowOfflinePrimaryDeviceBanner();
  }

  async bindOfflinePrimaryDevice(): Promise<void> {
    if (this.bindOfflinePrimaryInProgress || !this.restaurantId) return;
    this.bindOfflinePrimaryInProgress = true;
    try {
      const bindResult = await firstValueFrom(this.offlinePrimary.bindDevice(this.restaurantId));
      const snap = this.authService.getUserSnapshot();
      if (snap) {
        this.authService.setUser({
          ...snap,
          isOfflinePrimaryDevice: bindResult.isOfflinePrimaryDevice === true,
        });
      }
      await firstValueFrom(this.authService.pingSession());
      this.appToast.success(
        this.transloco.translate('manageOrders.bindOfflinePrimarySuccessBody'),
        this.transloco.translate('manageOrders.bindOfflinePrimarySuccessTitle'),
      );
    } catch (err) {
      console.error('Bind offline primary device failed', err);
      this.appToast.error(
        this.miscService.getFirstErrorMessage(err),
        this.transloco.translate('manageOrders.bindOfflinePrimaryErrorTitle'),
      );
    } finally {
      this.bindOfflinePrimaryInProgress = false;
    }
  }

  get filteredMenuItems(): MenuItem[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return [];
    return this.effectiveMenuItems.filter(i => i.menuItemName.toLowerCase().includes(term));
  }

  get selectedItems(): CartItem[] {
    return this.tableCarts[this.currentTableId] ?? [];
  }

  get filteredItems() {
    return this.menuItems.filter(i => i.category === this.selectedCategory);
  }

  /** Current presentation menu plus lines already on the open order (other menu modes). */
  private get effectiveMenuItems(): MenuItem[] {
    const byId = new Map(this.menuItems.map(m => [m.menuItemId, m]));
    for (const line of this.selectedItems) {
      if (line.item?.menuItemId && !byId.has(line.item.menuItemId)) {
        byId.set(line.item.menuItemId, line.item);
      }
    }
    return [...byId.values()];
  }

  get groupedMenuItems(): { [category: string]: MenuItem[] } {
    return this.effectiveMenuItems.reduce((acc, item) => {
      const cat = item.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {} as { [category: string]: MenuItem[] });
  }

  get nonEmptyCategories(): string[] {
    const cats = new Set(this.categories);
    for (const line of this.selectedItems) {
      if (line.item?.category) cats.add(line.item.category);
    }
    return [...cats].filter(cat => this.groupedMenuItems[cat]?.length > 0);
  }

  /**
   * Mese libere pentru mutare: exclude masa curentă, bazat pe tablesAvailable.
   */
  get availableTablesForMove(): TableDTO[] {
    return this.tables.filter(t =>
      t.tableId !== this.currentTableId &&
      this.tablesAvailable[t.tableId] === true
    );
  }

  get cartSubTotal(): number {
    const cart = this.tableCarts[this.currentTableId] ?? [];
    return cart.reduce((sum, s) => sum + s.item.menuItemPriceAmount * s.quantity, 0);
  }

  get cartCurrency(): string | undefined {
    return this.operatingCurrency;
  }

  /** Restaurant operating currency for POS totals, cart lines, and canvas menu prices. */
  get operatingCurrency(): string | undefined {
    const tableId = this.currentTableId;
    const order = this.tables.find(t => t.tableId === tableId)?.order;
    const resolved = this.restaurantCurrency.resolve(
      this.tableComputed[tableId]?.currency !== '—'
        ? this.tableComputed[tableId]?.currency
        : '',
      resolveOrderCurrency(order),
      this.tableCarts[tableId]?.[0]?.item.menuItemPriceCurrency,
    );
    return resolved || undefined;
  }

  /** Table-card currency label (always prefer restaurant operating currency). */
  tableDisplayCurrency(tableId: string): string {
    const computed = this.tableComputed[tableId]?.currency;
    return this.displayCurrency(
      computed && computed !== '—' ? computed : '',
      resolveOrderCurrency(this.tables.find(t => t.tableId === tableId)?.order),
    );
  }

  /** Operating currency for stamping cart lines / table totals. */
  private displayCurrency(...fallbacks: Array<string | null | undefined>): string {
    return this.restaurantCurrency.resolve(...fallbacks);
  }

  private stampAllCarts(carts: TableCart): TableCart {
    return Object.fromEntries(
      Object.entries(carts).map(([tableId, items]) => {
        const order = this.tables.find(t => t.tableId === tableId)?.order;
        return [tableId, applyOrderCurrencyToCart(items, this.displayCurrency(resolveOrderCurrency(order)))];
      }),
    );
  }

  /**
   * FIX BUG 5: Anterior verifica Object.values(tablesAvailable).some(v => v === true)
   * fără să excludă masa curentă → putea returna true fără ținte reale.
   * Acum folosește availableTablesForMove care exclude corect masa curentă.
   */
  canMoveOrder(): boolean {
    return (
      this.isOnline &&
      this.orderIsConfirmed &&
      !!this.currentOrderId &&
      !this.currentOrderId.startsWith('local-') &&
      this.availableTablesForMove.length > 0
    );
  }

  // ─── KEYBOARD ─────────────────────────────────────────────────────────────────

  @HostListener('document:keydown.escape')
  onEscPressed() {
    if (this.searchTerm) {
      this.searchTerm = '';
      this.filteredResults = [];
      (document.querySelector('#searchInput') as HTMLInputElement)?.focus();
    }
  }

  trackByTableId(_: number, table: TableDTO) { return table.tableId; }

  // ─── ORDER ACTIONS ────────────────────────────────────────────────────────────

  async confirmOrder() {
    if (document.hidden) return;
    if (this.isPosMutationBlocked()) {
      return;
    }
    if (!this.isOnline && !this.offlinePolicy.canUseFullOffline()) {
      return;
    }

    const localOrderId =
      'local-' + (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    this.currentOrderId = localOrderId;
    this.orderIsConfirmed = true;

    const inMemoryCart = this.tableCarts[this.currentTableId] ?? [];
    const persistedCart = await this.offlineDB.loadCart(this.currentTableId);
    const cart = inMemoryCart.length > 0 ? inMemoryCart : persistedCart;
    await this.offlineDB.saveCart(this.currentTableId, cart, localOrderId, false, this.restaurantId);
    this.tableCarts[this.currentTableId] = [...cart];

    await this.offlineDB.addOfflineAction({
      type: 'NEW_ORDER',
      restaurantId: this.restaurantId,
      tableId: this.currentTableId,
      orderId: localOrderId,
      payload: { seatId: this.seatId ?? null }
    });

    await this.offlineDB.addOfflineAction({
      type: 'INIT_ORDER_ITEMS_FINAL',
      restaurantId: this.restaurantId,
      tableId: this.currentTableId,
      orderId: localOrderId,
      payload: { items: cart.map(ci => ({ menuItemId: ci.item.menuItemId, quantity: ci.quantity })) }
    });

    const confirmedBy = this.currentStaffDisplayName();
    if (confirmedBy) {
      this.rememberInitiatedBy(this.currentTableId, confirmedBy);
    }

    this.markTableAsClosed(this.currentTableId);
    this.updateComputedLocal(this.currentTableId);

    await this.refreshLocalSessionTableIds();

    if (this.onlineStateService.isOnline) this.queueProcessor.triggerProcessing();
  }

  async addCartItem(item: MenuItem) {
    if (this.isPosMutationBlocked()) {
      return;
    }
    const tableId = this.currentTableId;
    if (!(await this.ensureNotPaymentLockedAsync())) {
      return;
    }

    if (item.isAvailable === false) {
      this.appToast.info(this.transloco.translate('menu.availability.staff.unavailableToast'));
      return;
    }
    const record = await this.offlineDB.loadCartRecord(tableId);
    const orderId = record?.orderId ?? null;
    const cart = record?.items ?? [];

    const currency = this.displayCurrency();
    const pricedItem = currency
      ? { ...item, menuItemPriceCurrency: currency }
      : item;
    const existing = cart.find(x => x.item.menuItemId === pricedItem.menuItemId);
    if (existing) existing.quantity++;
    else cart.push({ item: pricedItem, quantity: 1, orderItemId: undefined });

    const stamped = applyOrderCurrencyToCart(cart, currency);
    await this.offlineDB.saveCart(tableId, stamped, orderId ?? undefined, false, this.restaurantId);
    this.tableCarts[tableId] = [...stamped];

    if (!this.orderIsConfirmed) return;

    await this.offlineDB.addOfflineAction({
      type: existing ? 'UPDATE_QUANTITY' : 'ADD_ITEM',
      restaurantId: this.restaurantId,
      tableId,
      orderId: orderId ?? undefined,
      payload: {
        orderItemId: existing?.orderItemId ?? null,
        menuItemId: item.menuItemId,
        quantity: existing ? existing.quantity : 1
      }
    });

    if (this.onlineStateService.isOnline) this.queueProcessor.triggerProcessing();
  }

  displayMenuItemNameInCanvas(item: MenuItem): string {
    const name = item.menuItemName ?? '';
    if (item.isAvailable !== false) return name;

    // Only truncate for unavailable items (canvas view). Keep full names elsewhere.
    const max = 18;
    return name.length > max ? name.slice(0, max - 1).trimEnd() + '…' : name;
  }

  updateComputedLocal(tableId: string) {
    const cart = this.tableCarts[tableId] ?? [];
    const table = this.tables.find(t => t.tableId === tableId);
    if (!table) return;

    this.tableComputed[tableId] = {
      lastActionAt: new Date().toISOString(),
      lastAddedItem: cart.length ? cart[cart.length - 1].item.menuItemName : '—',
      total: cart.reduce((s, c) => s + c.item.menuItemPriceAmount * c.quantity, 0),
      currency: this.displayCurrency(cart[0]?.item.menuItemPriceCurrency),
      itemCount: cart.reduce((s, c) => s + c.quantity, 0),
      cssClass: this.miscService.getTableCss(table, this.waiterState),
      initiatedBy: this.resolveInitiatedBy(tableId)
    };

    this.ordersService.saveComputed(this.tableComputed);
  }

  private hydrateComputedFromTables(): void {
    // REST is authoritative for initial state; SSE only updates.
    // If SSE is temporarily down (expired token, reconnecting), this ensures totals aren't stuck at 0/undefined.
    for (const t of this.tables) {
      const order = t.order;

      // no order -> keep / ensure empty computed
      if (!tableHasActiveOrder(order)) {
        this.tableComputed[t.tableId] = this.ordersService.mapComputedDtoToComputed(
          { tableId: t.tableId, isTableOpen: !!t.isTableOpen },
          this.tables,
          this.waiterState,
          this.resolveInitiatedBy(t.tableId)
        );
        continue;
      }

      const activeOrder = order!;
      const items = (activeOrder.orderItems ?? []).filter((x): x is NonNullable<typeof x> => !!x);
      const existing = this.tableComputed[t.tableId];
      const itemCountFromOrder = items.reduce((s, i) => s + (i.quantity ?? 0), 0);
      // NewOrderPrivateEvent may mark table occupied before orderItems arrive; keep prior totals.
      const itemCount =
        itemCountFromOrder > 0
          ? itemCountFromOrder
          : (existing?.itemCount ?? 0);

      const subtotalAmount =
        readMoneyAmount(activeOrder.subTotal)
        ?? readMoneyAmount(activeOrder.finalTotalPrice)
        ?? items.reduce((s, i) => s + ((i.orderItemPriceAmount ?? 0) * (i.quantity ?? 0)), 0);

      // Restaurant operating currency wins over stale order/menu EUR after a currency switch.
      const currency = this.displayCurrency(
        resolveOrderCurrency(activeOrder),
        existing?.currency,
      );

      const lastAddedItemFromOrder =
        items.length ? items[items.length - 1].orderItemName : null;
      const lastAddedItem =
        lastAddedItemFromOrder ?? existing?.lastAddedItem ?? '—';

      this.tableComputed[t.tableId] = {
        lastActionAt: this.tableComputed[t.tableId]?.lastActionAt ?? '',
        lastAddedItem,
        total: subtotalAmount ?? 0,
        currency: currency !== '—' ? currency : '',
        itemCount,
        cssClass: this.miscService.getTableCss(t, this.waiterState),
        initiatedBy: this.resolveInitiatedBy(t.tableId)
      };
    }

    this.ordersService.saveComputed(this.tableComputed);
  }

  private reloadPersistedInitiatedByFromStorage(): void {
    const dedicated = this.ordersService.loadInitiatedByMap();
    for (const [tableId, by] of Object.entries(dedicated)) {
      const v = by?.trim();
      if (v) this.persistedInitiatedBy[tableId] = v;
    }
    const persisted = this.ordersService.loadComputed() || {};
    for (const [tableId, computed] of Object.entries(persisted)) {
      const by = (computed as { initiatedBy?: string })?.initiatedBy?.trim();
      if (by) this.persistedInitiatedBy[tableId] = by;
    }
  }

  /** Apply authoritative table list from GET /api/sync or get-tables-status. */
  private applyAuthoritativeTables(tables: TableDTO[]): void {
    this.tables = sortTablesByName(tables);
    this.reconcileTableOccupancyFlags();
    this.refreshTableLists();
    this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
    void this.offlineDB.saveTables(this.tables);
    void this.offlineDB.saveTablesStatus(this.tablesAvailable);
  }

  /** Green = isTableOpen; red = occupied. Snapshot/SSE can lag — align from active order. */
  private reconcileTableOccupancyFlags(): void {
    let changed = false;
    const next = this.tables.map(t => {
      if (tableHasActiveOrder(t.order) && t.isTableOpen) {
        changed = true;
        return { ...t, isTableOpen: false };
      }
      return t;
    });
    if (!changed) {
      return;
    }
    this.tables = next;
  }

  /** Reload in-memory state from Dexie after /api/sync (e.g. app resume from background). */
  private async reloadFromSyncSnapshot(activeGuestWaiterCalls: string[] = []): Promise<void> {
    if (!this.initialTablesLoaded || !this.restaurantId) return;

    this.reconcileGuestWaiterCalls(activeGuestWaiterCalls);

    this.tables = await this.offlineDB.loadLocalTables();
    this.reconcileTableOccupancyFlags();
    this.refreshTableLists();
    this.tableCarts = this.stampAllCarts(await this.offlineDB.loadAllCarts());
    this.tablesAvailable = await this.offlineDB.loadTablesStatusMap();

    this.applyInitiatedByFromSyncedOrders();
    this.reloadPersistedInitiatedByFromStorage();
    this.hydrateComputedFromTables();
    this.applyPersistedInitiatedByToComputed();
    this.ordersService.saveComputed(this.tableComputed);
    this.loadTodayBookings();

    for (const tableId of Object.keys(this.tableComputed)) {
      const table = this.tables.find(t => t.tableId === tableId);
      if (table && this.tableComputed[tableId]) {
        this.tableComputed[tableId].cssClass = this.miscService.getTableCss(table, this.waiterState);
      }
    }

    if (this.currentTableId && this.canvasVisible) {
      const table = this.tables.find(t => t.tableId === this.currentTableId);
      const record = await this.offlineDB.loadCartRecord(this.currentTableId);
      if (!record && !tableHasActiveOrder(table?.order)) {
        this.resetCanvasState();
      } else if (record) {
        this.currentOrderId = record.orderId ?? table?.order?.orderId ?? null;
        this.orderIsConfirmed = !!this.currentOrderId || tableHasActiveOrder(table?.order);
        this.tableCarts[this.currentTableId] = applyOrderCurrencyToCart(
          record.items,
          this.displayCurrency(resolveOrderCurrency(table?.order)),
        );
        if (this.orderIsConfirmed) {
          this.claimPickupTargetForTable(this.currentTableId);
        }
      } else if (tableHasActiveOrder(table?.order)) {
        this.currentOrderId = table?.order?.orderId ?? null;
        this.orderIsConfirmed = true;
        this.claimPickupTargetForTable(this.currentTableId);
      }
    }
  }

  /** Pull authoritative carts after remote order open (event alone has no line items). */
  private scheduleSnapshotRefreshAfterPublicOrder(): void {
    if (this.snapshotRefreshTimer !== null) {
      clearTimeout(this.snapshotRefreshTimer);
    }
    this.snapshotRefreshTimer = setTimeout(() => {
      this.snapshotRefreshTimer = null;
      void this.sseService.refreshRestaurantSnapshot({ force: true });
    }, 500);
  }

  /** Secondary devices receive NewOrderPrivateEvent on internal SSE; mark table occupied. */
  private applyRemoteOrderOpenedOnTable(tableId: string, orderId: string, source: 'NewOrderPublicEvent' | 'NewOrderPrivateEvent'): void {
    this.tables = this.tables.map(t =>
      t.tableId === tableId
        ? {
            ...t,
            isTableOpen: false,
            order: {
              ...(t.order ?? {}),
              orderId,
              isOrderOpen: true,
            } as OrderDTO,
          }
        : t,
    );
    this.refreshTableLists();
    this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
    void this.offlineDB.saveTables(this.tables);
    void this.offlineDB.saveTablesStatus(this.tablesAvailable);
    this.markTableAsClosed(tableId);
    this.reconcileTableOccupancyFlags();
    this.hydrateComputedFromTables();

    if (this.currentTableId === tableId && this.canvasVisible) {
      this.currentOrderId = orderId;
      this.orderIsConfirmed = true;
      this.claimPickupTargetForTable(tableId);
    }
    this.scheduleSnapshotRefreshAfterPublicOrder();
  }

  /** Bind pickup haptics/FCM to this device while the waiter actively serves the table. */
  private readonly claimPickupInFlight = new Set<string>();
  /** Avoid re-claim storms from multiple UI/SSE paths within a short window. */
  private readonly claimPickupCooldownUntil = new Map<string, number>();
  private static readonly claimPickupCooldownMs = 15_000;

  private claimPickupTargetForTable(tableId: string): void {
    const restaurantId = this.restaurantId;
    const table = this.tables.find(t => t.tableId === tableId);
    const orderId =
      (this.currentTableId === tableId ? this.currentOrderId : null)
      ?? table?.order?.orderId
      ?? null;
    const isLocalOrder = !!orderId?.startsWith('local-');
    const cooldownKey = `${tableId}|${orderId ?? ''}`;
    const cooldownUntil = this.claimPickupCooldownUntil.get(cooldownKey) ?? 0;
    const inCooldown = Date.now() < cooldownUntil;
    const willSkip =
      !this.onlineStateService.isOnline
      || !tableId
      || !restaurantId
      || isLocalOrder
      || this.claimPickupInFlight.has(tableId)
      || inCooldown;

    if (willSkip || !restaurantId) {
      return;
    }

    this.claimPickupInFlight.add(tableId);
    this.ordersService.claimPickupTarget(restaurantId, tableId)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.claimPickupInFlight.delete(tableId);
          this.claimPickupCooldownUntil.set(cooldownKey, Date.now() + ManageOrdersComponent.claimPickupCooldownMs);
        },
        error: (err: unknown) => {
          this.claimPickupInFlight.delete(tableId);
          const status = (err as { status?: number })?.status ?? null;
          if (status === 404) {
            // Expected when UI is stale / no open order on server — not an ngsw failure.
            void this.reconcileStaleTableWithoutServerOrder(tableId);
          } else {
            console.warn('[ManageOrders] claim pickup target failed', err);
          }
        },
      });
  }

  /** Server has no open order (claim 404) but local UI still shows occupied — align with backend. */
  private async reconcileStaleTableWithoutServerOrder(tableId: string): Promise<void> {
    const record = await this.offlineDB.loadCartRecord(tableId);
    const pending = await this.offlineDB.hasPendingQueueActionsForTable(tableId);
    if (record?.orderId?.startsWith('local-') || pending) {
      return;
    }

    await this.offlineDB.deleteCart(tableId);
    await this.offlineDB.markTableFreedLocally(tableId);
    this.tableCarts[tableId] = [];
    delete this.tableComputed[tableId];
    this.ordersService.saveComputed(this.tableComputed);
    this.markTableAsOpen(tableId);
    this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
    void this.offlineDB.saveTables(this.tables);
    void this.offlineDB.saveTablesStatus(this.tablesAvailable);
    if (this.currentTableId === tableId) {
      this.resetCanvasState();
    }
  }

  isSetMenuCartLine(sel: CartItem): boolean {
    const linkedId = this.todaySetMenu?.linkedMenuItemId;
    return !!linkedId && sel.item.menuItemId === linkedId;
  }

  get hasSetMenuInCart(): boolean {
    return this.selectedItems.some(sel => this.isSetMenuCartLine(sel));
  }

  async incrementSetMenuItem(sel: CartItem): Promise<void> {
    if (!this.isSetMenuCartLine(sel)) return;
    await this.addCartItem(sel.item);
  }

  async decrementItem(sel: CartItem) {
    if (this.isPosMutationBlocked()) {
      return;
    }
    const tableId = this.currentTableId;
    if (!(await this.ensureNotPaymentLockedAsync())) {
      return;
    }
    const record = await this.offlineDB.loadCartRecord(tableId);
    const cart = await this.offlineDB.loadCart(tableId);
    const orderId = record?.orderId ?? null;

    const existing = cart.find(i => i.item.menuItemId === sel.item.menuItemId);
    if (!existing) return;

    const willDelete = existing.quantity <= 1;
    const finalQuantity = willDelete ? 0 : existing.quantity - 1;

    if (willDelete) cart.splice(cart.indexOf(existing), 1);
    else existing.quantity--;

    this.tableCarts[tableId] = [...cart];
    await this.offlineDB.saveCart(tableId, cart, orderId ?? undefined, true);

    // Must enqueue DELETE/UPDATE before empty-cart close; otherwise the last removal never hits the API
    // and CLOSE_ORDER runs while the DB still has that line (e.g. only first delete-order-item in Network).
    const canSync =
      !orderId?.startsWith('local-') && this.orderIsConfirmed && !!existing.orderItemId;
    if (canSync) {
      await this.offlineDB.addOfflineAction({
        type: willDelete ? 'DELETE_ITEM' : 'UPDATE_QUANTITY',
        restaurantId: this.restaurantId,
        tableId,
        orderId: orderId ?? undefined,
        payload: { orderItemId: existing.orderItemId, menuItemId: existing.item.menuItemId, quantity: finalQuantity }
      });
      if (this.onlineStateService.isOnline) this.queueProcessor.triggerProcessing();
    }

    if (this.orderIsConfirmed && cart.length === 0) {
      await this.freeTableAfterEmptyConfirmedCart(tableId, orderId ?? undefined);
      return;
    }
  }

  async removeItem(sel: CartItem) {
    if (this.isPosMutationBlocked()) {
      return;
    }
    const tableId = this.currentTableId;
    if (!(await this.ensureNotPaymentLockedAsync())) {
      return;
    }
    const record = await this.offlineDB.loadCartRecord(tableId);
    const cart = await this.offlineDB.loadCart(tableId);
    const orderId = record?.orderId ?? null;

    const existing = cart.find(i => i.item.menuItemId === sel.item.menuItemId);
    if (!existing) return;

    const newCart = cart.filter(i => i.item.menuItemId !== sel.item.menuItemId);
    this.tableCarts[tableId] = [...newCart];
    await this.offlineDB.saveCart(tableId, newCart, orderId ?? undefined, true);

    const canDeleteOnServer =
      !orderId?.startsWith('local-') && this.orderIsConfirmed && !!existing.orderItemId;
    if (canDeleteOnServer) {
      await this.offlineDB.addOfflineAction({
        type: 'DELETE_ITEM',
        restaurantId: this.restaurantId,
        tableId,
        orderId: orderId ?? undefined,
        payload: { orderItemId: existing.orderItemId, menuItemId: existing.item.menuItemId }
      });
      if (this.onlineStateService.isOnline) this.queueProcessor.triggerProcessing();
    }

    if (this.orderIsConfirmed && newCart.length === 0) {
      await this.freeTableAfterEmptyConfirmedCart(tableId, orderId ?? undefined);
      return;
    }
  }

  openSetMenuModal(table: TableDTO, event?: Event): void {
    event?.stopPropagation();
    if (this.isSetMenuActionDisabled()) {
      return;
    }
    if (!this.todaySetMenu?.linkedMenuItemId) return;
    this.setMenuTargetTable = table;
    this.setMenuQty = 1;
    this.setMenuModalVisible = true;
  }

  async confirmSetMenuOrder(): Promise<void> {
    if (this.isSetMenuActionDisabled()) {
      return;
    }
    if (!this.todaySetMenu || !this.setMenuTargetTable) return;
    const table = this.setMenuTargetTable;
    this.setMenuModalVisible = false;
    this.setMenuTargetTable = null;

    if (tableHasActiveOrder(table.order)) {
      await this.seeOrder(table);
    } else {
      await this.openTable(table);
    }

    const item = setMenuToMenuItem(this.todaySetMenu, this.transloco.getActiveLang());
    for (let i = 0; i < this.setMenuQty; i++) {
      await this.addCartItem(item as MenuItem);
    }

    const cart = this.tableCarts[this.currentTableId] ?? [];
    if (!cart.length) {
      return;
    }

    if (!this.orderIsConfirmed) {
      await this.confirmOrder();
    }
  }

  cancelSetMenuModal(): void {
    this.setMenuModalVisible = false;
    this.setMenuTargetTable = null;
  }

  async openTable(table: TableDTO) {
    const tableId = table.tableId;
    this.currentTableId = tableId;
    this.tableName = table.tableName ?? '';
    this.canvasVisible = true;
    localStorage.setItem('currentTableId', tableId);

    const record = await this.offlineDB.loadCartRecord(tableId);
    if (record) {
      this.currentOrderId = record.orderId ?? table.order?.orderId ?? null;
      // local-* ids mean offline-confirmed; server order on table covers cross-device SSE lag.
      this.orderIsConfirmed = !!this.currentOrderId || tableHasActiveOrder(table.order);
      const orderCurrency = this.displayCurrency(
        resolveOrderCurrency(table.order),
        this.tableComputed[tableId]?.currency,
      );
      this.tableCarts[tableId] = applyOrderCurrencyToCart(record.items, orderCurrency);
      if (this.orderIsConfirmed) {
        this.claimPickupTargetForTable(tableId);
      }
      return;
    }

    this.orderIsConfirmed = false;
    this.currentOrderId = null;
    this.tableCarts[tableId] = [];
  }

  async seeOrder(table: TableDTO) {
    this.currentTableId = table.tableId;
    localStorage.setItem('currentTableId', this.currentTableId);
    this.tableName = table.tableName ?? '';
    this.canvasVisible = true;

    const order = await this.ordersService.listOpenOrderForTableWithFallback(
      this.restaurantId, this.currentTableId
    );

    const resolvedOrder =
      order ?? (tableHasActiveOrder(table.order) ? table.order! : null);

    if (resolvedOrder?.orderId) {
      this.currentOrderId = resolvedOrder.orderId;
      this.orderIsConfirmed = true;
      this.claimPickupTargetForTable(this.currentTableId);
      const orderCurrency = this.displayCurrency(resolveOrderCurrency(resolvedOrder));
      const record = await this.offlineDB.loadCartRecord(this.currentTableId);
      if (record?.items?.length) {
        const stamped = applyOrderCurrencyToCart(record.items, orderCurrency);
        this.tableCarts[this.currentTableId] = stamped;
        if (orderCurrency && stamped.some((line, i) => line.item.menuItemPriceCurrency !== record.items[i]?.item.menuItemPriceCurrency)) {
          await this.offlineDB.saveCart(this.currentTableId, stamped, resolvedOrder.orderId);
        }
      } else {
        const hydrated = applyOrderCurrencyToCart(
          (resolvedOrder.orderItems ?? [])
            .filter((o): o is OrderItemDTO => !!o)
            .map(o => cartItemFromOrderLine(o, this.menuItems, orderCurrency)),
          orderCurrency,
        );
        this.tableCarts[this.currentTableId] = hydrated;
        if (hydrated.length) {
          await this.offlineDB.saveCart(this.currentTableId, hydrated, resolvedOrder.orderId);
        }
      }
    } else {
      this.orderIsConfirmed = false;
      this.currentOrderId = null;
      this.tableCarts[this.currentTableId] = [];
    }
  }

  snoozeWaiterCall(tableId: string): void {
    delete this.waiterState[tableId];
    const table = this.tables.find(t => t.tableId === tableId);
    if (table && this.tableComputed[tableId]) {
      this.tableComputed[tableId].cssClass = this.miscService.getTableCss(table, this.waiterState);
    }
    this.tablesService.snoozeWaiterCall(this.restaurantId, tableId)
      .pipe(take(1))
      .subscribe({ error: (err: unknown) => console.error('Error snoozing waiter call', err) });
  }

  snoozeKitchenPickup(tableId: string): void {
    this.kitchenService.snoozePickupCall(this.restaurantId, tableId)
      .pipe(take(1))
      .subscribe({ error: (err: unknown) => console.error('Error snoozing kitchen pickup', err) });
  }

  snoozeBarPickup(tableId: string): void {
    this.barService.snoozePickupCall(this.restaurantId, tableId)
      .pipe(take(1))
      .subscribe({ error: (err: unknown) => console.error('Error snoozing bar pickup', err) });
  }

  // ─── MOVE ORDER ───────────────────────────────────────────────────────────────

  async moveCartToSelectedTable() {
    if (!this.canMoveOrder() || !this.selectedTargetTableId) return;

    const sourceId = this.currentTableId;
    const targetId = this.selectedTargetTableId;

    const record = await this.offlineDB.loadCartRecord(sourceId);
    if (!record) {
      this.appToast.error('No cart found for source table.');
      this.selectedTargetTableId = null;
      return;
    }

    if (this.tablesAvailable[targetId] !== true) {
      this.appToast.error('Target table appears occupied. Refreshing status...');
      await this.syncTablesAvailability();
      this.selectedTargetTableId = null;
      return;
    }

    try {
      const res = await firstValueFrom(
        this.ordersService.moveOrder(this.restaurantId, sourceId, targetId)
      );

      const finalOrderId = res?.orderId ?? record.orderId;

      // Actualizare Dexie
      await this.offlineDB.saveCart(targetId, record.items, finalOrderId);
      await this.offlineDB.deleteCart(sourceId);

      // FIX BUG 1 + BUG 4:
      // Actualizăm this.tables[] imediat cu obiecte NOI (spread) → Angular detectează schimbarea
      // → CSS / culori se schimbă instant, fără să așteptăm SSE.
      // - targetId: isTableOpen=false (ocupat), order simulat (non-null)
      // - sourceId: isTableOpen=true (liber), order=null → buildAvailabilityMap returnează corect true
      this.tables = this.tables.map(t => {
        if (t.tableId === targetId) return { ...t, isTableOpen: false, order: { orderId: finalOrderId } as unknown as OrderDTO };
        if (t.tableId === sourceId) return { ...t, isTableOpen: true, order: undefined };
        return t;
      });
      this.refreshTableLists();

      // FIX BUG 2:
      // Actualizăm tableComputed imediat după move — SSE va suprascrie cu datele reale.
      this.tableCarts[targetId] = record.items;
      this.tableCarts[sourceId] = [];
      this.updateComputedLocal(targetId);  // total, lastAddedItem, lastActionAt pentru masa ocupată
      // Resetăm computed pentru masa eliberată
      const sourceTable = this.tables.find(t => t.tableId === sourceId)!;
      this.tableComputed[sourceId] = {
        lastActionAt: new Date().toISOString(),
        lastAddedItem: '—',
        total: 0,
        currency: '—',
        itemCount: 0,
        cssClass: this.miscService.getTableCss(sourceTable, this.waiterState),
        initiatedBy: this.resolveInitiatedBy(sourceId) || 'system'
      };
      const movedBy =
        this.tableComputed[targetId]?.initiatedBy ||
        this.tableComputed[sourceId]?.initiatedBy ||
        this.resolveInitiatedBy(sourceId);
      if (movedBy) this.rememberInitiatedBy(targetId, movedBy);

      // FIX BUG 3: buildAvailabilityMap citește !t.order — acum sourceId are order=null → correct true
      await this.offlineDB.upsertTableStatus(targetId, false);
      await this.offlineDB.upsertTableStatus(sourceId, true);
      this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);

      // Comutăm contextul UI pe masa țintă
      this.currentTableId = targetId;
      this.tableName = this.tables.find(t => t.tableId === targetId)?.tableName ?? '';
      this.orderIsConfirmed = true;
      this.currentOrderId = finalOrderId ?? null;
      this.tableCarts = this.stampAllCarts(await this.offlineDB.loadAllCarts());

      this.ordersService.saveComputed(this.tableComputed);
      this.appToast.success('Order moved successfully.');

    } catch (err: any) {
      if (err?.status === 409) {
        const parsed = this.miscService.parseApiError?.(err) ?? { details: undefined };
        this.appToast.error(parsed.details ?? 'Target table is occupied. Move aborted.');
        await this.syncTablesAvailability();
      } else {
        this.appToast.error('Failed to move order. Please try again.');
      }
    } finally {
      this.selectedTargetTableId = null;
    }
  }

  /**
   * Re-fetch tables de la server și sincronizează complet starea locală.
   * Singurul loc din cod care face asta — apelat după conflict (pre-flight sau 409).
   */
  private async syncTablesAvailability(): Promise<void> {
    try {
      const tables = await firstValueFrom(this.tablesService.getAll(this.restaurantId));
      this.applyAuthoritativeTables(tables);
    } catch (err) {
      console.warn('[syncTablesAvailability] Failed to refresh:', err);
    }
  }

  // ─── CLOSE ORDER ──────────────────────────────────────────────────────────────

  private static readonly CLOSE_ORDER_ATTEMPT_TIMEOUT_MS = 2_000;
  /** Initial attempt + up to 2 retries on network-class failures. */
  private static readonly CLOSE_ORDER_MAX_ATTEMPTS = 3;

  closeOrder() { this.showCloseConfirm = true; }
  cancelCloseOrder() { this.showCloseConfirm = false; }

  async confirmCloseOrder() {
    if (document.hidden) return;
    if (this.closeInFlight) return;
    if (this.isPosMutationBlocked()) {
      return;
    }
    if (!this.isOnline && !this.offlinePolicy.canUseFullOffline()) {
      return;
    }
    this.closeInFlight = true;
    this.showCloseConfirm = false;

    const tableId = this.currentTableId;
    const orderId = this.currentOrderId;

    // FIX BUG 6: currentOrderId poate fi null — înainte codul folosea ! (non-null assertion)
    // pe un câmp care în practică poate fi null dacă butonul e apăsat fără order activ.
    if (!orderId) {
      this.resetCanvasState();
      this.closeInFlight = false;
      return;
    }

    if (orderId.startsWith('local-') || !this.onlineStateService.isOnline) {
      await this.applyLocalQueuedClose(tableId, orderId);
      this.closeInFlight = false;
      return;
    }

    try {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= ManageOrdersComponent.CLOSE_ORDER_MAX_ATTEMPTS; attempt++) {
        try {
          await firstValueFrom(
            this.ordersService.closeOrder(this.restaurantId, tableId, orderId).pipe(
              timeout(ManageOrdersComponent.CLOSE_ORDER_ATTEMPT_TIMEOUT_MS),
            ),
          );
          await this.applyOnlineCloseSuccess(tableId);
          return;
        } catch (err) {
          lastErr = err;
          if (!this.isNetworkClassCloseError(err)) {
            await this.handleNonNetworkCloseError(tableId, orderId, err);
            return;
          }
        }
      }

      // Network-class failures exhausted → probe server, then offline queue if unreachable.
      const reachable = await this.onlineStateService.confirmConnectivity(true);
      if (!reachable || !this.onlineStateService.isOnline) {
        if (this.onlineStateService.isOnline) {
          this.onlineStateService.setOffline('close-order-unreachable');
        }
        await this.applyLocalQueuedClose(tableId, orderId);
        return;
      }

      console.error('Error closing order after retries; server still reachable', lastErr);
    } finally {
      this.closeInFlight = false;
    }
  }

  private isNetworkClassCloseError(err: unknown): boolean {
    if (err instanceof TimeoutError) {
      return true;
    }
    if (err && typeof err === 'object') {
      const e = err as { status?: number; name?: string; message?: string };
      if (e.name === 'TimeoutError') {
        return true;
      }
      if (typeof e.status === 'number' && e.status === 0) {
        return true;
      }
      if (typeof e.message === 'string' && /timeout/i.test(e.message)) {
        return true;
      }
    }
    return false;
  }

  private async applyOnlineCloseSuccess(tableId: string): Promise<void> {
    await this.offlineDB.deleteCart(tableId);
    delete this.tableComputed[tableId];
    this.ordersService.saveComputed(this.tableComputed);
    this.tableCarts[tableId] = [];
    this.markTableAsOpen(tableId);
    await this.offlineDB.upsertTableStatus(tableId, true);
    this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
    this.resetCanvasState();
  }

  /** Queue CLOSE_ORDER in Dexie and free the table immediately (online or offline). */
  private async applyLocalQueuedClose(tableId: string, orderId: string): Promise<void> {
    await this.offlineDB.addOfflineAction({
      type: 'CLOSE_ORDER',
      restaurantId: this.restaurantId,
      tableId,
      orderId,
      payload: {},
    });
    const closedBy = this.currentStaffDisplayName();
    if (closedBy) {
      this.rememberInitiatedBy(tableId, closedBy);
    }
    await this.offlineDB.deleteCart(tableId);
    this.tableCarts[tableId] = [];
    this.markTableAsOpen(tableId);
    await this.offlineDB.upsertTableStatus(tableId, true);
    this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
    const freedTable = this.tables.find(t => t.tableId === tableId);
    this.tableComputed[tableId] = {
      lastActionAt: new Date().toISOString(),
      lastAddedItem: '—',
      total: 0,
      currency: this.tableComputed[tableId]?.currency ?? '',
      itemCount: 0,
      cssClass: this.miscService.getTableCss(freedTable ?? { tableId, isTableOpen: true } as TableDTO, this.waiterState),
      initiatedBy: closedBy,
    };
    this.ordersService.saveComputed(this.tableComputed);
    void this.offlineDB.saveTables(this.tables);
    void this.offlineDB.saveTablesStatus(this.tablesAvailable);
    this.resetCanvasState();
    await this.refreshLocalSessionTableIds();
    if (this.onlineStateService.isOnline) {
      this.queueProcessor.triggerProcessing();
    }
  }

  private async handleNonNetworkCloseError(
    tableId: string,
    orderId: string,
    err: unknown,
  ): Promise<void> {
    const status = err && typeof err === 'object' && 'status' in err
      ? Number((err as { status?: number }).status)
      : null;
    if (status === 404) {
      // Defensive: unexpected if close is well-formed; treat as already gone.
      await this.offlineDB.deleteCart(tableId);
      delete this.tableComputed[tableId];
      this.ordersService.saveComputed(this.tableComputed);
      this.tableCarts[tableId] = [];
      this.markTableAsOpen(tableId);
      await this.offlineDB.markTableFreedLocally(tableId);
      this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
      this.resetCanvasState();
    }
    console.error('Error closing order:', err);
  }

  private resetCanvasState() {
    this.currentTableId = '';
    this.tableName = '';
    this.orderIsConfirmed = false;
    this.currentOrderId = null;
    this.canvasVisible = false;
  }

  async printKitchen(): Promise<void> {
    const restaurantId = this.restaurantId;
    const orderId = this.currentOrderId;
    const printerId = this.resolveNonFiscalPrinterId();
    if (!restaurantId || !orderId || !printerId) {
      return;
    }
    await this.enqueueBillPrintJob({
      restaurantId,
      orderId,
      forcePrinterId: printerId,
      kitchenItemsOnly: true,
    });
  }

  private async enqueueBillPrintJob(args: {
    restaurantId: string;
    orderId: string;
    forcePrinterId?: string;
    kitchenItemsOnly?: boolean;
  }): Promise<void> {
    try {
      const billLines = args.kitchenItemsOnly
        ? this.selectedItems.filter(isKitchenCartLine)
        : this.selectedItems;
      if (billLines.length === 0) {
        return;
      }

      const billTotal = billLines.reduce(
        (sum, x) => sum + x.item.menuItemPriceAmount * x.quantity,
        0,
      );

      const resolvedOrderId = this.resolveOrderIdForPrint(args.orderId);

      const payload = {
        type: 'bill' as const,
        orderId: resolvedOrderId ?? '',
        restaurantName: this.authService.getUserSnapshot()?.restaurantName ?? '',
        tableName: (this.tableName ?? '').trim() || null,
        currency: billLines[0]?.item.menuItemPriceCurrency ?? this.cartCurrency ?? null,
        subTotal: billTotal,
        finalTotal: billTotal,
        paymentMethod: 'cash',
        closedAtUtc: new Date().toISOString(),
        items: billLines.map(x => ({
          name: x.item.menuItemName,
          quantity: x.quantity,
          unitPrice: x.item.menuItemPriceAmount,
        })),
      };

      if (!this.isOnline && this.offlinePolicy.canUseFullOffline()) {
        if (!this.offlinePrintContext.isReadyForOfflinePrint()) {
          this.appToast.info(
            this.transloco.translate('manageOrders.printOfflineConfigBody'),
            this.transloco.translate('manageOrders.printOfflineConfigTitle'),
          );
          return;
        }
        const printerId = (args.forcePrinterId ?? this.offlinePrintContext.getEffectiveBillPrinterId() ?? '').trim();
        if (!printerId) {
          this.appToast.info(
            this.transloco.translate('manageOrders.printNoPrinterBody'),
            this.transloco.translate('manageOrders.printNoPrinterTitle'),
          );
          return;
        }
        await this.offlinePrintService.printBillSync({
          restaurantId: args.restaurantId,
          printerId,
          payload,
        });
        this.appToast.success(
          this.transloco.translate(
            args.kitchenItemsOnly
              ? 'manageOrders.printKitchenOfflineSuccessBody'
              : 'manageOrders.printOfflineSuccessBody',
          ),
          this.transloco.translate(
            args.kitchenItemsOnly
              ? 'manageOrders.printKitchenOfflineSuccessTitle'
              : 'manageOrders.printOfflineSuccessTitle',
          ),
        );
        return;
      }

      const billCfg = await firstValueFrom(this.printJobs.getDefaultBillPrinterForStaff(args.restaurantId));
      let fiscalCfg = this.fiscalStaffConfig();
      if (!fiscalCfg) {
        fiscalCfg = await firstValueFrom(this.printJobs.getDefaultFiscalPrinterForStaff(args.restaurantId));
      }
      const printerId = (args.forcePrinterId ?? '').trim()
        || this.resolveBillPrinterId({
          fiscalPrintingEnabled: !!fiscalCfg?.fiscalPrintingEnabled,
          defaultFiscalPrinterId: fiscalCfg?.defaultFiscalPrinterId,
          defaultBillPrinterId: billCfg?.defaultBillPrinterId,
        });
      if (!printerId) {
        this.appToast.info(
          this.transloco.translate('manageOrders.printNoPrinterBody'),
          this.transloco.translate('manageOrders.printNoPrinterTitle'),
        );
        return;
      }

      await firstValueFrom(this.printJobs.createBillPrintJob(args.restaurantId, printerId, payload));
      this.appToast.success(
        this.transloco.translate(
          args.kitchenItemsOnly ? 'manageOrders.printKitchenQueuedBody' : 'manageOrders.printQueuedBody',
        ),
        this.transloco.translate(
          args.kitchenItemsOnly ? 'manageOrders.printKitchenQueuedTitle' : 'manageOrders.printQueuedTitle',
        ),
      );
    } catch (err) {
      console.error('Print job failed', err);
      this.appToast.error(
        this.transloco.translate('manageOrders.printErrorBody'),
        this.transloco.translate('manageOrders.printErrorTitle'),
      );
    }
  }

  private resolveOrderIdForPrint(orderId: string): string | null {
    const trimmed = (orderId ?? '').trim();
    if (!trimmed || trimmed.startsWith('local-')) {
      return null;
    }
    return trimmed;
  }

  private resolveBillPrinterId(args: {
    fiscalPrintingEnabled: boolean;
    defaultFiscalPrinterId?: string | null;
    defaultBillPrinterId?: string | null;
  }): string {
    const fiscalId = (args.defaultFiscalPrinterId ?? '').trim();
    if (args.fiscalPrintingEnabled && fiscalId) {
      return fiscalId;
    }
    return (args.defaultBillPrinterId ?? '').trim();
  }

  /** Non-fiscal ESC/POS printer id when distinct from the fiscal printer. */
  private resolveNonFiscalPrinterId(): string | null {
    if (!this.isOnline && this.offlinePolicy.canUseFullOffline()) {
      const escPosId = (this.offlinePrintContext.getDefaultBillPrinterId() ?? '').trim();
      const fiscalId = (this.offlinePrintContext.getDefaultFiscalPrinterId() ?? '').trim();
      if (!escPosId || escPosId === fiscalId) {
        return null;
      }
      return escPosId;
    }

    const escPosId = (this.billStaffConfig()?.defaultBillPrinterId ?? '').trim();
    if (!escPosId) {
      return null;
    }
    const fiscalId = (this.fiscalStaffConfig()?.defaultFiscalPrinterId ?? '').trim();
    if (fiscalId && escPosId === fiscalId) {
      return null;
    }
    return escPosId;
  }

  async printFiscalReceipt(paymentMethod: 'cash' | 'card' = 'cash'): Promise<void> {
    if (!this.canPrintFiscal) {
      this.appToast.info(
        this.transloco.translate('manageOrders.fiscalPrintNoPrinterBody'),
        this.transloco.translate('manageOrders.fiscalPrintNoPrinterTitle'),
      );
      return;
    }

    const restaurantId = this.restaurantId;
    const orderId = this.currentOrderId;
    if (!restaurantId || !orderId) return;

    if (!orderId.startsWith('local-') && this.isOnline) {
      try {
        const docs = await firstValueFrom(
          this.fiscalDocuments.listByOrder(restaurantId, orderId, 'staff'),
        );
        if (!canIssueFiscalReceiptForOrder(docs)) {
          this.appToast.error(
            this.transloco.translate('manageOrders.fiscalReceiptBlockedBody'),
            this.transloco.translate('manageOrders.fiscalReceiptBlockedTitle'),
          );
          return;
        }
      } catch (err) {
        console.warn('Failed to verify fiscal documents before receipt print', err);
      }
    }

    await this.enqueueFiscalReceiptJob({ restaurantId, orderId, paymentMethod });
  }

  async openCashDrawer(): Promise<void> {
    if (!this.canOpenCashDrawer) {
      this.appToast.info(
        this.transloco.translate('manageOrders.fiscalPrintNoPrinterBody'),
        this.transloco.translate('manageOrders.fiscalPrintNoPrinterTitle'),
      );
      return;
    }

    const restaurantId = this.restaurantId;
    if (!restaurantId) return;

    try {
      const offlineFiscal = !this.isOnline && this.offlinePolicy.canUseFullOffline();
      let printerId = '';

      if (offlineFiscal && this.offlinePrintContext.isReadyForOfflineFiscalPrint()) {
        printerId = (this.offlinePrintContext.getDefaultFiscalPrinterId() ?? '').trim();
      } else {
        const cfg = this.fiscalStaffConfig()
          ?? await firstValueFrom(this.printJobs.getDefaultFiscalPrinterForStaff(restaurantId));
        printerId = (cfg?.defaultFiscalPrinterId ?? '').trim();
      }

      if (!printerId) {
        this.appToast.info(
          this.transloco.translate('manageOrders.fiscalPrintNoPrinterBody'),
          this.transloco.translate('manageOrders.fiscalPrintNoPrinterTitle'),
        );
        return;
      }

      const payload = {
        type: 'fiscal-command' as const,
        command: 'open-drawer' as const,
      };

      if (offlineFiscal && this.offlinePrintContext.isReadyForOfflineFiscalPrint()) {
        await this.offlinePrintService.printFiscalCommandSync({
          restaurantId,
          printerId,
          payload,
        });
      } else {
        await firstValueFrom(this.printJobs.createBillPrintJob(restaurantId, printerId, payload));
      }

      this.appToast.success(
        this.transloco.translate('manageOrders.openCashDrawerQueuedBody'),
        this.transloco.translate('manageOrders.openCashDrawerQueuedTitle'),
      );
    } catch (err) {
      console.error('Open cash drawer failed', err);
      this.appToast.error(
        this.transloco.translate('manageOrders.openCashDrawerErrorBody'),
        this.transloco.translate('manageOrders.openCashDrawerErrorTitle'),
      );
    }
  }

  private async loadFiscalStaffConfig(): Promise<void> {
    if (!this.restaurantId || !this.isOnline) {
      return;
    }

    try {
      const [fiscalCfg, billCfg] = await Promise.all([
        firstValueFrom(this.printJobs.getDefaultFiscalPrinterForStaff(this.restaurantId)),
        firstValueFrom(this.printJobs.getDefaultBillPrinterForStaff(this.restaurantId)),
      ]);
      this.fiscalStaffConfig.set(fiscalCfg);
      this.billStaffConfig.set({ defaultBillPrinterId: billCfg?.defaultBillPrinterId ?? null });
    } catch (err) {
      console.warn('Failed to load printer settings for staff', err);
      this.fiscalStaffConfig.set(null);
      this.billStaffConfig.set(null);
    }
  }

  private async enqueueFiscalReceiptJob(args: {
    restaurantId: string;
    orderId: string;
    paymentMethod: 'cash' | 'card';
  }): Promise<void> {
    try {
      const offlineFiscal = !this.isOnline && this.offlinePolicy.canUseFullOffline();
      let fiscalPrintingEnabled = false;
      let printerId = '';
      let vatMapping: Record<string, number> = {};

      if (offlineFiscal && this.offlinePrintContext.isReadyForOfflineFiscalPrint()) {
        fiscalPrintingEnabled = this.offlinePrintContext.isFiscalPrintingEnabledOffline();
        printerId = (this.offlinePrintContext.getDefaultFiscalPrinterId() ?? '').trim();
        vatMapping = this.offlinePrintContext.getFiscalVatGroupMapping();
      } else {
        const fiscalCfg = await firstValueFrom(this.printJobs.getDefaultFiscalPrinterForStaff(args.restaurantId));
        fiscalPrintingEnabled = !!fiscalCfg?.fiscalPrintingEnabled;
        printerId = (fiscalCfg?.defaultFiscalPrinterId ?? '').trim();
        vatMapping = fiscalCfg?.vatGroupMapping ?? {};
      }

      if (!fiscalPrintingEnabled) {
        this.appToast.info(
          this.transloco.translate('manageOrders.fiscalPrintNoPrinterBody'),
          this.transloco.translate('manageOrders.fiscalPrintNoPrinterTitle'),
        );
        return;
      }

      if (!printerId) {
        this.appToast.info(
          this.transloco.translate('manageOrders.fiscalPrintNoPrinterBody'),
          this.transloco.translate('manageOrders.fiscalPrintNoPrinterTitle'),
        );
        return;
      }

      const mappedItems = buildFiscalPrintItems(
        this.selectedItems.map(x => ({
          name: x.item.menuItemName,
          quantity: x.quantity,
          unitPrice: x.item.menuItemPriceAmount,
          menuItemVatPercent:
            x.item.menuItemVatPercent
            ?? this.menuItems.find(m => m.menuItemId === x.item.menuItemId)?.menuItemVatPercent,
        })),
        vatMapping,
      );

      const payload = {
        type: 'fiscal-receipt' as const,
        orderId: args.orderId,
        restaurantName: this.authService.getUserSnapshot()?.restaurantName ?? '',
        tableName: (this.tableName ?? '').trim() || null,
        currency: this.cartCurrency ?? null,
        subTotal: this.cartSubTotal ?? 0,
        finalTotal: this.cartSubTotal ?? 0,
        paymentMethod: args.paymentMethod,
        closedAtUtc: new Date().toISOString(),
        items: mappedItems.map(item => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatPercent: item.menuItemVatPercent,
          vatGroup: item.vatGroup,
        })),
      };

      if (offlineFiscal && this.offlinePrintContext.isReadyForOfflineFiscalPrint()) {
        await this.offlinePrintService.printFiscalReceiptSync({
          restaurantId: args.restaurantId,
          printerId,
          payload,
        });
        this.appToast.success(
          this.transloco.translate('manageOrders.fiscalPrintQueuedBody'),
          this.transloco.translate('manageOrders.fiscalPrintQueuedTitle'),
        );
        return;
      }

      await firstValueFrom(this.printJobs.createBillPrintJob(args.restaurantId, printerId, payload));
      this.appToast.success(
        this.transloco.translate('manageOrders.fiscalPrintQueuedBody'),
        this.transloco.translate('manageOrders.fiscalPrintQueuedTitle'),
      );
    } catch (err) {
      console.error('Fiscal print job failed', err);
      this.appToast.error(
        this.transloco.translate('manageOrders.fiscalPrintErrorBody'),
        this.transloco.translate('manageOrders.fiscalPrintErrorTitle'),
      );
    }
  }

  requestResetCanvas() {
    this.resetConfirmVisible = true;
  }

  cancelResetCanvas() {
    this.resetConfirmVisible = false;
  }

  async confirmResetCanvas() {
    this.resetConfirmVisible = false;
    if (!this.currentTableId) return;

    const tableId = this.currentTableId;
    const orderId = this.currentOrderId;

    await this.offlineDB.deleteCart(tableId);
    this.tableCarts[tableId] = [];

    if (orderId) {
      await this.offlineDB.deleteActionsForOrder(orderId);
    }

    delete this.tableComputed[tableId];
    this.ordersService.saveComputed(this.tableComputed);

    this.resetCanvasState();
  }

  private async freeTableAfterEmptyConfirmedCart(tableId: string, orderId?: string): Promise<void> {
    // UX rule: if a confirmed order ends up with 0 items (user deleted everything),
    // treat it as "free table" immediately (don't leave it red/occupied).
    await this.offlineDB.deleteCart(tableId);
    this.tableCarts[tableId] = [];
    delete this.tableComputed[tableId];
    this.ordersService.saveComputed(this.tableComputed);

    // enqueue close to backend if possible (best-effort)
    if (orderId) {
      await this.offlineDB.addOfflineAction({
        type: 'CLOSE_ORDER',
        restaurantId: this.restaurantId,
        tableId,
        orderId,
        payload: {}
      });
      if (this.onlineStateService.isOnline) this.queueProcessor.triggerProcessing();
    }

    this.markTableAsOpen(tableId);
    await this.offlineDB.upsertTableStatus(tableId, true);
    this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);

    if (this.currentTableId === tableId) {
      this.resetCanvasState();
    }
  }

  // ─── TABLE STATE HELPERS ──────────────────────────────────────────────────────

  /**
   * FIX BUG 4: Folosim map+spread în loc de mutație în-place.
   * Mutația directă pe obiect (table.isTableOpen = x) nu produce o referință nouă
   * → Angular change detection nu detectează schimbarea → UI nu se actualizează.
   */
  markTableAsClosed(tableId: string) {
    this.tables = this.tables.map(t =>
      t.tableId === tableId ? { ...t, isTableOpen: false } : t
    );
    this.refreshTableLists();
  }

  markTableAsOpen(tableId: string) {
    // FIX BUG 3: curățăm și order când deschidem masa, nu doar isTableOpen.
    // buildAvailabilityMap verifică !t.order → dacă order rămâne setat, masa
    // apare ca ocupată chiar dacă isTableOpen=true.
    this.tables = this.tables.map(t =>
      t.tableId === tableId ? { ...t, isTableOpen: true, order: undefined } : t
    );
    this.refreshTableLists();
  }

  refreshTableLists() {
    this.openTables = sortTablesByName(this.tables.filter(t => t.isTableOpen));
    this.closedTables = sortTablesByName(this.tables.filter(t => !t.isTableOpen));
  }

  getTableCss(table: TableDTO, waiterState: Record<string, WaiterCallState>): string {
    return this.miscService.getTableCss(table, waiterState);
  }

  /** Align in-memory guest waiter highlights with /api/sync stream backfill (missed SSE while screen locked). */
  private reconcileGuestWaiterCalls(activeTableIds: string[]): void {
    const activeSet = new Set(activeTableIds);
    for (const tableId of Object.keys(this.waiterState)) {
      if (!activeSet.has(tableId)) {
        delete this.waiterState[tableId];
      }
    }
    for (const tableId of activeTableIds) {
      this.waiterState[tableId] = WaiterCallState.Active;
    }
  }

  getLastActionTime(ts: string | null): string {
    return this.miscService.getLastActionTime(ts);
  }

  // ─── SSE HANDLER ─────────────────────────────────────────────────────────────

  private async handleSseEvent({ EventType, Data, InitiatedBy, Sequence }: SseEvent<any>): Promise<void> {
    if (!EventType) return;
    if (typeof Sequence === 'number' && Sequence > 0) {
      if (this.recentSseSequenceSet.has(Sequence)) {
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

      case 'KitchenWaiterCall': {
        const parsed = this.pickupNotification.parsePickupPayload(Data);
        const tableId = parsed.tableId;
        if (tableId) {
          this.kitchenPickupRequested[tableId] = true;
          this.appToast.info(this.pickupToastMessage('kitchen', tableId, parsed.tableName));
          if (this.kitchenPickupTimers[tableId]) clearTimeout(this.kitchenPickupTimers[tableId]);
          this.kitchenPickupTimers[tableId] = setTimeout(() => {
            delete this.kitchenPickupRequested[tableId];
          }, 2 * 60 * 1000);
        }
        break;
      }

      case 'KitchenWaiterCallSnoozed': {
        const tableId = Data?.TableId;
        if (tableId) {
          delete this.kitchenPickupRequested[tableId];
          if (this.kitchenPickupTimers[tableId]) {
            clearTimeout(this.kitchenPickupTimers[tableId]);
            delete this.kitchenPickupTimers[tableId];
          }
        }
        break;
      }

      case 'BarWaiterCall': {
        const parsed = this.pickupNotification.parsePickupPayload(Data);
        const tableId = parsed.tableId;
        if (tableId) {
          this.barPickupRequested[tableId] = true;
          this.appToast.info(this.pickupToastMessage('bar', tableId, parsed.tableName));
          if (this.barPickupTimers[tableId]) clearTimeout(this.barPickupTimers[tableId]);
          this.barPickupTimers[tableId] = setTimeout(() => {
            delete this.barPickupRequested[tableId];
          }, 2 * 60 * 1000);
        }
        break;
      }

      case 'BarWaiterCallSnoozed': {
        const tableId = Data?.TableId;
        if (tableId) {
          delete this.barPickupRequested[tableId];
          if (this.barPickupTimers[tableId]) {
            clearTimeout(this.barPickupTimers[tableId]);
            delete this.barPickupTimers[tableId];
          }
        }
        break;
      }

      case 'WaiterCall': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId') ?? Data?.TableId ?? Data?.tableId;
        if (tableId) {
          this.waiterState[tableId] = WaiterCallState.Active;
        }
        break;
      }

      case 'WaiterCallSnoozed': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId') ?? Data?.TableId ?? Data?.tableId;
        if (tableId) {
          delete this.waiterState[tableId];
          const table = this.tables.find(t => t.tableId === tableId);
          if (table && this.tableComputed[tableId]) {
            this.tableComputed[tableId].cssClass = this.miscService.getTableCss(table, this.waiterState);
          }
        }
        break;
      }

      case 'OrderItemDeleted':
      case 'OrderItemAdded':
      case 'OrderItemQuantityUpdated':
        // Authoritative cart + lastAddedItem come from OrderUpdated (avoids racing partial deletes).
        break;

      case 'NewOrderPrivateEvent': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId') ?? Data?.TableId ?? Data?.tableId;
        const orderId = this.sseField<string>(Data, 'OrderId', 'orderId') ?? Data?.OrderId ?? Data?.orderId;
        if (!tableId || !orderId) break;

        this.applyRemoteOrderOpenedOnTable(tableId, orderId, 'NewOrderPrivateEvent');

        if (this.currentTableId === tableId) {
          this.currentOrderId = orderId;
          this.orderIsConfirmed = true;
          this.claimPickupTargetForTable(tableId);
        }

        const record = await this.offlineDB.loadCartRecord(tableId);
        if (record) {
          await this.offlineDB.saveCart(tableId, record.items, orderId);
        }
        break;
      }

      case 'NewOrderPublicEvent': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId') ?? Data?.TableId ?? Data?.tableId;
        const orderId = this.sseField<string>(Data, 'OrderId', 'orderId') ?? Data?.OrderId ?? Data?.orderId;
        if (!tableId || !orderId) break;

        this.applyRemoteOrderOpenedOnTable(tableId, orderId, 'NewOrderPublicEvent');
        break;
      }

      case 'OrderUpdated': {
        const payload = Data as OrderUpdatedSSEPayload;
        const tableId = (this.sseField<string>(payload as any, 'TableId', 'tableId') ?? payload.TableId) as string;
        // Nu îmbina starea remote în canvas doar cât timp comanda locală e draft pe *aceeași* masă; altfel blochezi OrderUpdated pentru toate mesele (inclusiv initiatedBy).
        if (this.currentOrderId?.startsWith('local-') && tableId === this.currentTableId) break;

        const sseItemCount =
          payload.ItemCount ??
          (payload.Items ?? []).reduce((sum, i) => sum + (i.Quantity ?? 0), 0);

        // Last item removed on server → empty order snapshot. Free the table; do not re-mark occupied.
        if (sseItemCount <= 0) {
          await this.offlineDB.deleteCart(tableId);
          this.tableCarts[tableId] = [];
          delete this.tableComputed[tableId];
          this.ordersService.saveComputed(this.tableComputed);
          this.markTableAsOpen(tableId);
          await this.offlineDB.upsertTableStatus(tableId, true);
          this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
          break;
        }

        const localRecord = await this.offlineDB.loadCartRecord(tableId);
        const localItems = localRecord?.items ?? [];
        const localQty = localItems.reduce((sum, line) => sum + line.quantity, 0);
        const sseLineCount = (payload.Items ?? []).length;
        const hasPendingForTable = await this.offlineDB.hasPendingQueueActionsForTable(tableId);
        const qtyMismatch = sseItemCount !== localQty;
        const lineCountMismatch = sseLineCount !== localItems.length;
        const initiatedBy = InitiatedBy?.trim().toLowerCase() ?? '';
        const currentStaff = this.currentStaffDisplayName().trim().toLowerCase();
        const isRemoteMutation = !!initiatedBy && !!currentStaff && initiatedBy !== currentStaff;
        const sseMenuQty = new Map<string, number>();
        for (const sseItem of payload.Items ?? []) {
          const rec = sseItem as unknown as Record<string, unknown>;
          const menuItemId = String(rec['MenuItemId'] ?? rec['menuItemId'] ?? '');
          if (!menuItemId) continue;
          const qty = Number(rec['Quantity'] ?? rec['quantity'] ?? 0);
          sseMenuQty.set(menuItemId, (sseMenuQty.get(menuItemId) ?? 0) + qty);
        }
        const localMenuQty = new Map(localItems.map(line => [line.item.menuItemId, line.quantity]));
        const compositionMismatch =
          sseMenuQty.size !== localMenuQty.size
          || [...sseMenuQty.entries()].some(([id, qty]) => localMenuQty.get(id) !== qty);
        // Full hydrate when server is ahead, remote peer mutation, or cart composition differs.
        const shouldFullHydrate =
          localItems.length === 0
          || sseItemCount > localQty
          || isRemoteMutation
          || (!hasPendingForTable && (qtyMismatch || lineCountMismatch || compositionMismatch));

        const orderCurrency = this.displayCurrency(
          (payload.SubTotal as { Currency?: string; currency?: string } | null)?.Currency
          ?? (payload.SubTotal as { currency?: string } | null)?.currency,
        );
        let cart: CartItem[];
        if (shouldFullHydrate) {
          const { menuItems } = await this.offlineDB.loadMenu();
          cart = cartItemsFromSseLines(payload.Items, menuItems, orderCurrency);
        } else {
          cart = applyOrderCurrencyToCart(
            localItems.map(line => ({
              ...line,
              item: { ...line.item },
            })),
            orderCurrency,
          );
          for (const sseItem of payload.Items ?? []) {
            const rec = sseItem as unknown as Record<string, unknown>;
            const menuItemId = String(rec['MenuItemId'] ?? rec['menuItemId'] ?? '');
            const orderItemId = String(rec['OrderItemId'] ?? rec['orderItemId'] ?? '');
            const localItem = cart.find(ci => ci.item.menuItemId === menuItemId);
            if (localItem && orderItemId) {
              localItem.orderItemId = orderItemId;
            }
          }
        }

        await this.offlineDB.saveCart(tableId, cart, payload.OrderId);
        this.tableComputed[tableId] = this.ordersService.mapPayloadToComputed(
          payload, this.tables, this.waiterState, InitiatedBy
        );
        this.tableComputed[tableId].currency = this.displayCurrency(
          this.tableComputed[tableId].currency,
        );
        this.rememberInitiatedBy(tableId, InitiatedBy);
        this.tableCarts[tableId] = cart;
        this.ordersService.saveComputed(this.tableComputed);

        if (payload.OrderId) {
          const initiatedByName = InitiatedBy?.trim()
            || readOrderLastInitiatedBy(this.tables.find(t => t.tableId === tableId)?.order);
          const nextOrder = orderDtoFromSsePayload(tableId, payload, initiatedByName);
          this.tables = this.tables.map(t =>
            t.tableId === tableId
              ? { ...t, isTableOpen: false, order: nextOrder }
              : t,
          );
          this.refreshTableLists();
          this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
          void this.offlineDB.saveTables(this.tables);
          void this.offlineDB.saveTablesStatus(this.tablesAvailable);

          if (this.currentTableId === tableId && this.canvasVisible) {
            this.currentOrderId = payload.OrderId;
            this.orderIsConfirmed = true;
            this.claimPickupTargetForTable(tableId);
          }
          this.reconcileTableOccupancyFlags();
        }
        break;
      }

      case 'OrderPaymentLocked': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId');
        const orderId = this.sseField<string>(Data, 'OrderId', 'orderId');
        if (tableId && orderId) {
          this.paymentLockedByTable[tableId] = {
            orderId,
            expiresAtUtc: this.sseField<string>(Data, 'ExpiresAtUtc', 'expiresAtUtc'),
          };
          this.appToast.info(
            this.transloco.translate('manageOrders.orderLockedForPaymentBody'),
            this.transloco.translate('manageOrders.orderLockedForPaymentTitle'),
          );
        }
        break;
      }

      case 'OrderPaymentUnlocked': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId');
        if (tableId) delete this.paymentLockedByTable[tableId];
        break;
      }

      case 'OrderClosedWithPayment': {
        const tableId = this.sseField<string>(Data, 'TableId', 'tableId');
        if (!tableId) break;
        delete this.paymentLockedByTable[tableId];
        await this.offlineDB.deleteCart(tableId);
        // Persist "updated by" until the next order overwrites it.
        const existing = this.tableComputed[tableId];
        const table = this.tables.find(t => t.tableId === tableId);
        this.tableComputed[tableId] = {
          lastActionAt: this.sseField<string>(Data, 'ClosedAt', 'closedAt') ?? existing?.lastActionAt ?? new Date().toISOString(),
          lastAddedItem: '—',
          total: 0,
          currency: existing?.currency ?? '',
          itemCount: 0,
          cssClass: existing?.cssClass ?? this.miscService.getTableCss(table!, this.waiterState),
          initiatedBy: InitiatedBy || 'stripe',
        };
        this.ordersService.saveComputed(this.tableComputed);

        delete this.kitchenPickupRequested[tableId];
        delete this.barPickupRequested[tableId];
        // FIX BUG 3: markTableAsOpen curăță și order → buildAvailabilityMap returnează corect true
        this.markTableAsOpen(tableId);
        if (this.currentTableId === tableId) {
          this.tableCarts[tableId] = [];
          this.resetCanvasState();
        }
        break;
      }

      case 'TablesStatusesUpdate': {
        if (!this.initialTablesLoaded) {
          break;
        }

        const computedList = Data as TableComputedDTO[];

        // IMPORTANT:
        // Backend may emit TablesStatusesUpdate snapshots where orderId/subTotal are not yet consistent
        // with a just-confirmed order (race / eventual consistency). Don't let that overwrite local truth.
        const updatedTables: TableDTO[] = [];
        for (const t of this.tables) {
          if (!t?.tableId) continue;
          const c = computedList.find(x => x.tableId === t.tableId);
          if (!c) {
            updatedTables.push(t);
            continue;
          }

          const localRecord = await this.offlineDB.loadCartRecord(t.tableId);
          const localHasOrder = !!localRecord?.orderId || (localRecord?.items?.length ?? 0) > 0;
          const snapshotOrderId = c.orderId ?? null;
          const snapshotItemCount = c.itemCount ?? 0;
          const snapshotHasActiveOrder = !!snapshotOrderId || snapshotItemCount > 0;

          // Stale DB snapshots: isTableOpen=false but no order evidence — do not flip UI.
          if (!snapshotHasActiveOrder && !c.isTableOpen && !localHasOrder) {
            updatedTables.push(t);
            continue;
          }

          // Only accept "freed" snapshot if we do NOT have local evidence of an open order.
          const snapshotSaysFreed = !snapshotHasActiveOrder && c.isTableOpen;
          const allowFreeOverride = snapshotSaysFreed && !localHasOrder;

          if (allowFreeOverride) {
            updatedTables.push({ ...t, isTableOpen: true, order: undefined });
            continue;
          }

          const nextIsTableOpen = snapshotHasActiveOrder || localHasOrder ? false : c.isTableOpen;
          const nextOrder = snapshotHasActiveOrder
            ? {
                ...(t.order ?? {}),
                orderId: snapshotOrderId ?? t.order?.orderId ?? '',
                isOrderOpen: true,
              } as OrderDTO
            : t.order;
          updatedTables.push({ ...t, isTableOpen: nextIsTableOpen, order: nextOrder });
        }
        this.tables = updatedTables;
        this.refreshTableLists();

        for (const c of computedList) {
          if (!c?.tableId) continue;
          const table = this.tables.find(t => t.tableId === c.tableId);
          if (!table) continue;

          const localRecord = await this.offlineDB.loadCartRecord(c.tableId);
          const localHasOrder = !!localRecord?.orderId || (localRecord?.items?.length ?? 0) > 0;

          // Avoid overwriting a locally-confirmed cart subtotal with snapshot zeros.
          if (localHasOrder && (c.subTotal?.amount ?? 0) === 0) {
            continue;
          }

          this.tableComputed[c.tableId] = this.ordersService.mapComputedDtoToComputed(
            c,
            this.tables,
            this.waiterState,
            this.resolveInitiatedBy(c.tableId, InitiatedBy) || this.tableComputed[c.tableId]?.initiatedBy?.trim() || '',
          );
          this.tableComputed[c.tableId].currency = this.displayCurrency(
            this.tableComputed[c.tableId].currency,
          );
        }

        if (this.initialTablesLoaded) {
          this.applyPersistedInitiatedByToComputed();
          this.ordersService.saveComputed(this.tableComputed);
        }
        this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
        void this.offlineDB.saveTablesStatus(this.tablesAvailable);
        break;
      }

      case 'MoveOrderAtTableUpdate': {
        const computedList = Data as TableComputedDTO[];

        this.tables = this.tables.map(t => {
          const c = computedList.find(x => x.tableId === t.tableId);
          if (!c) return t;
          const snapshotOrderId = c.orderId ?? null;
          const isFreed = !snapshotOrderId && c.isTableOpen;
          const nextOrder = isFreed
            ? undefined
            : snapshotOrderId
              ? { ...(t.order ?? {}), orderId: snapshotOrderId, isOrderOpen: true } as OrderDTO
              : t.order;
          return {
            ...t,
            isTableOpen: snapshotOrderId ? false : c.isTableOpen,
            order: nextOrder,
          };
        });

        for (const c of computedList) {
          const table = this.tables.find(t => t.tableId === c.tableId);
          if (!table) continue;
          // Use event InitiatedBy to populate "updated by" after move operations.
          const by = this.resolveInitiatedBy(c.tableId, InitiatedBy);
          this.tableComputed[c.tableId] = this.ordersService.mapComputedDtoToComputed(
            c,
            this.tables,
            this.waiterState,
            by
          );
          this.tableComputed[c.tableId].currency = this.displayCurrency(
            this.tableComputed[c.tableId].currency,
          );
          this.rememberInitiatedBy(c.tableId, by);
        }

        await this.offlineDB.saveTables(this.tables);
        this.tablesAvailable = this.tablesService.buildAvailabilityMap(this.tables);
        this.refreshTableLists();
        this.ordersService.saveComputed(this.tableComputed);
        break;
      }

      // Handled centrally in OrderSyncService → OfflineSyncLockService (banner via OfflinePolicy).
      case 'RestaurantSyncLocked':
      case 'RestaurantSyncUnlocked':
        break;

      default:
        console.warn('Unknown SSE event:', EventType);
    }
  }

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.initialTablesLoaded = false;

    this.sseService.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(ev => this.handleSseEvent(ev));

    this.sseService.snapshotRefreshed$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ activeGuestWaiterCalls }) => void this.reloadFromSyncSnapshot(activeGuestWaiterCalls));

    this.onlineStateService.online$
      .pipe(
        takeUntil(this.destroy$),
        pairwise(),
        filter(([wasOnline, isOnline]) => !wasOnline && isOnline),
      )
      .subscribe(() => {
        if (this.restaurantId) {
          void this.loadFiscalStaffConfig();
        }
      });

    this.onlineStateService.online$
      .pipe(
        takeUntil(this.destroy$),
        pairwise(),
        filter(([wasOnline, isOnline]) => wasOnline && !isOnline),
      )
      .subscribe(() => {
        const user = this.authService.getUserSnapshot();
        void this.refreshLocalSessionTableIds();
      });

    this.offlineDB.cartsChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => void this.refreshLocalSessionTableIds());

    this.authService.getUserContext()
      .pipe(
        takeUntil(this.destroy$),
        filter((user): user is UserContextModel => !!user?.restaurantId),
        take(1)
      )
      .subscribe(user => {
        this.restaurantId = user.restaurantId!;
        void this.offlinePrintContext.init(this.restaurantId);
        void this.loadFiscalStaffConfig();

        this.loadTodayBookings();

        forkJoin({
          tables: from(this.tablesService.getAllWithFallback(this.restaurantId)),
          menu: from(this.menuItemService.getAllWithFallback(this.restaurantId))
        }).subscribe(async ({ tables, menu }) => {
          await this.restaurantCurrency.init(this.restaurantId);
          await this.ordersService.ensureInitiatedByCacheReady();
          this.capturePersistedInitiatedBy();

          this.applyAuthoritativeTables(tables);

          this.menuItems = menu.menuItems ?? [];
          this.todaySetMenu = menu.todaySetMenu ?? null;
          this.categories = menu.categories ?? [];
          await this.refreshLocalSessionTableIds();
          this.capturePersistedInitiatedBy({ replaceTableComputed: false });

          this.applyInitiatedByFromSyncedOrders();
          this.hydrateComputedFromTables();
          this.applyPersistedInitiatedByToComputed();
          this.initialTablesLoaded = true;
          this.ordersService.saveComputed(this.tableComputed);

          // Sync if SSE onopen has not refreshed recently (snapshotRefreshed$ reloads UI).
          // Force so Currency from /api/sync is always applied (not skipped by throttle).
          await this.sseService.refreshRestaurantSnapshot({ force: true });
          // Re-apply totals/cart currencies now that restaurant operating currency is cached.
          this.hydrateComputedFromTables();
          this.applyPersistedInitiatedByToComputed();
          this.ordersService.saveComputed(this.tableComputed);

          const purgedTables = await this.offlineDB.purgeCartsNotInTableIds(
            this.tables.map(t => t.tableId),
          );

          Object.keys(this.tableComputed).forEach(tableId => {
            const table = this.tables.find(t => t.tableId === tableId);
            if (table) {
              this.tableComputed[tableId].cssClass = this.miscService.getTableCss(table, this.waiterState);
            }
          });

          this.tableCarts = this.stampAllCarts(await this.offlineDB.loadAllCarts());

          const savedTableId = localStorage.getItem('currentTableId');
          if (savedTableId) {
            const table = this.tables.find(t => t.tableId === savedTableId);
            if (table) this.openTable(table);
          }
        });

        this.queueProcessor.orderConfirmed$
          .pipe(takeUntil(this.destroy$))
          .subscribe(async ({ tableId, orderId }) => {
            const cart = await this.offlineDB.loadCart(tableId);
            this.tableCarts[tableId] = [...cart];
            if (this.currentTableId === tableId) {
              this.currentOrderId = orderId;
              this.orderIsConfirmed = true;
            }
            this.markTableAsClosed(tableId);
            this.updateComputedLocal(tableId);
          });

        this.search$
          .pipe(debounceTime(250), takeUntil(this.destroy$))
          .subscribe(term => {
            if (!term.trim()) { this.filteredResults = []; return; }
            this.filteredResults = this.fuse.search(term).map(r => r.item);
          });
      });
  }

  ngOnDestroy(): void {
    this.ordersService.saveInitiatedByMap(this.persistedInitiatedBy);
    this.ordersService.saveComputed(this.tableComputed);
    this.destroy$.next();
    this.destroy$.complete();
    Object.values(this.kitchenPickupTimers).forEach(t => clearTimeout(t));
    Object.values(this.barPickupTimers).forEach(t => clearTimeout(t));
  }
}