import { categoryFromOrderLine, lookupMenuItem, menuItemWithNormalizedCategory } from "./menu/cart-item-category";
import { MenuItem } from "./menu/menuItem";
import { Currency, SeatDTO } from "./restaurantTablesModel";
import { TaxLineDto } from "./tax-calculation.model";

export interface OrderItemDTO {
  orderItemId?: string;
  menuItemId: string;
  orderItemName: string;
  orderItemPriceAmount?: number;
  orderItemPriceCurrency: Currency;
  orderItemDescription: string;
  category: string; // MenuItemCategory as string
  quantity: number;
}

export interface InitAddOrderResponse {
  order: OrderDTO;
}

export interface OrderDTO {
  restaurantId?: string;
  orderId: string;
  tableId?: string;
  seat?: SeatDTO;
  seatId?: string;
  createdOn: string;   // ISO date string
  closedAt?: string;   // ISO date string
  orderItems?: (OrderItemDTO | null)[];
  currency: Currency;
  isOrderOpen: boolean;
  subTotal?: MoneyDTO;
  taxAmount?: number;
  totalAmount?: number;
  taxLines?: TaxLineDto[];
  paymentMethod?: string;
  finalTotalPrice?: FinalTotalPrice;
  /** Staff display name from last order mutation (included in /api/sync). */
  lastInitiatedBy?: string;
  /** Device that last mutated this order (pickup haptic targeting). */
  clientInstanceId?: string;
}

/** Read LastInitiatedBy from API/Dexie (camelCase or PascalCase). */
export function readOrderId(order: OrderDTO | null | undefined): string {
  if (!order) {
    return '';
  }
  const rec = order as unknown as Record<string, unknown>;
  const id = rec['orderId'] ?? rec['OrderId'];
  return typeof id === 'string' ? id.trim() : '';
}

export function readIsOrderOpen(order: OrderDTO | null | undefined): boolean {
  if (!order) {
    return false;
  }
  const rec = order as unknown as Record<string, unknown>;
  const open = rec['isOrderOpen'] ?? rec['IsOrderOpen'];
  if (open === false || open === 'false' || open === 0) {
    return false;
  }
  if (open === true || open === 'true' || open === 1) {
    return true;
  }
  return false;
}

export function readOrderLastInitiatedBy(order: OrderDTO | null | undefined): string {
  if (!order) return '';
  const rec = order as unknown as Record<string, unknown>;
  const v = rec['lastInitiatedBy'] ?? rec['LastInitiatedBy'];
  return typeof v === 'string' ? v.trim() : '';
}

/** Last mutation timestamp from order snapshot or line items (API may omit a top-level field). */
export function readOrderLastActionAt(order: OrderDTO | null | undefined): string {
  if (!order) return '';
  const rec = order as unknown as Record<string, unknown>;
  const direct = rec['lastActionAt'] ?? rec['LastActionAt'] ?? rec['updatedAt'] ?? rec['UpdatedAt'];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  let maxTs = '';
  for (const item of order.orderItems ?? []) {
    if (!item) continue;
    const itemRec = item as unknown as Record<string, unknown>;
    for (const key of ['updatedAt', 'UpdatedAt', 'createdAt', 'CreatedAt'] as const) {
      const candidate = itemRec[key];
      if (typeof candidate === 'string' && candidate.trim() && candidate > maxTs) {
        maxTs = candidate.trim();
      }
    }
  }
  return maxTs;
}

/** True when table snapshot includes an open order (tolerant of PascalCase / missing flag). */
export function tableHasActiveOrder(order: OrderDTO | null | undefined): boolean {
  if (!order) return false;
  const rec = order as unknown as Record<string, unknown>;
  const orderId = rec['orderId'] ?? rec['OrderId'];
  if (typeof orderId !== 'string' || !orderId.trim()) return false;
  const open = rec['isOrderOpen'] ?? rec['IsOrderOpen'];
  return open !== false && open !== 'false' && open !== 0;
}

export interface MoneyDTO {
  amount?: number;
  currency: Currency;
}

export interface FinalTotalPrice {
  amount?: number;
  currency: Currency;
  // Id, OrderId, Order are ignored in JSON (so not needed here)
}

/** Same order as Domain.Enums.Currency — used when API serializes currency as a number. */
export const CURRENCY_CODES_BY_INDEX = [
  'USD', 'EUR', 'RON', 'GBP', 'SEK', 'NOK', 'DKK', 'JPY', 'CHF', 'AUD', 'CAD', 'CNY', 'INR', 'BRL',
] as const;

