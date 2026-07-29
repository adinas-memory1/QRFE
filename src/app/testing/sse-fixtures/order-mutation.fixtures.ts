import { Currency } from '../../core/models/restaurantTablesModel';
import { OrderUpdatedSSEPayload } from '../../core/models/orderingModel';

/** Golden SSE payloads — behaviour anchored to sync-baseline-pwa (QRFE 5d02e76). */
export const SYNC_TEST_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';
export const SYNC_TABLE_A = '11111111-1111-1111-1111-111111111101';
export const SYNC_TABLE_B = '11111111-1111-1111-1111-111111111102';

export const MENU_PIZZA = 'menu-pizza-001';
export const MENU_BEER = 'menu-beer-001';
export const MENU_SALAD = 'menu-salad-001';

export const ORDER_A = '019f3370-ec26-7b09-bac1-8da7ab1606a6';
export const ORDER_B = '019f3376-eac8-79e0-bc15-784160691f5d';

export const LINE_PIZZA_1 = 'line-pizza-001';
export const LINE_BEER_1 = 'line-beer-001';
export const LINE_SALAD_1 = 'line-salad-001';

const ts = '2026-07-05T12:00:00.000Z';
const tsQty = '2026-07-05T12:01:00.000Z';
const tsDel = '2026-07-05T12:02:00.000Z';

function sseLine(
  orderItemId: string,
  menuItemId: string,
  name: string,
  quantity: number,
  category: string,
) {
  return {
    OrderItemId: orderItemId,
    MenuItemId: menuItemId,
    OrderItemName: name,
    Quantity: quantity,
    OrderItemPriceAmount: 10,
    OrderItemPriceCurrency: Currency.RON,
    Category: category,
  };
}

/** Secondary (or primary) adds first food item to table A. */
export function fixtureOrderUpdatedAddNewFood(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 25, Currency: 'RON' },
    ItemCount: 1,
    LastAddedItem: 'Pizza',
    LastActionAt: ts,
    Items: [sseLine(LINE_PIZZA_1, MENU_PIZZA, 'Pizza', 1, 'Main')],
  };
}

/** Same menu item, quantity 1 → 2 (button + or second ADD_ITEM). */
export function fixtureOrderUpdatedQtyIncreaseFood(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 50, Currency: 'RON' },
    ItemCount: 2,
    LastAddedItem: 'Pizza',
    LastActionAt: tsQty,
    Items: [sseLine(LINE_PIZZA_1, MENU_PIZZA, 'Pizza', 2, 'Main')],
  };
}

/** Quantity 2 → 1 (button −, not x). */
export function fixtureOrderUpdatedQtyDecreaseFood(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 25, Currency: 'RON' },
    ItemCount: 1,
    LastAddedItem: 'Pizza',
    LastActionAt: tsQty,
    Items: [sseLine(LINE_PIZZA_1, MENU_PIZZA, 'Pizza', 1, 'Main')],
  };
}

/** Same menu item, quantity 2 → 3 (rapid increment). */
export function fixtureOrderUpdatedQtyTripleFood(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 75, Currency: 'RON' },
    ItemCount: 3,
    LastAddedItem: 'Pizza',
    LastActionAt: '2026-07-05T12:02:00.000Z',
    Items: [sseLine(LINE_PIZZA_1, MENU_PIZZA, 'Pizza', 3, 'Main')],
  };
}

/** Line removed (button x → DELETE_ITEM). */
export function fixtureOrderUpdatedDeleteFood(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 0, Currency: 'RON' },
    ItemCount: 0,
    LastAddedItem: '',
    LastActionAt: tsDel,
    Items: [],
  };
}

/** Primary adds first drink — bar should show order. */
export function fixtureOrderUpdatedAddNewDrink(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 15, Currency: 'RON' },
    ItemCount: 1,
    LastAddedItem: 'Beer',
    LastActionAt: ts,
    Items: [sseLine(LINE_BEER_1, MENU_BEER, 'Beer', 1, 'beer')],
  };
}

export function fixtureOrderUpdatedQtyIncreaseDrink(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 30, Currency: 'RON' },
    ItemCount: 2,
    LastAddedItem: 'Beer',
    LastActionAt: tsQty,
    Items: [sseLine(LINE_BEER_1, MENU_BEER, 'Beer', 2, 'beer')],
  };
}

/** Same drink, quantity 2 → 3 (rapid increment). */
export function fixtureOrderUpdatedQtyTripleDrink(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 45, Currency: 'RON' },
    ItemCount: 3,
    LastAddedItem: 'Beer',
    LastActionAt: '2026-07-05T12:02:00.000Z',
    Items: [sseLine(LINE_BEER_1, MENU_BEER, 'Beer', 3, 'beer')],
  };
}

export function fixtureOrderUpdatedQtyDecreaseDrink(tableId = SYNC_TABLE_A, orderId = ORDER_A): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 15, Currency: 'RON' },
    ItemCount: 1,
    LastAddedItem: 'Beer',
    LastActionAt: tsQty,
    Items: [sseLine(LINE_BEER_1, MENU_BEER, 'Beer', 1, 'beer')],
  };
}

/** Secondary adds item while primary has canvas on another table — inbound cross-device. */
export function fixtureOrderUpdatedSecondaryToPrimary(
  tableId = SYNC_TABLE_B,
  orderId = ORDER_B,
): OrderUpdatedSSEPayload {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    SubTotal: { Amount: 15, Currency: 'RON' },
    ItemCount: 1,
    LastAddedItem: 'Salad',
    LastActionAt: ts,
    Items: [sseLine(LINE_SALAD_1, MENU_SALAD, 'Salad', 1, 'Starters')],
  };
}

export function fixtureNewOrderPublicEvent(tableId = SYNC_TABLE_A, orderId = ORDER_A) {
  return {
    RestaurantId: SYNC_TEST_RESTAURANT_ID,
    TableId: tableId,
    OrderId: orderId,
    Items: [],
    SubTotal: { Amount: 0, Currency: 'RON' },
  };
}
