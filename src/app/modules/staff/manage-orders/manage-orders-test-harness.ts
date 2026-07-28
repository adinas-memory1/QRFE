import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageOrdersComponent } from './manage-orders.component';
import { AuthService } from '../../../core/auth/auth.service';
import { OrderSyncService } from '../../../core/services/order-service/order-sync.service';
import { OfflineDbService } from '../../../core/offline/offline-db';
import { OfflineQueueProcessor } from '../../../core/offline/offline-queue-processor.service';
import { OfflineSyncSchedulerService } from '../../../core/offline/offline-sync-scheduler.service';
import { OnlineStateService } from '../../../core/offline/online-state-service';
import { OfflinePolicyService } from '../../../core/offline/offline-policy.service';
import { OfflinePrimaryService } from '../../../core/services/offline-primary/offline-primary.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { TablesService } from '../../../core/services/tables-service/tables.service';
import { MenuItemServiceService } from '../../../core/services/menu-item-service/menu-item-service.service';
import { OrdersService } from '../../../core/services/order-service/orders.service';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';
import { KitchenService } from '../../../core/services/kitchen-service/kitchen.service';
import { BarService } from '../../../core/services/bar-service/bar.service';
import { PrintJobsService } from '../../../core/services/print-jobs/print-jobs.service';
import { DeviceFeedbackService } from '../../../core/services/device/device-feedback.service';
import { ReservationService } from '../../../core/services/reservation-service/reservation.service';
import { FiscalDocumentsService } from '../../../core/services/fiscal-documents/fiscal-documents.service';
import { COMMON_TEST_PROVIDERS } from '../../../testing/common-test-providers';
import { TableDTO } from '../../../core/models/restaurantTablesModel';
import { CartItem, TableComputedDTO } from '../../../core/models/orderingModel';
import { MenuItem } from '../../../core/models/menu/menuItem';
import { SseEvent } from '../../../core/models/sseModel';
import { WaiterCallState } from '../../../core/models/callWaiter/callWaiter';
import { of, Subject, Observable } from 'rxjs';

export const TEST_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';
export const TABLE_A = '11111111-1111-1111-1111-111111111101';
export const TABLE_B = '11111111-1111-1111-1111-111111111102';
export const TABLE_C = '11111111-1111-1111-1111-111111111103';

export function createTable(overrides: Partial<TableDTO> = {}): TableDTO {
  return {
    restaurantId: TEST_RESTAURANT_ID,
    tableId: TABLE_A,
    tableName: 'Table A',
    isTableOpen: true,
    isWaiterCalled: false,
    ...overrides,
  };
}

export function createDefaultTables(): TableDTO[] {
  return [
    createTable({ tableId: TABLE_A, tableName: 'Table A', isTableOpen: true }),
    createTable({ tableId: TABLE_B, tableName: 'Table B', isTableOpen: true }),
    createTable({ tableId: TABLE_C, tableName: 'Table C', isTableOpen: false }),
  ];
}

export function createMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    menuItemId: 'menu-item-1',
    menuItemName: 'Pizza Margherita',
    menuItemPriceAmount: 25,
    menuItemPriceCurrency: 'RON',
    category: 'Main',
    isAvailable: true,
    ...overrides,
  };
}

export function createCartItem(
  overrides: Partial<CartItem> = {},
  itemOverrides?: Partial<MenuItem>,
): CartItem {
  return {
    item: createMenuItem(itemOverrides),
    quantity: 1,
    ...overrides,
  };
}

export function createTableComputed(
  overrides: Partial<TableComputedDTO> = {},
): TableComputedDTO {
  return {
    tableId: TABLE_A,
    isTableOpen: true,
    lastActionAt: new Date().toISOString(),
    lastAddedItem: 'Pizza',
    subTotal: { amount: 25, currency: 'RON' as never },
    itemCount: 1,
    ...overrides,
  };
}

