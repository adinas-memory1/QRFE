import { CartItem } from '../../core/models/orderingModel';

/** Do not wipe local cart on incomplete SSE (empty Items but positive ItemCount). */
export function shouldClearStationOrder(itemCount: number, nextCartLength: number): boolean {
  if (nextCartLength === 0 && itemCount > 0) {
    return false;
  }
  return itemCount <= 0 || nextCartLength === 0;
}

export function isIncompleteOrderUpdatedPayload(itemCount: number, nextCartLength: number): boolean {
  return nextCartLength === 0 && itemCount > 0;
}

export function resolveIsNewStationOrder(
  orderId: string,
  nextStationLineCount: number,
  prevStationLineCount: number,
  seenServerOrderIds: Set<string>,
): boolean {
  const isServerOrderId = !!orderId && !orderId.startsWith('local-');
  return (
    isServerOrderId &&
    !seenServerOrderIds.has(orderId) &&
    nextStationLineCount > 0 &&
    prevStationLineCount === 0
  );
}

export async function resolveBaselineCart(
  tableId: string,
  orderId: string,
  memorySnapshot: CartItem[] | undefined,
  loadRecord: (tableId: string) => Promise<{ orderId?: string; items?: CartItem[] } | null>,
): Promise<CartItem[]> {
  const memory = memorySnapshot ?? [];
  if (memory.length > 0) {
    return memory;
  }

  const record = await loadRecord(tableId);
  if (record?.orderId === orderId && (record.items?.length ?? 0) > 0) {
    return record.items ?? [];
  }

  return [];
}
