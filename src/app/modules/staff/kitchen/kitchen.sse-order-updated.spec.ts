/**
 * Kitchen station OrderUpdated diff — sync-baseline-pwa contract.
 */
import { TestBed } from '@angular/core/testing';
import { KitchenComponent } from './kitchen.component';
import {
  createCartLine,
  createFoodMenuItem,
  createStarterMenuItem,
  invokeStationSse,
  setupKitchenComponent,
  SYNC_TABLE_A,
} from '../../../testing/sse-sync-test-harness';
import {
  fixtureOrderUpdatedAddNewFood,
  fixtureOrderUpdatedDeleteFood,
  fixtureOrderUpdatedFirstKitchenLineIncrement,
  fixtureOrderUpdatedIncompleteItems,
  fixtureOrderUpdatedQtyDecreaseFood,
  fixtureOrderUpdatedQtyIncreaseFood,
  fixtureOrderUpdatedQtyTripleFood,
  fixtureOrderUpdatedTwoKitchenLines,
  LINE_GELATO_1,
  LINE_PIZZA_1,
  ORDER_A,
} from '../../../testing/sse-fixtures/order-mutation.fixtures';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';

async function flushKitchenOrderUpdates(
  component: KitchenComponent,
  tableId = SYNC_TABLE_A,
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  const chain = (component as unknown as { orderUpdatedChainByTableId: Map<string, Promise<void>> })
    .orderUpdatedChainByTableId.get(tableId);
  if (chain) await chain;
}

describe('KitchenComponent OrderUpdated SSE (sync regression)', () => {
  let component: KitchenComponent;
  let mocks: Awaited<ReturnType<typeof setupKitchenComponent>>['mocks'];

  beforeEach(async () => {
    ({ component, mocks } = await setupKitchenComponent());
  });

  it('shows new food item when order gains first kitchen line', async () => {
    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedAddNewFood(), 401);
    await flushKitchenOrderUpdates(component);

    expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
    const order = component.ordersByTableId[SYNC_TABLE_A];
    expect(order?.items.length).toBe(1);
    expect(order?.items[0].quantity).toBe(1);
  });

  it('updates qty when same food item already in cart (1→2)', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 1, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 1, LINE_PIZZA_1)],
    };

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseFood(), 402);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(2);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].opText).toBe('↑ 1 → 2');
  });

  it('shows up arrow on each consecutive increment (1→2→3)', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 1, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 1, LINE_PIZZA_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseFood(), 402);
    await flushKitchenOrderUpdates(component);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].opText).toBe('↑ 1 → 2');

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyTripleFood(), 403);
    await flushKitchenOrderUpdates(component);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(3);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].opText).toBe('↑ 2 → 3');
  });

  it('ignores stale OrderUpdated snapshots that arrive out of order', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 3, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 3, LINE_PIZZA_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);
    (component as unknown as { lastAppliedSequenceByTableId: Record<string, number> }).lastAppliedSequenceByTableId = {
      [SYNC_TABLE_A]: 403,
    };
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseFood(), 402);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(3);
  });

  it('ignores OrderItemQuantityUpdated and keeps OrderUpdated diff as source of truth', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 2, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 2, LINE_PIZZA_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);

    await invokeStationSse(component, 'OrderItemQuantityUpdated', {
      OrderId: ORDER_A,
      OrderItemId: LINE_PIZZA_1,
      Quantity: 1,
    }, 499);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(2);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].opText).toBeUndefined();
  });

  it('updates qty when minus button reduces quantity (2→1)', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 2, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 2, LINE_PIZZA_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyDecreaseFood(), 403);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(1);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].opText).toBe('↓ 2 → 1');
  });

  it('clears kitchen order when OrderClosedWithPayment arrives', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 2, LINE_PIZZA_1)], ORDER_A, true);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);
    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeDefined();

    await invokeStationSse(component, 'OrderClosedWithPayment', {
      TableId: SYNC_TABLE_A,
      OrderId: ORDER_A,
    }, 405);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeUndefined();
    expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(SYNC_TABLE_A);
  });

  it('does not resurrect kitchen order when stale OrderUpdated arrives after close', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 2, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 2, LINE_PIZZA_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);

    await invokeStationSse(component, 'OrderClosedWithPayment', {
      TableId: SYNC_TABLE_A,
      OrderId: ORDER_A,
    }, 410);
    await flushKitchenOrderUpdates(component);
    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeUndefined();

    mocks.offlineDb.saveCart.calls.reset();
    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseFood(), 404);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeUndefined();
    expect(mocks.offlineDb.saveCart).not.toHaveBeenCalled();
  });

  it('clears kitchen order when last food line removed (delete via x)', async () => {
    const pizza = createFoodMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(pizza, 1, LINE_PIZZA_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(pizza, 1, LINE_PIZZA_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedDeleteFood(), 404);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeUndefined();
    expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(SYNC_TABLE_A);
  });

  it('does not clear kitchen order on incomplete OrderUpdated (empty Items, ItemCount > 0)', async () => {
    const pizza = createFoodMenuItem({ menuItemName: 'Tiramisu' });
    const gelato = createStarterMenuItem({ menuItemId: 'menu-gelato-001', menuItemName: 'Gelato', category: 'Dessert' });
    const cart = [
      createCartLine(pizza, 21, LINE_PIZZA_1),
      createCartLine(gelato, 1, LINE_GELATO_1),
    ];
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, cart, ORDER_A, true);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);
    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeDefined();

    mocks.offlineDb.deleteCart.calls.reset();
    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedIncompleteItems(), 500);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeDefined();
    expect(mocks.offlineDb.deleteCart).not.toHaveBeenCalled();
  });

  it('increment on one line does not toast other lines when memory snapshot was empty', async () => {
    const toast = TestBed.inject(AppToastService) as jasmine.SpyObj<AppToastService>;
    const pizza = createFoodMenuItem({ menuItemName: 'Tiramisu' });
    const gelato = createStarterMenuItem({ menuItemId: 'menu-gelato-001', menuItemName: 'Gelato', category: 'Dessert' });
    const cart = [
      createCartLine(pizza, 20, LINE_PIZZA_1),
      createCartLine(gelato, 1, LINE_GELATO_1),
    ];
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, cart, ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {};
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedFirstKitchenLineIncrement(), 501);
    await flushKitchenOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items.length).toBe(2);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].opText).toBe('↑ 20 → 21');
    const stickyBodies = toast.sticky.calls.allArgs().map(args => String(args[0]));
    expect(stickyBodies.some(body => body.includes('Gelato'))).toBe(false);
  });
});
