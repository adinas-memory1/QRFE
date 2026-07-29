/**
 * Bar station OrderUpdated diff — sync-baseline-pwa contract.
 * Primary adds drink → bar realtime (without manual refresh).
 */
import { BarComponent } from './bar.component';
import {
  invokeStationSse,
  setupBarComponent,
  SYNC_TABLE_A,
  createCartLine,
  createDrinkMenuItem,
} from '../../../testing/sse-sync-test-harness';
import {
  fixtureOrderUpdatedAddNewDrink,
  fixtureOrderUpdatedQtyDecreaseDrink,
  fixtureOrderUpdatedQtyIncreaseDrink,
  fixtureOrderUpdatedQtyTripleDrink,
  LINE_BEER_1,
  ORDER_A,
} from '../../../testing/sse-fixtures/order-mutation.fixtures';

async function flushBarOrderUpdates(
  component: BarComponent,
  tableId = SYNC_TABLE_A,
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  const chain = (component as unknown as { orderUpdatedChainByTableId: Map<string, Promise<void>> })
    .orderUpdatedChainByTableId.get(tableId);
  if (chain) await chain;
}

describe('BarComponent OrderUpdated SSE (sync regression)', () => {
  let component: BarComponent;
  let mocks: Awaited<ReturnType<typeof setupBarComponent>>['mocks'];

  beforeEach(async () => {
    ({ component, mocks } = await setupBarComponent());
  });

  it('shows new drink order when primary adds first beverage (OrderUpdated)', async () => {
    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedAddNewDrink(), 301);
    await flushBarOrderUpdates(component);

    expect(mocks.offlineDb.saveCart).toHaveBeenCalled();
    const order = component.ordersByTableId[SYNC_TABLE_A];
    expect(order?.orderId).toBe(ORDER_A);
    expect(order?.items.length).toBe(1);
    expect(order?.items[0].quantity).toBe(1);
    expect(order?.items[0].orderItemId).toBe(LINE_BEER_1);
  });

  it('updates quantity when same drink is added again (qty 1→2)', async () => {
    const beer = createDrinkMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(beer, 1, LINE_BEER_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(beer, 1, LINE_BEER_1)],
    };

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseDrink(), 302);
    await flushBarOrderUpdates(component);

    const order = component.ordersByTableId[SYNC_TABLE_A];
    expect(order?.items[0].quantity).toBe(2);
  });

  it('updates quantity when drink qty decreases via minus button (2→1)', async () => {
    const beer = createDrinkMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(beer, 2, LINE_BEER_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(beer, 2, LINE_BEER_1)],
    };

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyDecreaseDrink(), 303);
    await flushBarOrderUpdates(component);

    const order = component.ordersByTableId[SYNC_TABLE_A];
    expect(order?.items[0].quantity).toBe(1);
  });

  it('does not drop consecutive OrderUpdated with different sequences', async () => {
    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedAddNewDrink(), 304);
    await flushBarOrderUpdates(component);
    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseDrink(), 305);
    await flushBarOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(2);
  });

  it('applies consecutive drink increments in order (1→2→3)', async () => {
    const beer = createDrinkMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(beer, 1, LINE_BEER_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(beer, 1, LINE_BEER_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseDrink(), 306);
    await flushBarOrderUpdates(component);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(2);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyTripleDrink(), 307);
    await flushBarOrderUpdates(component);
    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(3);
  });

  it('ignores stale OrderUpdated snapshots that arrive out of order', async () => {
    const beer = createDrinkMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(beer, 3, LINE_BEER_1)], ORDER_A, true);
    (component as unknown as { lastCartSnapshotByTableId: Record<string, unknown[]> }).lastCartSnapshotByTableId = {
      [SYNC_TABLE_A]: [createCartLine(beer, 3, LINE_BEER_1)],
    };
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);
    (component as unknown as { lastAppliedSequenceByTableId: Record<string, number> }).lastAppliedSequenceByTableId = {
      [SYNC_TABLE_A]: 307,
    };
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);

    await invokeStationSse(component, 'OrderUpdated', fixtureOrderUpdatedQtyIncreaseDrink(), 306);
    await flushBarOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(3);
  });

  it('ignores OrderItemQuantityUpdated and keeps OrderUpdated diff as source of truth', async () => {
    const beer = createDrinkMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(beer, 2, LINE_BEER_1)], ORDER_A, true);
    (component as unknown as { seenServerOrderIds: Set<string> }).seenServerOrderIds.add(ORDER_A);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);

    await invokeStationSse(component, 'OrderItemQuantityUpdated', {
      OrderId: ORDER_A,
      OrderItemId: LINE_BEER_1,
      Quantity: 1,
    }, 399);
    await flushBarOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]?.items[0].quantity).toBe(2);
  });

  it('clears bar order when OrderClosedWithPayment arrives', async () => {
    const beer = createDrinkMenuItem();
    await mocks.offlineDb.saveCart(SYNC_TABLE_A, [createCartLine(beer, 2, LINE_BEER_1)], ORDER_A, true);
    await (component as unknown as { rebuildFromDexie: (id: string) => Promise<void> }).rebuildFromDexie(SYNC_TABLE_A);
    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeDefined();

    await invokeStationSse(component, 'OrderClosedWithPayment', {
      TableId: SYNC_TABLE_A,
      OrderId: ORDER_A,
    }, 308);
    await flushBarOrderUpdates(component);

    expect(component.ordersByTableId[SYNC_TABLE_A]).toBeUndefined();
    expect(mocks.offlineDb.deleteCart).toHaveBeenCalledWith(SYNC_TABLE_A);
  });
});