export function buildAvailabilityMap(tables: TableDTO[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const t of tables) {
    if (t?.tableId) {
      map[t.tableId] = !!t.isTableOpen && !t.order;
    }
  }
  return map;
}

export interface OfflineDbMock {
  cartStore: Record<string, { items: CartItem[]; orderId?: string }>;
  cartsChanged$: Observable<{ tableId: string }>;
  loadCartRecord: jasmine.Spy;
  loadCart: jasmine.Spy;
  saveCart: jasmine.Spy;
  deleteCart: jasmine.Spy;
  loadAllCarts: jasmine.Spy;
  getTableIdsWithLocalSession: jasmine.Spy;
  loadTablesStatusMap: jasmine.Spy;
  loadLocalTables: jasmine.Spy;
  loadMenu: jasmine.Spy;
  upsertTableStatus: jasmine.Spy;
  saveTables: jasmine.Spy;
  saveTablesStatus: jasmine.Spy;
  addOfflineAction: jasmine.Spy;
  deleteActionsForOrder: jasmine.Spy;
  purgeCartsNotInTableIds: jasmine.Spy;
  purgeOfflineDataExceptRestaurant: jasmine.Spy;
  hasPendingQueueActionsForTable: jasmine.Spy;
}

export function createOfflineDbMock(): OfflineDbMock {
  const cartStore: Record<string, { items: CartItem[]; orderId?: string }> = {};
  const cartsChangedSubject = new Subject<{ tableId: string }>();

  return {
    cartStore,
    cartsChanged$: cartsChangedSubject.asObservable(),
    loadCartRecord: jasmine.createSpy('loadCartRecord').and.callFake(async (tableId: string) => {
      const rec = cartStore[tableId];
      return rec ? { tableId, items: [...rec.items], orderId: rec.orderId } : null;
    }),
    loadCart: jasmine.createSpy('loadCart').and.callFake(async (tableId: string) => {
      return cartStore[tableId]?.items ? [...cartStore[tableId].items] : [];
    }),
    saveCart: jasmine.createSpy('saveCart').and.callFake(
      async (tableId: string, items: CartItem[], orderId?: string) => {
        cartStore[tableId] = { items: [...items], orderId };
      },
    ),
    deleteCart: jasmine.createSpy('deleteCart').and.callFake(async (tableId: string) => {
      delete cartStore[tableId];
    }),
    loadAllCarts: jasmine.createSpy('loadAllCarts').and.callFake(async () => {
      const result: Record<string, CartItem[]> = {};
      for (const [tableId, rec] of Object.entries(cartStore)) {
        result[tableId] = [...rec.items];
      }
      return result;
    }),
    getTableIdsWithLocalSession: jasmine.createSpy('getTableIdsWithLocalSession').and.callFake(async () =>
      Object.entries(cartStore)
        .filter(([, rec]) => !!rec.orderId || rec.items.length > 0)
        .map(([tableId]) => tableId),
    ),
    loadTablesStatusMap: jasmine.createSpy('loadTablesStatusMap').and.resolveTo({}),
    loadLocalTables: jasmine.createSpy('loadLocalTables').and.resolveTo([]),
    loadMenu: jasmine.createSpy('loadMenu').and.resolveTo({ menuItems: [createMenuItem()], categories: ['Main'] }),
    upsertTableStatus: jasmine.createSpy('upsertTableStatus').and.resolveTo(undefined),
    saveTables: jasmine.createSpy('saveTables').and.resolveTo(undefined),
    saveTablesStatus: jasmine.createSpy('saveTablesStatus').and.resolveTo(undefined),
    addOfflineAction: jasmine.createSpy('addOfflineAction').and.resolveTo(undefined),
    deleteActionsForOrder: jasmine.createSpy('deleteActionsForOrder').and.resolveTo(undefined),
    purgeCartsNotInTableIds: jasmine.createSpy('purgeCartsNotInTableIds').and.resolveTo(0),
    purgeOfflineDataExceptRestaurant: jasmine.createSpy('purgeOfflineDataExceptRestaurant').and.resolveTo({
      removedCarts: 0,
      removedActions: 0,
    }),
    hasPendingQueueActionsForTable: jasmine.createSpy('hasPendingQueueActionsForTable').and.resolveTo(false),
  };
}

