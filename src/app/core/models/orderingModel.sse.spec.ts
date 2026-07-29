import { Currency } from './restaurantTablesModel';
import {
  applyOrderCurrencyToCart,
  cartItemsFromSseLines,
  normalizeCurrencyCode,
  orderDtoFromSsePayload,
  orderItemDtoFromSseLine,
  OrderDTO,
  OrderUpdatedSSEPayload,
  resolveOrderCurrency,
} from './orderingModel';

describe('orderingModel SSE helpers', () => {
  const line = {
    OrderItemId: 'oi-1',
    MenuItemId: 'menu-1',
    OrderItemName: 'Pizza',
    Quantity: 2,
    OrderItemPriceAmount: 10,
    OrderItemPriceCurrency: Currency.RON,
    Category: 'Main',
  };

  it('orderItemDtoFromSseLine maps PascalCase fields', () => {
    const dto = orderItemDtoFromSseLine(line);
    expect(dto.orderItemId).toBe('oi-1');
    expect(dto.menuItemId).toBe('menu-1');
    expect(dto.orderItemName).toBe('Pizza');
    expect(dto.quantity).toBe(2);
  });

  it('cartItemsFromSseLines builds cart lines', () => {
    const cart = cartItemsFromSseLines([line]);
    expect(cart.length).toBe(1);
    expect(cart[0].quantity).toBe(2);
    expect(cart[0].orderItemId).toBe('oi-1');
  });

  it('cartItemsFromSseLines preserves menuItemVatPercent from menu cache', () => {
    const menuItems = [{
      menuItemId: 'menu-1',
      menuItemName: 'Glupers',
      menuItemPriceAmount: 20,
      category: 'Appetizer',
      menuItemVatPercent: 19,
    }];
    const cart = cartItemsFromSseLines([line], menuItems);
    expect(cart[0].item.menuItemVatPercent).toBe(19);
  });

  it('orderDtoFromSsePayload builds open order with items', () => {
    const payload: OrderUpdatedSSEPayload = {
      RestaurantId: 'r1',
      TableId: 't1',
      OrderId: 'order-1',
      SubTotal: { Amount: 20, Currency: 'RON' },
      ItemCount: 2,
      LastAddedItem: 'Pizza',
      LastActionAt: '2026-01-01T12:00:00.000Z',
      Items: [line],
    };
    const order = orderDtoFromSsePayload('t1', payload, 'Maria');
    expect(order.orderId).toBe('order-1');
    expect(order.isOrderOpen).toBeTrue();
    expect(order.orderItems?.length).toBe(1);
    expect(order.lastInitiatedBy).toBe('Maria');
  });

  it('resolveOrderCurrency falls back to order.currency when subTotal currency is missing', () => {
    const order: OrderDTO = {
      orderId: 'o1',
      createdOn: '2026-01-01T12:00:00.000Z',
      isOrderOpen: true,
      currency: Currency.RON,
      subTotal: { amount: 25 } as OrderDTO['subTotal'],
    };
    expect(resolveOrderCurrency(order)).toBe('RON');
  });

  it('resolveOrderCurrency falls back to line item currency after sync-shaped order', () => {
    const order: OrderDTO = {
      orderId: 'o1',
      createdOn: '2026-01-01T12:00:00.000Z',
      isOrderOpen: true,
      currency: '' as Currency,
      orderItems: [{
        menuItemId: 'm1',
        orderItemName: 'Soup',
        orderItemPriceAmount: 10,
        orderItemPriceCurrency: Currency.EUR,
        orderItemDescription: '',
        category: 'Main',
        quantity: 1,
      }],
    };
    expect(resolveOrderCurrency(order)).toBe('EUR');
  });

  it('normalizeCurrencyCode maps numeric API enums and camelCase codes', () => {
    expect(normalizeCurrencyCode(2)).toBe('RON');
    expect(normalizeCurrencyCode('rON')).toBe('RON');
    expect(normalizeCurrencyCode('eur')).toBe('EUR');
  });

  it('orderItemDtoFromSseLine maps numeric OrderItemPriceCurrency to RON', () => {
    const dto = orderItemDtoFromSseLine({
      ...line,
      OrderItemPriceCurrency: 2 as unknown as string,
    });
    expect(dto.orderItemPriceCurrency).toBe('RON');
  });

  it('applyOrderCurrencyToCart overwrites stale EUR line currencies', () => {
    const stamped = applyOrderCurrencyToCart(
      [{
        item: {
          menuItemId: 'm1',
          menuItemName: 'Soup',
          menuItemPriceAmount: 10,
          menuItemPriceCurrency: 'EUR',
          category: 'Main',
        },
        quantity: 1,
      }],
      'RON',
    );
    expect(stamped[0].item.menuItemPriceCurrency).toBe('RON');
  });
});
