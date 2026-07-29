import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { WaiterCallState } from '../../../core/models/callWaiter/callWaiter';
import { MenuItemCategory } from '../../../core/models/menu/menuItem';
import { Currency } from '../../../core/models/restaurantTablesModel';
import { RestaurantCurrencyService } from '../../../core/offline/restaurant-currency.service';
import { ManageOrdersComponent } from './manage-orders.component';
import { createDefaultFiscalPrinterSettings } from '../../../core/services/print-jobs/print-jobs.service';
import {
  TABLE_A,
  TABLE_B,
  TABLE_C,
  TEST_RESTAURANT_ID,
  createCartItem,
  createDefaultTables,
  createMenuItem,
  createTable,
  invokeSse,
  seedComponentTables,
  setRestaurantId,
  setupManageOrdersComponent,
} from './manage-orders-test-harness';

describe('ManageOrdersComponent', () => {
  describe('initialization', () => {
    it('should create', async () => {
      const { component } = await setupManageOrdersComponent();
      expect(component).toBeTruthy();
    });

    it('loads tables and menu on init', async () => {
      const { component, mocks } = await setupManageOrdersComponent();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mocks.tablesService.getAllWithFallback).toHaveBeenCalledWith(TEST_RESTAURANT_ID);
      expect(mocks.menuItemService.getAllWithFallback).toHaveBeenCalledWith(TEST_RESTAURANT_ID);
      expect(mocks.reservationService.list).toHaveBeenCalled();
      expect(component.tables.length).toBe(3);
      expect(component.menuItems.length).toBeGreaterThan(0);
      expect(mocks.offlineDb.saveTables).toHaveBeenCalled();
      expect(mocks.offlineDb.saveTablesStatus).toHaveBeenCalled();
    });

    it('groups today bookings by table on init', async () => {
      const { component } = await setupManageOrdersComponent({
        reservations: [
          {
            reservationId: 'res-1',
            tableId: TABLE_A,
            tableLabel: 'Table A',
            customerName: 'Alice',
            phone: '+40123456789',
            partySize: 2,
            start: new Date().toISOString(),
            end: new Date(Date.now() + 3600000).toISOString(),
            status: 'Active',
          },
          {
            reservationId: 'res-2',
            tableId: TABLE_A,
            tableLabel: 'Table A',
            customerName: 'Bob',
            phone: '+40987654321',
            partySize: 4,
            start: new Date(Date.now() + 7200000).toISOString(),
            end: new Date(Date.now() + 10800000).toISOString(),
            status: 'Active',
          },
        ],
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(component.bookingsForTable(TABLE_A).length).toBe(2);
      expect(component.bookingsForTable(TABLE_B)).toEqual([]);
    });

    it('restores currentTableId from localStorage on init', async () => {
      spyOn(localStorage, 'getItem').and.returnValue(TABLE_B);
      const { component } = await setupManageOrdersComponent();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(component.currentTableId).toBe(TABLE_B);
      expect(component.canvasVisible).toBeTrue();
    });
  });

  describe('table state helpers', () => {
    let component: ManageOrdersComponent;

    beforeEach(async () => {
      ({ component } = await setupManageOrdersComponent({ skipNgOnInit: true }));
      seedComponentTables(component);
    });

    it('markTableAsClosed moves table to closedTables', () => {
      component.markTableAsClosed(TABLE_A);

      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeFalse();
      expect(component.closedTables.some(t => t.tableId === TABLE_A)).toBeTrue();
      expect(component.openTables.some(t => t.tableId === TABLE_A)).toBeFalse();
    });

    it('markTableAsOpen clears order and moves table to openTables', () => {
      component.tables = component.tables.map(t =>
        t.tableId === TABLE_C ? { ...t, isTableOpen: false, order: { orderId: 'ord-1' } as never } : t,
      );
      component.refreshTableLists();

      component.markTableAsOpen(TABLE_C);

      const table = component.tables.find(t => t.tableId === TABLE_C);
      expect(table?.isTableOpen).toBeTrue();
      expect(table?.order).toBeUndefined();
      expect(component.openTables.some(t => t.tableId === TABLE_C)).toBeTrue();
    });

    it('canMoveOrder returns true only when order is confirmed and targets exist', () => {
      component.currentTableId = TABLE_A;
      component.orderIsConfirmed = true;
      component.currentOrderId = 'real-order-1';
      component.tablesAvailable = { [TABLE_A]: false, [TABLE_B]: true, [TABLE_C]: false };

      expect(component.canMoveOrder()).toBeTrue();

      component.currentOrderId = 'local-draft';
      expect(component.canMoveOrder()).toBeFalse();

      component.currentOrderId = 'real-order-1';
      component.tablesAvailable[TABLE_B] = false;
      expect(component.canMoveOrder()).toBeFalse();
    });

    it('availableTablesForMove excludes current table and occupied tables', () => {
      component.currentTableId = TABLE_A;
      component.tablesAvailable = {
        [TABLE_A]: false,
        [TABLE_B]: true,
        [TABLE_C]: false,
      };

      const ids = component.availableTablesForMove.map(t => t.tableId);
      expect(ids).toEqual([TABLE_B]);
    });

    it('trackByTableId returns tableId', () => {
      const table = createTable({ tableId: TABLE_A });
      expect(component.trackByTableId(0, table)).toBe(TABLE_A);
    });
  });

  describe('cart and computed getters', () => {
    let component: ManageOrdersComponent;

    beforeEach(async () => {
      ({ component } = await setupManageOrdersComponent({ skipNgOnInit: true }));
      component.currentTableId = TABLE_A;
      component.menuItems = [createMenuItem(), createMenuItem({ menuItemId: 'menu-2', category: 'Starters', menuItemName: 'Soup' })];
      component.categories = ['Main', 'Starters'];
      component.tableCarts[TABLE_A] = [
        createCartItem({ quantity: 2 }),
        createCartItem({ quantity: 1 }, { menuItemId: 'menu-2', menuItemPriceAmount: 10, category: 'Starters' }),
      ];
    });

    it('cartSubTotal and cartCurrency aggregate current table cart', () => {
      expect(component.cartSubTotal).toBe(60);
      expect(component.cartCurrency).toBe('RON');
    });

    it('cartCurrency prefers restaurant operating currency over stale EUR on cart lines', async () => {
      await TestBed.inject(RestaurantCurrencyService).setFromSync(TEST_RESTAURANT_ID, 'RON');
      component.tableComputed[TABLE_A] = {
        lastActionAt: '',
        lastAddedItem: 'Soup',
        total: 60,
        currency: 'EUR',
        itemCount: 3,
        cssClass: '',
        initiatedBy: '',
      };
      component.tableCarts[TABLE_A] = [
        createCartItem({ quantity: 1 }, { menuItemPriceCurrency: 'EUR' }),
      ];
      expect(component.cartCurrency).toBe('RON');
      expect(component.operatingCurrency).toBe('RON');
    });

    it('hydrateComputedFromTables uses restaurant currency over stale order EUR', async () => {
      await TestBed.inject(RestaurantCurrencyService).setFromSync(TEST_RESTAURANT_ID, 'RON');
      seedComponentTables(component, [
        createTable({
          tableId: TABLE_A,
          isTableOpen: false,
          order: {
            orderId: 'order-1',
            createdOn: '2026-01-01T12:00:00.000Z',
            isOrderOpen: true,
            currency: Currency.EUR,
            subTotal: { amount: 25, currency: Currency.EUR },
            orderItems: [{
              menuItemId: 'm1',
              orderItemName: 'Soup',
              orderItemPriceAmount: 25,
              orderItemPriceCurrency: Currency.EUR,
              orderItemDescription: '',
              category: 'Main',
              quantity: 1,
            }],
          },
        }),
      ]);

      (component as unknown as { hydrateComputedFromTables: () => void }).hydrateComputedFromTables();

      expect(component.tableComputed[TABLE_A]?.total).toBe(25);
      expect(component.tableComputed[TABLE_A]?.currency).toBe('RON');
    });

    it('filteredMenuItems filters by searchTerm', () => {
      component.searchTerm = 'pizza';
      expect(component.filteredMenuItems.length).toBe(1);
      expect(component.filteredMenuItems[0].menuItemName).toContain('Pizza');
    });

    it('nonEmptyCategories includes categories with menu items or cart lines', () => {
      expect(component.nonEmptyCategories).toContain('Main');
      expect(component.nonEmptyCategories).toContain('Starters');
    });

    it('displayMenuItemNameInCanvas truncates long unavailable item names', () => {
      const longName = 'Very Long Unavailable Item Name Here';
      const item = createMenuItem({ menuItemName: longName, isAvailable: false });
      const displayed = component.displayMenuItemNameInCanvas(item);
      expect(displayed.length).toBeLessThanOrEqual(18);
      expect(displayed.endsWith('…')).toBeTrue();
    });

    it('formatInitiatedBy maps stripe to translated label', () => {
      const transloco = TestBed.inject(TranslocoService);
      spyOn(transloco, 'translate').and.returnValue('Card payment');
      expect(component.formatInitiatedBy('stripe')).toBe('Card payment');
      expect(component.formatInitiatedBy('waiter')).toBe('waiter');
    });
  });

  describe('cart actions and offline queue', () => {
    let component: ManageOrdersComponent;
    let mocks: Awaited<ReturnType<typeof setupManageOrdersComponent>>['mocks'];

    beforeEach(async () => {
      ({ component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true }));
      setRestaurantId(component);
      seedComponentTables(component);
      component.currentTableId = TABLE_A;
      component.menuItems = [createMenuItem()];
    });

    it('addCartItem shows toast when item is unavailable', async () => {
      const item = createMenuItem({ isAvailable: false });
      await component.addCartItem(item);

      expect(mocks.appToast.info).toHaveBeenCalled();
      expect(mocks.offlineDb.saveCart).not.toHaveBeenCalled();
    });

    it('addCartItem blocks when payment is locked for current order', async () => {
      component.orderIsConfirmed = true;
      component.currentOrderId = 'order-locked';
      component.paymentLockedByTable[TABLE_A] = { orderId: 'order-locked' };

      await component.addCartItem(createMenuItem());

      expect(mocks.offlineDb.saveCart).not.toHaveBeenCalled();
    });

    it('addCartItem saves cart offline and updates tableCarts', async () => {
      const item = createMenuItem();
      await component.addCartItem(item);

      expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
      expect(component.tableCarts[TABLE_A]?.length).toBe(1);
      expect(component.tableCarts[TABLE_A]?.[0].quantity).toBe(1);
    });

    it('addCartItem stamps restaurant currency onto menu lines that still say EUR', async () => {
      await TestBed.inject(RestaurantCurrencyService).setFromSync(TEST_RESTAURANT_ID, 'RON');
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);
      const item = createMenuItem({ menuItemPriceCurrency: 'EUR' });

      await component.addCartItem(item);

      const savedCart = mocks.offlineDb.saveCart.calls.mostRecent().args[1] as Array<{ item: { menuItemPriceCurrency?: string } }>;
      expect(savedCart[0].item.menuItemPriceCurrency).toBe('RON');
      expect(component.tableCarts[TABLE_A][0].item.menuItemPriceCurrency).toBe('RON');
    });

    it('addCartItem enqueues offline action when order is confirmed', async () => {
      component.orderIsConfirmed = true;
      mocks.offlineDb.loadCartRecord.and.resolveTo({
        tableId: TABLE_A,
        items: [],
        orderId: 'real-order-1',
      });

      await component.addCartItem(createMenuItem());

      expect(mocks.offlineDb.addOfflineAction).toHaveBeenCalled();
      expect(mocks.queueProcessor.triggerProcessing).toHaveBeenCalled();
    });

    it('confirmOrder enqueues offline actions and marks table closed', async () => {
      mocks.offlineDb.loadCart.and.resolveTo([createCartItem()]);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });

      await component.confirmOrder();

      expect(component.orderIsConfirmed).toBeTrue();
      expect(component.currentOrderId).toMatch(/^local-/);
      expect(mocks.offlineDb.addOfflineAction).toHaveBeenCalledTimes(2);
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeFalse();
      expect(mocks.queueProcessor.triggerProcessing).toHaveBeenCalled();
    });

    it('removeItem updates cart and persists offline', async () => {
      const cartItem = createCartItem();
      mocks.offlineDb.loadCartRecord.and.resolveTo({ tableId: TABLE_A, items: [cartItem], orderId: null });
      mocks.offlineDb.loadCart.and.resolveTo([cartItem]);
      component.tableCarts[TABLE_A] = [cartItem];

      await component.removeItem(cartItem);

      expect(component.tableCarts[TABLE_A]).toEqual([]);
      expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
    });

    it('decrementItem reduces quantity and persists offline', async () => {
      const cartItem = createCartItem({ quantity: 2 });
      mocks.offlineDb.loadCartRecord.and.resolveTo({ tableId: TABLE_A, items: [cartItem], orderId: null });
      mocks.offlineDb.loadCart.and.resolveTo([cartItem]);
      component.tableCarts[TABLE_A] = [cartItem];

      await component.decrementItem(cartItem);

      expect(component.tableCarts[TABLE_A][0].quantity).toBe(1);
      expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
    });

    it('confirmResetCanvas clears cart and resets canvas state', async () => {
      component.tableCarts[TABLE_A] = [createCartItem()];
      component.currentOrderId = 'order-1';
      component.canvasVisible = true;

      await component.confirmResetCanvas();

      expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(TABLE_A);
      expect(mocks.offlineDb.deleteActionsForOrder).toHaveBeenCalledWith('order-1');
      expect(component.canvasVisible).toBeFalse();
      expect(component.currentTableId).toBe('');
    });
  });

  describe('orderConfirmed$ subscription', () => {
    it('updates order state and closes table after queue confirmation', async () => {
      const { component, mocks } = await setupManageOrdersComponent();
      await new Promise(resolve => setTimeout(resolve, 0));

      component.currentTableId = TABLE_A;
      mocks.offlineDb.loadCart.and.resolveTo([createCartItem()]);
      mocks.queueProcessor.orderConfirmed$.next({ tableId: TABLE_A, orderId: 'server-order-1' });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(component.currentOrderId).toBe('server-order-1');
      expect(component.orderIsConfirmed).toBeTrue();
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeFalse();
    });
  });

  describe('move order', () => {
    let component: ManageOrdersComponent;
    let mocks: Awaited<ReturnType<typeof setupManageOrdersComponent>>['mocks'];

    beforeEach(async () => {
      ({ component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true }));
      setRestaurantId(component);
      seedComponentTables(component);
      component.currentTableId = TABLE_A;
      component.orderIsConfirmed = true;
      component.currentOrderId = 'real-order-1';
      component.tablesAvailable = { [TABLE_A]: false, [TABLE_B]: true, [TABLE_C]: false };
    });

    it('moveCartToSelectedTable returns early when canMoveOrder is false', async () => {
      component.orderIsConfirmed = false;
      component.selectedTargetTableId = TABLE_B;

      await component.moveCartToSelectedTable();

      expect(mocks.ordersService.moveOrder).not.toHaveBeenCalled();
    });

    it('moveCartToSelectedTable shows error when source cart is missing', async () => {
      component.selectedTargetTableId = TABLE_B;
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);

      await component.moveCartToSelectedTable();

      expect(mocks.appToast.error).toHaveBeenCalledWith('No cart found for source table.');
      expect(component.selectedTargetTableId).toBeNull();
    });

    it('moveCartToSelectedTable shows error and syncs when target is occupied', async () => {
      component.selectedTargetTableId = TABLE_B;
      component.tablesAvailable = { [TABLE_A]: false, [TABLE_B]: true, [TABLE_C]: true };
      mocks.offlineDb.loadCartRecord.and.resolveTo({
        tableId: TABLE_A,
        items: [createCartItem()],
        orderId: 'real-order-1',
      });
      component.tablesAvailable[TABLE_B] = false;

      await component.moveCartToSelectedTable();

      expect(mocks.appToast.error).toHaveBeenCalledWith('Target table appears occupied. Refreshing status...');
      expect(mocks.tablesService.getAll).toHaveBeenCalled();
    });

    it('moveCartToSelectedTable moves cart and updates tables on success', async () => {
      component.selectedTargetTableId = TABLE_B;
      const cartItems = [createCartItem()];
      mocks.offlineDb.loadCartRecord.and.resolveTo({
        tableId: TABLE_A,
        items: cartItems,
        orderId: 'real-order-1',
      });
      mocks.offlineDb.loadAllCarts.and.resolveTo({ [TABLE_B]: cartItems });

      await component.moveCartToSelectedTable();

      expect(mocks.ordersService.moveOrder).toHaveBeenCalledWith(TEST_RESTAURANT_ID, TABLE_A, TABLE_B);
      expect(mocks.offlineDb.saveCart).toHaveBeenCalledWith(TABLE_B, cartItems, 'real-order-id');
      expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(TABLE_A);
      expect(component.currentTableId).toBe(TABLE_B);
      expect(component.tables.find(t => t.tableId === TABLE_B)?.isTableOpen).toBeFalse();
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
      expect(mocks.appToast.success).toHaveBeenCalledWith('Order moved successfully.');
    });
  });

  describe('SSE handleSseEvent', () => {
    let component: ManageOrdersComponent;
    let mocks: Awaited<ReturnType<typeof setupManageOrdersComponent>>['mocks'];

    beforeEach(async () => {
      ({ component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true }));
      seedComponentTables(component);
    });

    it('WaiterCall sets waiter id from PascalCase TableId', async () => {
      await invokeSse(component, 'WaiterCall', { TableId: TABLE_A });
      expect(component.waiterState[TABLE_A]).toBe(WaiterCallState.Active);
    });

    it('WaiterCall sets id from camelCase tableId', async () => {
      await invokeSse(component, 'WaiterCall', { tableId: TABLE_B });
      expect(component.waiterState[TABLE_B]).toBe(WaiterCallState.Active);
    });

    it('WaiterCallSnoozed clears active waiter highlight', async () => {
      component.waiterState[TABLE_A] = WaiterCallState.Active;
      await invokeSse(component, 'WaiterCallSnoozed', { TableId: TABLE_A });
      expect(component.waiterState[TABLE_A]).toBeUndefined();
    });

    it('KitchenWaiterCall sets kitchen pickup flag and shows toast', async () => {
      await invokeSse(component, 'KitchenWaiterCall', {
        TableId: TABLE_A,
        TableName: 'T1',
        ClientInstanceId: 'device-1',
      });
      expect(component.kitchenPickupRequested[TABLE_A]).toBeTrue();
      expect(mocks.appToast.info).toHaveBeenCalled();
      expect(mocks.deviceFeedback.notifyPickupFromPush).not.toHaveBeenCalled();
    });

    it('BarWaiterCall sets bar pickup flag and shows toast', async () => {
      await invokeSse(component, 'BarWaiterCall', {
        TableId: TABLE_B,
        TableName: 'T2',
        ClientInstanceId: 'device-2',
      });
      expect(component.barPickupRequested[TABLE_B]).toBeTrue();
      expect(mocks.deviceFeedback.notifyPickupFromPush).not.toHaveBeenCalled();
    });

    it('NewOrderPrivateEvent replaces local order id with server id', async () => {
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'local-draft';
      mocks.offlineDb.loadCartRecord.and.resolveTo({
        tableId: TABLE_A,
        items: [createCartItem()],
        orderId: 'local-draft',
      });

      await invokeSse(component, 'NewOrderPrivateEvent', { TableId: TABLE_A, OrderId: 'server-order-99' });

      expect(component.currentOrderId).toBe('server-order-99');
      expect(component.orderIsConfirmed).toBeTrue();
      expect(mocks.offlineDb.saveCart).toHaveBeenCalledWith(TABLE_A, jasmine.any(Array), 'server-order-99');
    });

    it('OrderUpdated skips merge when local draft is on current table', async () => {
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'local-draft';
      mocks.offlineDb.loadCart.and.resolveTo([createCartItem()]);

      await invokeSse(component, 'OrderUpdated', {
        TableId: TABLE_A,
        OrderId: 'server-order',
        Items: [],
        LastActionAt: new Date().toISOString(),
      });

      expect(mocks.offlineDb.saveCart).not.toHaveBeenCalled();
    });

    it('OrderUpdated updates cart and computed for other tables', async () => {
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'real-order-1';
      mocks.offlineDb.loadCart.and.resolveTo([createCartItem()]);

      await invokeSse(component, 'OrderUpdated', {
        TableId: TABLE_B,
        OrderId: 'order-b',
        Items: [{ MenuItemId: 'menu-item-1', OrderItemId: 'line-1', Quantity: 1, OrderItemPriceAmount: 25, OrderItemPriceCurrency: 'RON' }],
        LastActionAt: new Date().toISOString(),
        ItemCount: 1,
      }, 'waiter');

      expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
      expect(component.tableComputed[TABLE_B]?.initiatedBy).toBe('waiter');
    });

    it('OrderUpdated fully hydrates cart when no local session exists (cross-browser SSE)', async () => {
      seedComponentTables(component);
      (component as unknown as { initialTablesLoaded: boolean }).initialTablesLoaded = true;
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);

      await invokeSse(component, 'OrderUpdated', {
        TableId: TABLE_B,
        OrderId: 'order-cross',
        Items: [{
          MenuItemId: 'menu-item-1',
          OrderItemId: 'line-cross',
          OrderItemName: 'Pizza',
          Quantity: 1,
          OrderItemPriceAmount: 25,
          OrderItemPriceCurrency: 'RON',
        }],
        LastActionAt: new Date().toISOString(),
        ItemCount: 1,
        SubTotal: { Amount: 25, Currency: 'RON' },
      }, 'manager');

      expect(mocks.offlineDb.saveCart).toHaveBeenCalledWith(
        TABLE_B,
        jasmine.arrayContaining([jasmine.objectContaining({ quantity: 1, orderItemId: 'line-cross' })]),
        'order-cross',
      );
      expect(mocks.offlineDb.saveTables).toHaveBeenCalled();
      const table = component.tables.find(t => t.tableId === TABLE_B);
      expect(table?.isTableOpen).toBeFalse();
      expect(table?.order?.orderId).toBe('order-cross');
      expect(table?.order?.orderItems?.length).toBe(1);
      expect(component.tableCarts[TABLE_B]?.length).toBe(1);
    });

    it('OrderUpdated on current open canvas marks order as confirmed', async () => {
      component.currentTableId = TABLE_A;
      component.canvasVisible = true;
      component.orderIsConfirmed = false;
      component.currentOrderId = null;
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);

      await invokeSse(component, 'OrderUpdated', {
        TableId: TABLE_A,
        OrderId: 'order-confirmed',
        Items: [{
          MenuItemId: 'menu-item-1',
          OrderItemId: 'line-1',
          Quantity: 1,
          OrderItemPriceAmount: 25,
          OrderItemPriceCurrency: 'RON',
        }],
        ItemCount: 1,
      });

      expect(component.orderIsConfirmed).toBeTrue();
      expect((component as ManageOrdersComponent).currentOrderId).toEqual('order-confirmed');
    });

    it('OrderUpdated with zero items frees the table instead of marking it occupied', async () => {
      component.tables = createDefaultTables().map(t =>
        t.tableId === TABLE_A ? { ...t, isTableOpen: false, order: { orderId: 'order-a', isOrderOpen: true } as never } : t,
      );
      component.refreshTableLists();
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'real-order-1';

      await invokeSse(component, 'OrderUpdated', {
        TableId: TABLE_A,
        OrderId: 'order-a',
        Items: [],
        ItemCount: 0,
        LastActionAt: new Date().toISOString(),
      });

      expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(TABLE_A);
      expect(mocks.offlineDb.saveCart).not.toHaveBeenCalled();
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
      expect(component.tableComputed[TABLE_A]).toBeUndefined();
    });

    it('removeItem on last confirmed line frees the table', async () => {
      const cartItem = createCartItem({ orderItemId: 'line-1' });
      component.currentTableId = TABLE_A;
      component.orderIsConfirmed = true;
      component.currentOrderId = 'real-order-1';
      component.tables = createDefaultTables().map(t =>
        t.tableId === TABLE_A ? { ...t, isTableOpen: false } : t,
      );
      component.refreshTableLists();
      component.tableCarts[TABLE_A] = [cartItem];
      mocks.offlineDb.loadCartRecord.and.resolveTo({
        tableId: TABLE_A,
        items: [cartItem],
        orderId: 'real-order-1',
      });
      mocks.offlineDb.loadCart.and.resolveTo([cartItem]);

      await component.removeItem(cartItem);

      expect(component.tableCarts[TABLE_A]).toEqual([]);
      expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(TABLE_A);
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
    });

    it('OrderPaymentLocked and OrderPaymentUnlocked manage paymentLockedByTable', async () => {
      await invokeSse(component, 'OrderPaymentLocked', { TableId: TABLE_A, OrderId: 'pay-order-1' });
      expect(component.paymentLockedByTable[TABLE_A]?.orderId).toBe('pay-order-1');
      expect(mocks.appToast.info).toHaveBeenCalled();

      await invokeSse(component, 'OrderPaymentUnlocked', { TableId: TABLE_A, OrderId: 'pay-order-1' });
      expect(component.paymentLockedByTable[TABLE_A]).toBeUndefined();
    });

    it('OrderClosedWithPayment frees table and resets canvas when current', async () => {
      component.currentTableId = TABLE_A;
      component.canvasVisible = true;
      component.tableCarts[TABLE_A] = [createCartItem()];

      await invokeSse(component, 'OrderClosedWithPayment', {
        TableId: TABLE_A,
        ClosedAt: new Date().toISOString(),
      }, 'stripe');

      expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(TABLE_A);
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
      expect(component.canvasVisible).toBeFalse();
      expect(component.tableComputed[TABLE_A]?.initiatedBy).toBe('stripe');
    });

    it('TablesStatusesUpdate keeps table occupied when local cart exists', async () => {
      component.tables = createDefaultTables();
      component.refreshTableLists();
      (component as unknown as { initialTablesLoaded: boolean }).initialTablesLoaded = true;
      mocks.offlineDb.loadCartRecord.and.callFake(async (tableId: string) => {
        if (tableId === TABLE_A) {
          return { tableId, items: [createCartItem()], orderId: 'local-1' };
        }
        return null;
      });

      await invokeSse(component, 'TablesStatusesUpdate', [
        { tableId: TABLE_A, isTableOpen: true, orderId: undefined, subTotal: { amount: 0, currency: 'RON' } },
      ]);

      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeFalse();
      expect(mocks.ordersService.mapComputedDtoToComputed).not.toHaveBeenCalled();
    });

    it('TablesStatusesUpdate ignores stale snapshot without order evidence', async () => {
      const tables = createDefaultTables().map(t =>
        t.tableId === TABLE_A ? { ...t, isTableOpen: true, order: undefined } : t,
      );
      component.tables = tables;
      component.refreshTableLists();
      (component as unknown as { initialTablesLoaded: boolean }).initialTablesLoaded = true;
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);

      await invokeSse(component, 'TablesStatusesUpdate', [
        { tableId: TABLE_A, isTableOpen: false, orderId: undefined, subTotal: { amount: 0, currency: 'RON' }, itemCount: 0 },
      ]);

      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
      expect(component.tables.find(t => t.tableId === TABLE_A)?.order).toBeUndefined();
    });

    it('TablesStatusesUpdate before initial load preserves persisted initiatedBy and skips save', async () => {
      mocks.ordersService.loadInitiatedByMap.and.returnValue({ [TABLE_B]: 'waiter' });
      mocks.ordersService.loadComputed.and.returnValue({});
      (component as unknown as { capturePersistedInitiatedBy: (o?: { replaceTableComputed?: boolean }) => void })
        .capturePersistedInitiatedBy();
      (component as unknown as { initialTablesLoaded: boolean }).initialTablesLoaded = false;
      mocks.ordersService.saveComputed.calls.reset();

      await invokeSse(component, 'TablesStatusesUpdate', [
        {
          tableId: TABLE_B,
          isTableOpen: false,
          orderId: 'order-b',
          subTotal: { amount: 50, currency: 'RON' },
          itemCount: 2,
          lastActionAt: new Date().toISOString(),
        },
      ]);

      expect(mocks.ordersService.saveComputed).not.toHaveBeenCalled();
      expect(mocks.ordersService.mapComputedDtoToComputed).not.toHaveBeenCalled();
      expect((component as unknown as { persistedInitiatedBy: Record<string, string> }).persistedInitiatedBy[TABLE_B]).toBe('waiter');
    });

    it('applyPersistedInitiatedByToComputed restores name after hydrate cleared it', async () => {
      mocks.ordersService.loadInitiatedByMap.and.returnValue({ [TABLE_C]: 'Maria Pop' });
      seedComponentTables(component);
      component.tableComputed[TABLE_C] = {
        lastActionAt: '',
        lastAddedItem: 'Pizza',
        total: 40,
        currency: 'RON',
        itemCount: 1,
        cssClass: 'table-css',
        initiatedBy: '',
      };
      (component as unknown as { capturePersistedInitiatedBy: () => void }).capturePersistedInitiatedBy();
      (component as unknown as { applyPersistedInitiatedByToComputed: () => void }).applyPersistedInitiatedByToComputed();
      expect(component.tableComputed[TABLE_C]?.initiatedBy).toBe('Maria Pop');
    });

    it('resolveInitiatedBy prefers order.lastInitiatedBy over stale tableComputed', () => {
      component.tables = [{
        ...createDefaultTables()[0],
        tableId: TABLE_A,
        isTableOpen: false,
        order: {
          orderId: 'order-a',
          isOrderOpen: true,
          lastInitiatedBy: 'Manager Name',
          createdOn: new Date().toISOString(),
          currency: 'RON' as import('../../../core/models/restaurantTablesModel').Currency,
        },
      }];
      component.tableComputed[TABLE_A] = {
        lastActionAt: '',
        lastAddedItem: 'Pizza',
        total: 40,
        currency: 'RON',
        itemCount: 1,
        cssClass: 'table-css',
        initiatedBy: 'Old Staff',
      };
      (component as unknown as { persistedInitiatedBy: Record<string, string> }).persistedInitiatedBy[TABLE_A] = 'Old Staff';

      const resolved = (component as unknown as { resolveInitiatedBy: (id: string) => string }).resolveInitiatedBy(TABLE_A);
      expect(resolved).toBe('Manager Name');
    });
  });

  describe('offline primary UI gates', () => {
    it('canBypassOfflineUiGates is false when offline and not primary device', async () => {
      const { component } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: false,
      });
      expect(component.canBypassOfflineUiGates).toBeFalse();
    });

    it('canBypassOfflineUiGates is true when offline on primary device', async () => {
      const { component } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: true,
      });
      expect(component.canBypassOfflineUiGates).toBeTrue();
    });

    it('isTableActionDisabled blocks All tab offline for semi-offline even with local session', async () => {
      const { component } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: false,
        skipNgOnInit: true,
      });
      (component as unknown as { localSessionTableIds: Set<string> }).localSessionTableIds = new Set([TABLE_A]);
      const table = createTable({ tableId: TABLE_A, isTableOpen: false });

      expect(component.isTableActionDisabled(table, true)).toBeTrue();
    });

    it('isTableActionDisabled blocks All tab offline without local session (partial offline)', async () => {
      const { component } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: false,
        skipNgOnInit: true,
      });
      const table = createTable({ tableId: TABLE_B, isTableOpen: false });

      expect(component.isTableActionDisabled(table, true)).toBeTrue();
    });

    it('seeOrder hydrates from table.order when offline without local Dexie cart', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: true,
        skipNgOnInit: true,
      });
      const orderId = 'server-order-semi';
      component.menuItems = [createMenuItem()];
      component.tables = [
        createTable({
          tableId: TABLE_A,
          isTableOpen: false,
          order: {
            orderId,
            isOrderOpen: true,
            createdOn: new Date().toISOString(),
            currency: Currency.RON,
            orderItems: [{
              orderItemId: 'oi-1',
              menuItemId: createMenuItem().menuItemId,
              orderItemName: 'Pizza',
              orderItemDescription: '',
              orderItemPriceAmount: 10,
              orderItemPriceCurrency: Currency.RON,
              category: 'Main',
              quantity: 1,
            }],
          },
        }),
      ];
      mocks.ordersService.listOpenOrderForTableWithFallback.and.resolveTo(null);
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);
      mocks.offlineDb.saveCart.and.resolveTo(undefined);

      await component.seeOrder(component.tables[0]);

      expect(component.orderIsConfirmed).toBeTrue();
      expect(component.currentOrderId).toBe(orderId);
      expect(component.tableCarts[TABLE_A]?.length).toBe(1);
      expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
    });

    it('openTable treats local-* orderId as confirmed on full offline re-entry', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: true,
        skipNgOnInit: true,
      });
      mocks.offlineDb.loadCartRecord.and.resolveTo({
        tableId: TABLE_A,
        orderId: 'local-offline-confirmed',
        items: [createCartItem()],
      });

      await component.openTable(createTable({ tableId: TABLE_A }));

      expect(component.orderIsConfirmed).toBeTrue();
      expect(component.currentOrderId).toBe('local-offline-confirmed');
    });

    it('confirmCloseOrder offline frees table locally and records closer name', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: true,
        skipNgOnInit: true,
      });
      seedComponentTables(component, createDefaultTables());
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'local-order-1';
      component.orderIsConfirmed = true;
      component.tableCarts[TABLE_A] = [createCartItem()];
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });

      await component.confirmCloseOrder();

      expect(mocks.offlineDb.addOfflineAction).toHaveBeenCalled();
      expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(TABLE_A);
      expect(mocks.offlineDb.upsertTableStatus).toHaveBeenCalledWith(TABLE_A, true);
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
      expect(component.tableComputed[TABLE_A]?.initiatedBy).toBe('Popescu A.');
      expect(component.tableComputed[TABLE_A]?.itemCount).toBe(0);
      expect(component.canvasVisible).toBeFalse();
    });

    it('confirmCloseOrder network failures then failed ping queues close and marks offline', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: true,
        isOfflinePrimaryDevice: true,
        skipNgOnInit: true,
      });
      seedComponentTables(component, createDefaultTables());
      component.currentTableId = TABLE_A;
      component.currentOrderId = '019f-server-order';
      component.orderIsConfirmed = true;
      component.tableCarts[TABLE_A] = [createCartItem()];
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });

      mocks.ordersService.closeOrder.and.returnValue(throwError(() => ({ status: 0 })));
      mocks.onlineState.confirmConnectivity.and.resolveTo(false);

      await component.confirmCloseOrder();

      expect(mocks.ordersService.closeOrder).toHaveBeenCalledTimes(3);
      expect(mocks.onlineState.confirmConnectivity).toHaveBeenCalled();
      expect(mocks.onlineState.setOffline).toHaveBeenCalled();
      expect(mocks.offlineDb.addOfflineAction).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'CLOSE_ORDER', tableId: TABLE_A, orderId: '019f-server-order' }),
      );
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeTrue();
      expect(component.canvasVisible).toBeFalse();
      expect(mocks.queueProcessor.triggerProcessing).not.toHaveBeenCalled();
    });

    it('confirmCloseOrder does not free table when retries fail but ping succeeds', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: true,
        skipNgOnInit: true,
      });
      seedComponentTables(component, [
        createTable({ tableId: TABLE_A, tableName: 'Table A', isTableOpen: false }),
        createTable({ tableId: TABLE_B, tableName: 'Table B', isTableOpen: true }),
      ]);
      component.currentTableId = TABLE_A;
      component.currentOrderId = '019f-server-order';
      component.orderIsConfirmed = true;
      component.canvasVisible = true;
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });

      mocks.ordersService.closeOrder.and.returnValue(throwError(() => ({ status: 0 })));
      mocks.onlineState.confirmConnectivity.and.resolveTo(true);

      await component.confirmCloseOrder();

      expect(mocks.ordersService.closeOrder).toHaveBeenCalledTimes(3);
      expect(mocks.onlineState.setOffline).not.toHaveBeenCalled();
      expect(mocks.offlineDb.addOfflineAction).not.toHaveBeenCalled();
      expect(component.tables.find(t => t.tableId === TABLE_A)?.isTableOpen).toBeFalse();
      expect(component.canvasVisible).toBeTrue();
    });

    it('confirmCloseOrder HTTP 500 does not mark offline or queue', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: true,
        skipNgOnInit: true,
      });
      seedComponentTables(component, createDefaultTables());
      component.currentTableId = TABLE_A;
      component.currentOrderId = '019f-server-order';
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });

      mocks.ordersService.closeOrder.and.returnValue(throwError(() => ({ status: 500 })));

      await component.confirmCloseOrder();

      expect(mocks.ordersService.closeOrder).toHaveBeenCalledTimes(1);
      expect(mocks.onlineState.confirmConnectivity).not.toHaveBeenCalled();
      expect(mocks.onlineState.setOffline).not.toHaveBeenCalled();
      expect(mocks.offlineDb.addOfflineAction).not.toHaveBeenCalled();
    });

    it('isSetMenuActionDisabled blocks semi-offline device while offline', async () => {
      const { component } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: false,
        skipNgOnInit: true,
      });

      expect(component.isSetMenuActionDisabled()).toBeTrue();
    });

    it('openSetMenuModal is ignored when semi-offline device is offline', async () => {
      const { component } = await setupManageOrdersComponent({
        isOnline: false,
        isOfflinePrimaryDevice: false,
        skipNgOnInit: true,
      });
      component.todaySetMenu = {
        title: 'Menu',
        linkedMenuItemId: 'menu-1',
        lines: [],
      } as never;

      component.openSetMenuModal(createTable({ tableId: TABLE_A }));

      expect(component.setMenuModalVisible).toBeFalse();
    });

    it('confirmSetMenuOrder on free table adds set menu and confirms order', async () => {
      const { component, mocks } = await setupManageOrdersComponent({
        isOnline: true,
        skipNgOnInit: true,
      });
      seedComponentTables(component, createDefaultTables());
      setRestaurantId(component);
      component.todaySetMenu = {
        title: 'Meniul zilei',
        linkedMenuItemId: 'set-menu-shadow-1',
        priceAmount: 35,
        priceCurrency: 'RON',
        isAvailable: true,
        weekday: 1,
        lines: [{ sortOrder: 0, text: 'Ciorba' }],
      };
      mocks.offlineDb.loadCartRecord.and.resolveTo(null);

      component.openSetMenuModal(createTable({ tableId: TABLE_A, isTableOpen: true }));
      await component.confirmSetMenuOrder();

      expect(component.canvasVisible).toBeTrue();
      expect(component.currentTableId).toBe(TABLE_A);
      expect(component.orderIsConfirmed).toBeTrue();
      expect(component.tableCarts[TABLE_A]?.length).toBe(1);
      expect(mocks.offlineDb.addOfflineAction).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'NEW_ORDER', tableId: TABLE_A }),
      );
      expect(mocks.offlineDb.addOfflineAction).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'INIT_ORDER_ITEMS_FINAL',
          tableId: TABLE_A,
          payload: jasmine.objectContaining({
            items: jasmine.arrayContaining([
              jasmine.objectContaining({ menuItemId: 'set-menu-shadow-1', quantity: 1 }),
            ]),
          }),
        }),
      );
      expect(mocks.queueProcessor.triggerProcessing).toHaveBeenCalled();
    });
  });

  describe('keyboard and misc', () => {
    let component: ManageOrdersComponent;

    beforeEach(async () => {
      ({ component } = await setupManageOrdersComponent({ skipNgOnInit: true }));
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'order-1';
    });

    it('onEscPressed clears searchTerm and filteredResults', () => {
      component.searchTerm = 'pizza';
      component.filteredResults = [createMenuItem()];

      component.onEscPressed();

      expect(component.searchTerm).toBe('');
      expect(component.filteredResults).toEqual([]);
    });

    it('isPaymentLockedForCurrentTable reflects lock for active order', () => {
      component.paymentLockedByTable[TABLE_A] = { orderId: 'order-1' };
      expect((component as unknown as { isPaymentLockedForCurrentTable: () => boolean }).isPaymentLockedForCurrentTable()).toBeTrue();

      component.paymentLockedByTable[TABLE_A] = { orderId: 'other-order' };
      expect((component as unknown as { isPaymentLockedForCurrentTable: () => boolean }).isPaymentLockedForCurrentTable()).toBeFalse();
    });
  });

  describe('fiscal print and cash drawer', () => {
    it('canPrintFiscal is false without staff fiscal config', async () => {
      const { component } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      component.fiscalStaffConfig.set(null);
      expect(component.canPrintFiscal).toBeFalse();
      expect(component.canOpenCashDrawer).toBeFalse();
    });

    it('canPrintFiscal is true when fiscal printing enabled with printer id', async () => {
      const { component } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'main-fiscal',
      }));
      expect(component.canPrintFiscal).toBeTrue();
      expect(component.canOpenCashDrawer).toBeTrue();
    });

    it('printFiscalReceipt shows info toast when fiscal printer not configured', async () => {
      const { component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      setRestaurantId(component);
      component.currentOrderId = 'order-1';
      component.fiscalStaffConfig.set(null);

      await component.printFiscalReceipt('cash');

      expect(mocks.appToast.info).toHaveBeenCalled();
      expect(mocks.printJobs.createBillPrintJob).not.toHaveBeenCalled();
    });

    it('printFiscalReceipt sends card paymentMethod in payload', async () => {
      const { component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      setRestaurantId(component);
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'order-1';
      component.tableCarts[TABLE_A] = [{ item: createMenuItem({ menuItemName: 'Pizza' }), quantity: 1 }];
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'main-fiscal',
      }));
      mocks.printJobs.getDefaultFiscalPrinterForStaff.and.returnValue(
        of(createDefaultFiscalPrinterSettings({
          fiscalPrintingEnabled: true,
          defaultFiscalPrinterId: 'main-fiscal',
        })),
      );

      await component.printFiscalReceipt('card');

      expect(mocks.printJobs.createBillPrintJob).toHaveBeenCalledWith(
        TEST_RESTAURANT_ID,
        'main-fiscal',
        jasmine.objectContaining({ type: 'fiscal-receipt', paymentMethod: 'card' }),
      );
    });

    it('openCashDrawer queues fiscal-command payload online', async () => {
      const { component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      setRestaurantId(component);
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'main-fiscal',
      }));

      await component.openCashDrawer();

      expect(mocks.printJobs.createBillPrintJob).toHaveBeenCalledWith(
        TEST_RESTAURANT_ID,
        'main-fiscal',
        jasmine.objectContaining({ type: 'fiscal-command', command: 'open-drawer' }),
      );
      expect(mocks.appToast.success).toHaveBeenCalled();
    });

    it('openCashDrawer shows info toast when fiscal printer not configured', async () => {
      const { component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      setRestaurantId(component);
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: false,
        defaultFiscalPrinterId: null,
      }));

      await component.openCashDrawer();

      expect(mocks.appToast.info).toHaveBeenCalled();
      expect(mocks.printJobs.createBillPrintJob).not.toHaveBeenCalled();
    });
  });

  describe('kitchen print', () => {
    it('canPrintKitchen is true when a distinct non-fiscal printer is configured', async () => {
      const { component } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'fiscal-6',
      }));
      component.billStaffConfig.set({ defaultBillPrinterId: 'escpos-1' });
      expect(component.canPrintKitchen).toBeTrue();
    });

    it('canPrintKitchen is false when only fiscal printer id is set as bill printer', async () => {
      const { component } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'fiscal-6',
      }));
      component.billStaffConfig.set({ defaultBillPrinterId: 'fiscal-6' });
      expect(component.canPrintKitchen).toBeFalse();
    });

    it('printKitchen sends kitchen lines to the non-fiscal printer', async () => {
      const { component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      setRestaurantId(component);
      component.currentTableId = TABLE_A;
      component.currentOrderId = '019f6c5c-4928-7e2e-9d9a-8b2484b603b1';
      component.tableCarts[TABLE_A] = [
        { item: createMenuItem({ menuItemName: 'Soup', category: MenuItemCategory.Appetizer }), quantity: 1 },
        { item: createMenuItem({ menuItemId: 'wine-1', menuItemName: 'Merlot', category: MenuItemCategory.RedWine, menuItemPriceAmount: 30 }), quantity: 2 },
      ];
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'fiscal-6',
      }));
      component.billStaffConfig.set({ defaultBillPrinterId: 'escpos-1' });

      await component.printKitchen();

      expect(mocks.printJobs.createBillPrintJob).toHaveBeenCalledWith(
        TEST_RESTAURANT_ID,
        'escpos-1',
        jasmine.objectContaining({
          type: 'bill',
          orderId: '019f6c5c-4928-7e2e-9d9a-8b2484b603b1',
          subTotal: 25,
          finalTotal: 25,
          items: [{ name: 'Soup', quantity: 1, unitPrice: 25 }],
        }),
      );
    });

    it('confirmOrder does not auto-print to kitchen', async () => {
      const { component, mocks } = await setupManageOrdersComponent();
      await new Promise(resolve => setTimeout(resolve, 0));
      setRestaurantId(component);
      component.currentTableId = TABLE_A;
      component.tableCarts[TABLE_A] = [{ item: createMenuItem({ menuItemName: 'Soup', category: MenuItemCategory.Appetizer }), quantity: 1 }];
      component.fiscalStaffConfig.set(createDefaultFiscalPrinterSettings({
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'fiscal-6',
      }));
      component.billStaffConfig.set({ defaultBillPrinterId: 'escpos-1' });
      mocks.offlineDb.loadCart.and.resolveTo(component.tableCarts[TABLE_A]);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });

      await component.confirmOrder();
      mocks.queueProcessor.orderConfirmed$.next({ tableId: TABLE_A, orderId: '019f6c5c-4928-7e2e-9d9a-8b2484b603b1' });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mocks.printJobs.createBillPrintJob).not.toHaveBeenCalled();
    });

    it('printKitchen skips when cart has only bar lines', async () => {
      const { component, mocks } = await setupManageOrdersComponent({ skipNgOnInit: true, isOnline: true });
      setRestaurantId(component);
      component.currentTableId = TABLE_A;
      component.currentOrderId = 'order-bar';
      component.tableCarts[TABLE_A] = [
        { item: createMenuItem({ menuItemName: 'Merlot', category: MenuItemCategory.RedWine }), quantity: 1 },
      ];
      component.billStaffConfig.set({ defaultBillPrinterId: 'escpos-1' });

      await component.printKitchen();

      expect(mocks.printJobs.createBillPrintJob).not.toHaveBeenCalled();
    });
  });
});