export interface ManageOrdersMocks {
  auth: { getUserContext: jasmine.Spy; getUserSnapshot: jasmine.Spy };
  tablesService: {
    getAllWithFallback: jasmine.Spy;
    getAll: jasmine.Spy;
    buildAvailabilityMap: jasmine.Spy;
    snoozeWaiterCall: jasmine.Spy;
  };
  menuItemService: { getAllWithFallback: jasmine.Spy };
  ordersService: {
    loadComputed: jasmine.Spy;
    saveComputed: jasmine.Spy;
    loadInitiatedByMap: jasmine.Spy;
    saveInitiatedByMap: jasmine.Spy;
    ensureInitiatedByCacheReady: jasmine.Spy;
    mapComputedDtoToComputed: jasmine.Spy;
    mapPayloadToComputed: jasmine.Spy;
    moveOrder: jasmine.Spy;
    getOrderPaymentLock: jasmine.Spy;
    closeOrder: jasmine.Spy;
    calculateOrderTax: jasmine.Spy;
    listOpenOrderForTableWithFallback: jasmine.Spy;
  };
  sseService: {
    events$: Subject<SseEvent<unknown>>;
    snapshotRefreshed$: Subject<{ restaurantId: string; activeGuestWaiterCalls: string[] }>;
    isReconciling$: Observable<boolean>;
    listenToRestaurantEvents: jasmine.Spy;
    refreshRestaurantSnapshot: jasmine.Spy;
  };
  offlineDb: OfflineDbMock;
  queueProcessor: {
    orderConfirmed$: Subject<{ tableId: string; orderId: string }>;
    isProcessing$: Observable<boolean>;
    triggerProcessing: jasmine.Spy;
  };
  syncScheduler: {
    syncCountdownSeconds$: Observable<number | null>;
    syncBlocked$: Observable<boolean>;
    batchSyncDraining$: Observable<boolean>;
  };
  onlineState: OnlineStateMock;
  appToast: {
    success: jasmine.Spy;
    error: jasmine.Spy;
    info: jasmine.Spy;
  };
  miscService: {
    getTableCss: jasmine.Spy;
    getLastActionTime: jasmine.Spy;
    parseApiError: jasmine.Spy;
  };
  kitchenService: { snoozePickupCall: jasmine.Spy };
  barService: { snoozePickupCall: jasmine.Spy };
  printJobs: {
    listAgentPrinters: jasmine.Spy;
    getDefaultBillPrinter: jasmine.Spy;
    getDefaultBillPrinterForStaff: jasmine.Spy;
    getDefaultFiscalPrinterForStaff: jasmine.Spy;
    createBillPrintJob: jasmine.Spy;
  };
  deviceFeedback: {
    notifyPickupFromPush: jasmine.Spy;
  };
  reservationService: {
    list: jasmine.Spy;
  };
  fiscalDocuments: {
    listByOrder: jasmine.Spy;
  };
}

interface OnlineStateMock {
  isOnline: boolean;
  online$: Observable<boolean>;
  setOffline: jasmine.Spy;
  setOnline: jasmine.Spy;
  confirmConnectivity: jasmine.Spy;
}

export interface SetupManageOrdersOptions {
  skipNgOnInit?: boolean;
  tables?: TableDTO[];
  menuItems?: MenuItem[];
  categories?: string[];
  tablesStatusMap?: Record<string, boolean>;
  computed?: Record<string, unknown>;
  initiatedByMap?: Record<string, string>;
  isOnline?: boolean;
  isOfflinePrimaryDevice?: boolean;
  isOfflinePrimaryStaffDesignee?: boolean;
  reservations?: Array<{
    reservationId: string;
    tableId: string;
    tableLabel: string;
    customerName: string;
    phone: string;
    partySize: number;
    start: string;
    end: string;
    status: string;
  }>;
}

