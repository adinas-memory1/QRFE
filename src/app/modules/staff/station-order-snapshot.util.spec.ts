import {
  isIncompleteOrderUpdatedPayload,
  resolveIsNewStationOrder,
  shouldClearStationOrder,
} from './station-order-snapshot.util';

describe('station-order-snapshot.util', () => {
  it('shouldClearStationOrder rejects empty items with positive itemCount', () => {
    expect(shouldClearStationOrder(22, 0)).toBe(false);
    expect(isIncompleteOrderUpdatedPayload(22, 0)).toBe(true);
  });

  it('shouldClearStationOrder clears truly empty orders', () => {
    expect(shouldClearStationOrder(0, 0)).toBe(true);
  });

  it('resolveIsNewStationOrder requires empty previous station lines', () => {
    const seen = new Set<string>();
    expect(resolveIsNewStationOrder('order-1', 2, 0, seen)).toBe(true);
    seen.add('order-1');
    expect(resolveIsNewStationOrder('order-1', 2, 0, seen)).toBe(false);
    expect(resolveIsNewStationOrder('order-1', 2, 1, seen)).toBe(false);
  });
});