/** Normalize API/menu currency (string, camelCase like rON, or numeric enum index) to ISO code. */
export function normalizeCurrencyCode(raw: unknown, fallback = ''): string {
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return fallback;
    if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
    return s.toUpperCase();
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < CURRENCY_CODES_BY_INDEX.length) {
    return CURRENCY_CODES_BY_INDEX[raw];
  }
  return fallback;
}

/** Read amount from MoneyDTO-like payloads (camelCase or PascalCase). */
export function readMoneyAmount(money: unknown): number | undefined {
  if (!money || typeof money !== 'object') return undefined;
  const rec = money as Record<string, unknown>;
  const raw = rec['amount'] ?? rec['Amount'];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/** Read currency code from MoneyDTO-like payloads (camelCase or PascalCase). */
export function readMoneyCurrency(money: unknown): string {
  if (!money || typeof money !== 'object') return '';
  const rec = money as Record<string, unknown>;
  return normalizeCurrencyCode(rec['currency'] ?? rec['Currency']);
}

/**
 * Resolve display currency for a table total after sync/refresh.
 * Prefer subTotal / finalTotal, then order.currency, then first line item.
 */
export function resolveOrderCurrency(order: OrderDTO | null | undefined): string {
  if (!order) return '';
  const rec = order as unknown as Record<string, unknown>;
  const fromMoney =
    readMoneyCurrency(order.subTotal)
    || readMoneyCurrency(order.finalTotalPrice)
    || readMoneyCurrency(rec['SubTotal'])
    || readMoneyCurrency(rec['FinalTotalPrice']);
  if (fromMoney) return fromMoney;

  const fromOrder = normalizeCurrencyCode(rec['currency'] ?? rec['Currency']);
  if (fromOrder) return fromOrder;

  for (const item of order.orderItems ?? []) {
    if (!item) continue;
    const line = item as unknown as Record<string, unknown>;
    const lineCurrency = normalizeCurrencyCode(
      line['orderItemPriceCurrency'] ?? line['OrderItemPriceCurrency'],
    );
    if (lineCurrency) return lineCurrency;
  }
  return '';
}

/** Stamp restaurant/order currency onto cart lines (POS is single-currency per order). */
export function applyOrderCurrencyToCart(cart: CartItem[], orderCurrency: string | null | undefined): CartItem[] {
  const currency = normalizeCurrencyCode(orderCurrency);
  if (!currency || !cart.length) return cart;
  return cart.map(line => ({
    ...line,
    item: {
      ...line.item,
      menuItemPriceCurrency: currency,
    },
  }));
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
  orderItemId?: string; 
}

/** Build a cart line from persisted order data; optional menu merge enriches icon/availability. */
export function cartItemFromOrderLine(
  orderItem: OrderItemDTO,
  menuItems?: Iterable<MenuItem>,
  orderCurrency?: string | null,
): CartItem {
  const menuMap = menuItems
    ? Object.fromEntries([...menuItems].map(m => [m.menuItemId.toLowerCase(), m]))
    : {};
  const fromMenu = lookupMenuItem(menuMap, orderItem.menuItemId);
  const lineRec = orderItem as unknown as Record<string, unknown>;
  const lineCurrency = normalizeCurrencyCode(
    orderItem.orderItemPriceCurrency ?? lineRec['OrderItemPriceCurrency'],
  );
  const menuCurrency = normalizeCurrencyCode(fromMenu?.menuItemPriceCurrency);
  const fallbackCurrency = normalizeCurrencyCode(orderCurrency);

  const baseItem: MenuItem = {
    menuItemId: orderItem.menuItemId,
    menuItemName: orderItem.orderItemName,
    menuItemDescription: orderItem.orderItemDescription,
    menuItemPriceAmount: orderItem.orderItemPriceAmount ?? fromMenu?.menuItemPriceAmount ?? 0,
    // Order currency wins: line/menu can still say EUR after the restaurant switched to RON.
    menuItemPriceCurrency: fallbackCurrency || lineCurrency || menuCurrency || undefined,
    menuItemIconUrl: fromMenu?.menuItemIconUrl,
    category: categoryFromOrderLine(orderItem.category, fromMenu),
    isAvailable: fromMenu?.isAvailable,
    menuItemVatPercent: fromMenu?.menuItemVatPercent,
  };

  return {
    item: menuItemWithNormalizedCategory(baseItem),
    quantity: orderItem.quantity,
    orderItemId: orderItem.orderItemId,
  };
}

export interface TableCart {
  [tableId: string]: CartItem[];
}

export interface AddOrderItemResponse {
  orderId: string;
  orderItemId: string;
  menuItemId: string;
  quantity: number;
  action: string; 
}

export interface UpdateOrderItemQuantityResponse {
  orderId: string;
  orderItemId: string;    
  quantity: number;
  action: string; 
}

export interface DeleteOrderItemSSEPayload {
  orderId: string;
  orderItemId: string;
  quantity: number;
  action: string;
}

export interface TableComputedInfo {
  lastActionAt: string;   // ex: "2 minute în urmă"
  lastAddedItem: string;    // ex: "Pizza Margherita"
  total: number;            // subtotal numeric
  currency: string;         // ex: "EUR"
  itemCount: number;        // total items in order
  cssClass: string;         // ex: "bg-success text-white"
}


export interface OrderUpdatedSSEPayload {
  RestaurantId: string;
  TableId: string;
  OrderId: string;

  SubTotal: {
    Amount: number;
    Currency: string;
  } | null;

  ItemCount: number;

  LastAddedItem: string | null;
  LastActionAt: string; // ISO string trimis de backend

  Items: {
    OrderItemId: string;
    MenuItemId: string;
    Quantity: number;
    OrderItemName?: string;
    OrderItemDescription?: string;
    Category?: string;
    OrderItemPriceAmount: number;
    OrderItemPriceCurrency: string;
  }[];
}

export type OrderUpdatedSseLineItem = OrderUpdatedSSEPayload['Items'][number];

function readSseLineString(line: OrderUpdatedSseLineItem, camel: string, pascal: string): string {
  const rec = line as unknown as Record<string, unknown>;
  const v = rec[camel] ?? rec[pascal];
  return typeof v === 'string' ? v : '';
}

function readSseLineNumber(line: OrderUpdatedSseLineItem, camel: string, pascal: string): number {
  const rec = line as unknown as Record<string, unknown>;
  const v = rec[camel] ?? rec[pascal];
  return typeof v === 'number' ? v : 0;
}

/** Map one SSE order line to OrderItemDTO (PascalCase/camelCase tolerant). */
export function orderItemDtoFromSseLine(line: OrderUpdatedSseLineItem): OrderItemDTO {
  const rec = line as unknown as Record<string, unknown>;
  const currency = normalizeCurrencyCode(
    rec['orderItemPriceCurrency'] ?? rec['OrderItemPriceCurrency'],
  ) as Currency;
  return {
    orderItemId: readSseLineString(line, 'orderItemId', 'OrderItemId') || undefined,
    menuItemId: readSseLineString(line, 'menuItemId', 'MenuItemId'),
    orderItemName: readSseLineString(line, 'orderItemName', 'OrderItemName'),
    orderItemDescription: readSseLineString(line, 'orderItemDescription', 'OrderItemDescription'),
    category: readSseLineString(line, 'category', 'Category'),
    orderItemPriceAmount: readSseLineNumber(line, 'orderItemPriceAmount', 'OrderItemPriceAmount'),
    orderItemPriceCurrency: currency,
    quantity: readSseLineNumber(line, 'quantity', 'Quantity'),
  };
}

/** Build cart lines from SSE Items[] using optional menu cache for icons/names. */
export function cartItemsFromSseLines(
  lines: OrderUpdatedSseLineItem[] | null | undefined,
  menuItems?: MenuItem[],
  orderCurrency?: string | null,
): CartItem[] {
  return (lines ?? []).map(line => cartItemFromOrderLine(orderItemDtoFromSseLine(line), menuItems, orderCurrency));
}

/** Minimal OrderDTO for local replica from SSE snapshot. */
export function orderDtoFromSsePayload(
  tableId: string,
  payload: OrderUpdatedSSEPayload,
  initiatedBy?: string,
): OrderDTO {
  const sub = payload.SubTotal as { Amount?: number; Currency?: string; amount?: number; currency?: string } | null;
  const currency = normalizeCurrencyCode(
    sub?.Currency ?? sub?.currency ?? payload.Items?.[0]?.OrderItemPriceCurrency,
  ) as Currency;
  const orderItems = (payload.Items ?? []).map(line => {
    const item = orderItemDtoFromSseLine(line);
    if (!item.orderItemPriceCurrency) {
      item.orderItemPriceCurrency = currency;
    }
    return item;
  });
  return {
    orderId: payload.OrderId,
    tableId,
    createdOn: payload.LastActionAt || new Date().toISOString(),
    isOrderOpen: true,
    currency,
    orderItems,
    subTotal: sub
      ? { amount: sub.Amount ?? sub.amount ?? 0, currency }
      : undefined,
    lastInitiatedBy: initiatedBy?.trim() || undefined,
  };
}

export interface TableComputedDTO {
  tableId: string;
  isTableOpen: boolean;
  orderId?: string;
  lastActionAt?: string;  
  lastAddedItem?: string;    // ex: "Pizza Margherita"
  subTotal?: MoneyDTO;
  itemCount?: number;
}