export interface ManageOrdersTestContext {
  fixture: ComponentFixture<ManageOrdersComponent>;
  component: ManageOrdersComponent;
  mocks: ManageOrdersMocks;
}

export function createManageOrdersMocks(options: SetupManageOrdersOptions = {}): ManageOrdersMocks {
  const tables = options.tables ?? createDefaultTables();
  const menuItems = options.menuItems ?? [createMenuItem(), createMenuItem({ menuItemId: 'menu-item-2', menuItemName: 'Salad', category: 'Starters', menuItemPriceAmount: 15 })];
  const categories = options.categories ?? ['Main', 'Starters'];
  const offlineDb = createOfflineDbMock();
  offlineDb.loadTablesStatusMap.and.resolveTo(options.tablesStatusMap ?? buildAvailabilityMap(tables));
  offlineDb.loadLocalTables.and.resolveTo(tables);

  const orderConfirmed$ = new Subject<{ tableId: string; orderId: string }>();
  const sseEvents$ = new Subject<SseEvent<unknown>>();
  const snapshotRefreshed$ = new Subject<{ restaurantId: string; activeGuestWaiterCalls: string[] }>();

  return {
    auth: {
      getUserContext: jasmine.createSpy('getUserContext').and.returnValue(
        of({ id: '1', role: 'staff', restaurantId: TEST_RESTAURANT_ID }),
      ),
      getUserSnapshot: jasmine.createSpy('getUserSnapshot').and.returnValue({
        id: '1',
        role: 'staff',
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Ana',
        surname: 'Popescu',
      }),
    },
    tablesService: {
      getAllWithFallback: jasmine.createSpy('getAllWithFallback').and.resolveTo(tables),
      getAll: jasmine.createSpy('getAll').and.returnValue(of(tables)),
      buildAvailabilityMap: jasmine.createSpy('buildAvailabilityMap').and.callFake(buildAvailabilityMap),
      snoozeWaiterCall: jasmine.createSpy('snoozeWaiterCall').and.returnValue(of(undefined)),
    },
    menuItemService: {
      getAllWithFallback: jasmine.createSpy('getAllWithFallback').and.resolveTo({
        menuItems,
        categories,
        todaySetMenu: null,
      }),
    },
    ordersService: {
      loadComputed: jasmine.createSpy('loadComputed').and.returnValue(options.computed ?? {}),
      saveComputed: jasmine.createSpy('saveComputed'),
      loadInitiatedByMap: jasmine.createSpy('loadInitiatedByMap').and.returnValue(options.initiatedByMap ?? {}),
      saveInitiatedByMap: jasmine.createSpy('saveInitiatedByMap'),
      ensureInitiatedByCacheReady: jasmine.createSpy('ensureInitiatedByCacheReady').and.returnValue(Promise.resolve()),
      mapComputedDtoToComputed: jasmine.createSpy('mapComputedDtoToComputed').and.callFake(
        (dto: TableComputedDTO, _tables: TableDTO[], _waiterState: Record<string, WaiterCallState>, initiatedBy?: string) => ({
          lastActionAt: dto.lastActionAt ?? '',
          lastAddedItem: dto.lastAddedItem ?? '—',
          total: dto.subTotal?.amount ?? 0,
          currency: dto.subTotal?.currency ?? '',
          itemCount: dto.itemCount ?? 0,
          cssClass: 'table-css',
          initiatedBy: initiatedBy ?? '',
        }),
      ),
      mapPayloadToComputed: jasmine.createSpy('mapPayloadToComputed').and.callFake(
        (payload: { LastActionAt?: string; LastAddedItem?: string; ItemCount?: number }, _tables: TableDTO[], _waiterState: Record<string, WaiterCallState>, initiatedBy?: string) => ({
          lastActionAt: payload.LastActionAt ?? '',
          lastAddedItem: payload.LastAddedItem ?? '—',
          total: 0,
          currency: 'RON',
          itemCount: payload.ItemCount ?? 0,
          cssClass: 'table-css',
          initiatedBy: initiatedBy ?? 'system',
        }),
      ),
      moveOrder: jasmine.createSpy('moveOrder').and.returnValue(of({ orderId: 'real-order-id' })),
      getOrderPaymentLock: jasmine.createSpy('getOrderPaymentLock').and.returnValue(of({ locked: false })),
      closeOrder: jasmine.createSpy('closeOrder').and.returnValue(of({})),
      calculateOrderTax: jasmine.createSpy('calculateOrderTax').and.returnValue(of({
        subTotal: 0,
        taxAmount: 0,
        total: 0,
        currency: 'USD',
        stripeCalculationId: 'test',
        taxLines: [],
      })),
      listOpenOrderForTableWithFallback: jasmine.createSpy('listOpenOrderForTableWithFallback').and.resolveTo(null),
    },
    sseService: {
      events$: sseEvents$,
      snapshotRefreshed$,
      isReconciling$: of(false),
      listenToRestaurantEvents: jasmine.createSpy('listenToRestaurantEvents').and.returnValue(of({})),
      refreshRestaurantSnapshot: jasmine.createSpy('refreshRestaurantSnapshot').and.returnValue(Promise.resolve(true)),
    },
    offlineDb,
    queueProcessor: {
      orderConfirmed$,
      isProcessing$: of(false),
      triggerProcessing: jasmine.createSpy('triggerProcessing'),
    },
    syncScheduler: {
      syncCountdownSeconds$: of(null),
      syncBlocked$: of(false),
      batchSyncDraining$: of(false),
    },
    onlineState: (() => {
      const state = {
        isOnline: options.isOnline ?? true,
        online$: of(options.isOnline ?? true),
        setOffline: jasmine.createSpy('setOffline'),
        setOnline: jasmine.createSpy('setOnline'),
        confirmConnectivity: jasmine.createSpy('confirmConnectivity'),
      };
      state.setOffline.and.callFake(() => {
        state.isOnline = false;
      });
      state.setOnline.and.callFake(() => {
        state.isOnline = true;
      });
      state.confirmConnectivity.and.callFake(async () => state.isOnline);
      return state;
    })(),
    appToast: {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
      info: jasmine.createSpy('info'),
    },
    miscService: {
      getTableCss: jasmine.createSpy('getTableCss').and.returnValue('table-css'),
      getLastActionTime: jasmine.createSpy('getLastActionTime').and.returnValue('1m ago'),
      parseApiError: jasmine.createSpy('parseApiError').and.returnValue({ details: 'conflict' }),
    },
    kitchenService: {
      snoozePickupCall: jasmine.createSpy('snoozePickupCall').and.returnValue(of(undefined)),
    },
    barService: {
      snoozePickupCall: jasmine.createSpy('snoozePickupCall').and.returnValue(of(undefined)),
    },
    printJobs: {
      listAgentPrinters: jasmine.createSpy('listAgentPrinters').and.returnValue(of([])),
      getDefaultBillPrinter: jasmine.createSpy('getDefaultBillPrinter').and.returnValue(of({ defaultBillPrinterId: '' })),
      getDefaultBillPrinterForStaff: jasmine.createSpy('getDefaultBillPrinterForStaff').and.returnValue(of({ defaultBillPrinterId: '' })),
      getDefaultFiscalPrinterForStaff: jasmine.createSpy('getDefaultFiscalPrinterForStaff').and.returnValue(
        of({
          fiscalPrintingEnabled: false,
          defaultFiscalPrinterId: null,
          vatGroupMapping: {},
        }),
      ),
      createBillPrintJob: jasmine.createSpy('createBillPrintJob').and.returnValue(of({})),
    },
    deviceFeedback: {
      notifyPickupFromPush: jasmine.createSpy('notifyPickupFromPush'),
    },
    reservationService: {
      list: jasmine.createSpy('list').and.returnValue(of(options.reservations ?? [])),
    },
    fiscalDocuments: {
      listByOrder: jasmine.createSpy('listByOrder').and.returnValue(of([])),
    },
  };
}

export async function setupManageOrdersComponent(
  options: SetupManageOrdersOptions = {},
): Promise<ManageOrdersTestContext> {
  const mocks = createManageOrdersMocks(options);

  await TestBed.configureTestingModule({
    imports: [ManageOrdersComponent],
    providers: [
      ...COMMON_TEST_PROVIDERS,
      { provide: AuthService, useValue: mocks.auth },
      { provide: TablesService, useValue: mocks.tablesService },
      { provide: MenuItemServiceService, useValue: mocks.menuItemService },
      { provide: OrdersService, useValue: mocks.ordersService },
      { provide: OrderSyncService, useValue: mocks.sseService },
      { provide: OfflineDbService, useValue: mocks.offlineDb },
      { provide: OfflineQueueProcessor, useValue: mocks.queueProcessor },
      { provide: OfflineSyncSchedulerService, useValue: mocks.syncScheduler },
      { provide: OnlineStateService, useValue: mocks.onlineState },
      { provide: AppToastService, useValue: mocks.appToast },
      { provide: MiscellaneousService, useValue: mocks.miscService },
      { provide: KitchenService, useValue: mocks.kitchenService },
      { provide: BarService, useValue: mocks.barService },
      { provide: PrintJobsService, useValue: mocks.printJobs },
      { provide: DeviceFeedbackService, useValue: mocks.deviceFeedback },
      { provide: ReservationService, useValue: mocks.reservationService },
      { provide: FiscalDocumentsService, useValue: mocks.fiscalDocuments },
      {
        provide: OfflinePolicyService,
        useValue: {
          canUseFullOffline: () =>
            (options.isOnline ?? true) === false && (options.isOfflinePrimaryDevice ?? false),
          shouldShowBindDeviceCta: () => false,
          shouldShowOfflinePrimaryDeviceBanner: () =>
            (options.isOfflinePrimaryDevice ?? false) && (options.isOfflinePrimaryStaffDesignee ?? false),
          isOfflinePrimaryDevice: () => options.isOfflinePrimaryDevice ?? false,
          isOfflinePrimaryStaffDesignee: () => options.isOfflinePrimaryStaffDesignee ?? false,
          shouldFreezeForRestaurantSync: () => false,
          shouldFreezePosActions: () => false,
        },
      },
      {
        provide: OfflinePrimaryService,
        useValue: {
          bindDevice: jasmine.createSpy('bindDevice').and.returnValue(of({ isOfflinePrimaryDevice: true })),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ManageOrdersComponent);
  const component = fixture.componentInstance;

  if (!options.skipNgOnInit) {
    fixture.detectChanges();
  }

  return { fixture, component, mocks };
}

export async function invokeSse(
  component: ManageOrdersComponent,
  eventType: string,
  data: unknown,
  initiatedBy?: string,
  sequence?: number,
): Promise<void> {
  await (component as unknown as { handleSseEvent: (ev: SseEvent<unknown>) => Promise<void> }).handleSseEvent({
    EventType: eventType,
    RestaurantId: TEST_RESTAURANT_ID,
    Data: data,
    InitiatedBy: initiatedBy ?? '',
    Sequence: sequence ?? 0,
  });
}

export function setRestaurantId(component: ManageOrdersComponent): void {
  (component as unknown as { restaurantId: string }).restaurantId = TEST_RESTAURANT_ID;
}

export function seedComponentTables(
  component: ManageOrdersComponent,
  tables: TableDTO[] = createDefaultTables(),
  tablesAvailable?: Record<string, boolean>,
): void {
  component.tables = tables;
  component.refreshTableLists();
  component.tablesAvailable = tablesAvailable ?? buildAvailabilityMap(tables);
}
