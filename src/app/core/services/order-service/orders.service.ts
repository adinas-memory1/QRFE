import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { firstValueFrom, Observable } from 'rxjs';
import {
  AddOrderItemResponse,
  CartItem,
  InitAddOrderResponse,
  OrderDTO,
  OrderUpdatedSSEPayload,
  readMoneyAmount,
  readMoneyCurrency,
  TableComputedDTO,
  UpdateOrderItemQuantityResponse,
} from '../../models/orderingModel';
import { TaxCalculationResult } from '../../models/tax-calculation.model';
import { MenuItem } from '../../models/menu/menuItem';
import { TableDTO } from '../../models/restaurantTablesModel';
import { WaiterCallState } from '../../models/callWaiter/callWaiter';
import { MiscellaneousService } from '../misc/miscellaneous.service';
import { OfflineDbService } from '../../offline/offline-db';
import { OnlineStateService } from '../../offline/online-state-service';
import { PlatformStorageService } from '../../platform/platform-storage.service';
import { SKIP_HTTP_ERROR_TOAST } from '../../interceptors/logging.interceptor';

export interface OrderRequestOptions {
  suppressErrorToast?: boolean;
}



@Injectable({
  providedIn: 'root'
})
export class OrdersService {
  private apiUrl = environment.apiUrl;
  private readonly initiatedByMapKey = 'tableInitiatedByMap';
  private initiatedByCache: Record<string, string> = {};
  private initiatedByCacheReady: Promise<void>;

  constructor(private http: HttpClient,
    private miscService: MiscellaneousService,
    private offlineDB: OfflineDbService,
    private onlineStateService: OnlineStateService,
    private platformStorage: PlatformStorageService) {
    this.initiatedByCacheReady = this.hydrateInitiatedByCache();
  }

  /** Wait for Preferences/local initiatedBy map before first UI hydrate (cold install). */
  ensureInitiatedByCacheReady(): Promise<void> {
    return this.initiatedByCacheReady;
  }

  private async hydrateInitiatedByCache(): Promise<void> {
    const raw = await this.platformStorage.getString(this.initiatedByMapKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        this.initiatedByCache = { ...this.initiatedByCache, ...parsed };
      }
    } catch {
      // ignore corrupt cache
    }
  }




  // ------------------------------
  // HTTP METHODS (OBSERVABLES)
  // ------------------------------

  private httpOpts(options?: OrderRequestOptions) {
    const base = { withCredentials: true as const };
    if (options?.suppressErrorToast) {
      return { ...base, context: new HttpContext().set(SKIP_HTTP_ERROR_TOAST, true) };
    }
    return base;
  }

  newOrder(
    restaurantId: string,
    tableId: string,
    seatId?: string,
    options?: OrderRequestOptions,
  ): Observable<{ order: OrderDTO }> {
    return this.http.post<{ order: OrderDTO }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/tables/${tableId}/new-order`,
      {},
      this.httpOpts(options),
    );
  }

  listOpenOrderForTable(restaurantId: string, tableId: string): Observable<OrderDTO> {
    return this.http.get<OrderDTO>(`${this.apiUrl}/api/restaurants/${restaurantId}/staff/tables/${tableId}/list-open-order`, { withCredentials: true });
  }

  claimPickupTarget(restaurantId: string, tableId: string): Observable<void> {
    const url = `${this.apiUrl}/api/restaurants/${restaurantId}/staff/tables/${tableId}/claim-pickup-target`;
    return this.http.post<void>(url, {}, { withCredentials: true });
  }

  //confirm order
  updateOrderItem(
    restaurantId: string,
    tableId: string,
    orderId: string,
    body: { orderItems: { menuItemId: string; quantity: number }[]; seatId: string | null },
    options?: OrderRequestOptions,
  ): Observable<InitAddOrderResponse> {
    return this.http.put<InitAddOrderResponse>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${orderId}/init-add-order-items`,
      body,
      this.httpOpts(options),
    );
  }

  deleteOrderItem(
    restaurantId: string,
    tableId: string,
    orderId: string,
    orderItemId: string,
    options?: OrderRequestOptions,
  ): Observable<OrderDTO> {
    return this.http.delete<OrderDTO>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${orderId}/${orderItemId}/delete-order-item`,
      this.httpOpts(options),
    );
  }

  closeOrder(
    restaurantId: string,
    tableId: string,
    orderId: string,
    options?: OrderRequestOptions,
    paymentMethod = 'cash',
  ): Observable<OrderDTO> {
    return this.http.post<OrderDTO>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${orderId}/close-order?paymentMethod=${encodeURIComponent(paymentMethod)}`,
      {},
      this.httpOpts(options),
    );
  }

  calculateOrderTax(
    restaurantId: string,
    tableId: string,
    orderId: string,
  ): Observable<TaxCalculationResult> {
    return this.http.post<TaxCalculationResult>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${orderId}/calculate-tax`,
      {},
      { withCredentials: true },
    );
  }

  getOrderPaymentLock(restaurantId: string, orderId: string): Observable<{ locked: boolean }> {
    return this.http.get<{ locked: boolean }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/orders/${orderId}/payment-lock`,
      { withCredentials: true },
    );
  }

  forceUnlockOrderPayment(restaurantId: string, orderId: string): Observable<{ unlocked: boolean }> {
    return this.http.post<{ unlocked: boolean }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/orders/${orderId}/payment-unlock`,
      {},
      { withCredentials: true },
    );
  }

  listTablesStatus(restaurantId: string): Observable<OrderDTO[]> {
    return this.http.get<OrderDTO[]>(`${this.apiUrl}/api/restaurants/${restaurantId}/staff/tables/get-tables-status`, { withCredentials: true });
  }

  listOrdersForTableByDate(
    restaurantId: string,
    tableId: string,
    startDate: string,
    endDate: string,
    apiScope: 'staff' | 'admin' = 'staff',
  ): Observable<OrderDTO[]> {
    return this.http.post<OrderDTO[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/${apiScope}/tables/${tableId}/orders/filter-by-date`,
      { startDate, endDate },
      { withCredentials: true },
    );
  }

  // new methods
  addOrderItem(
    restaurantId: string,
    tableId: string,
    currentOrderId: string,
    menuItemId: string,
    quantity: number,
    options?: OrderRequestOptions,
  ): Observable<AddOrderItemResponse> {
    return this.http.post<AddOrderItemResponse>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${currentOrderId}/add-order-item`,
      { menuItemId, quantity },
      this.httpOpts(options),
    );
  }

  updateOrderItemQuantity(
    restaurantId: string,
    tableId: string,
    currentOrderId: string,
    orderItemId: string,
    quantity: number,
    options?: OrderRequestOptions,
  ): Observable<UpdateOrderItemQuantityResponse> {
    return this.http.put<UpdateOrderItemQuantityResponse>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${currentOrderId}/items/${orderItemId}/update-order-item-qty`,
      { quantity },
      this.httpOpts(options),
    );
  }

  closeOrderAfterPayment(restaurantId: string, tableId: string, orderId: string): Observable<OrderDTO> {
    return this.http.post<OrderDTO>(`${this.apiUrl}/api/restaurants/${restaurantId}/staff/${tableId}/orders/${orderId}/close`, {}, { withCredentials: true });
  }

  saveComputed(tableComputed: Record<string, any>): void {
    try {
      localStorage.setItem('tableComputed', JSON.stringify(tableComputed));
    } catch (e) {
      console.error('Failed to save tableComputed', e);
    }
  }

  loadComputed(): Record<string, any> {
    try {
      const saved = localStorage.getItem('tableComputed');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error('Failed to load tableComputed', e);
      return {};
    }
  }

  /** Dedicated store for "updated by" — survives tableComputed overwrites on re-entry. */
  loadInitiatedByMap(): Record<string, string> {
    try {
      const raw = localStorage.getItem(this.initiatedByMapKey);
      const fromLocal = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      const localMap = fromLocal && typeof fromLocal === 'object' ? fromLocal : {};
      return { ...localMap, ...this.initiatedByCache };
    } catch (e) {
      console.error('Failed to load tableInitiatedByMap', e);
      return { ...this.initiatedByCache };
    }
  }

  saveInitiatedByMap(map: Record<string, string>): void {
    try {
      const cleaned: Record<string, string> = {};
      for (const [tableId, by] of Object.entries(map)) {
        const v = by?.trim();
        if (tableId && v) cleaned[tableId] = v;
      }
      localStorage.setItem(this.initiatedByMapKey, JSON.stringify(cleaned));
      this.initiatedByCache = cleaned;
      void this.platformStorage.setString(this.initiatedByMapKey, JSON.stringify(cleaned));
    } catch (e) {
      console.error('Failed to save tableInitiatedByMap', e);
    }
  }

  clearInitiatedByCache(): void {
    this.initiatedByCache = {};
    try {
      localStorage.removeItem(this.initiatedByMapKey);
    } catch {
      // ignore
    }
    void this.platformStorage.setString(this.initiatedByMapKey, '{}');
  }

  mapPayloadToComputed(
    payload: OrderUpdatedSSEPayload,
    tables: TableDTO[],
    waiterState: Record<string, WaiterCallState>,
    initiatedBy?: string
  ) {    
    const table = tables.find(t => t.tableId === payload.TableId);    
    const amount = readMoneyAmount(payload.SubTotal) ?? 0;
    const currency = readMoneyCurrency(payload.SubTotal);
    return {
      lastActionAt: payload.LastActionAt,
      lastAddedItem: payload.LastAddedItem ?? '—',
      total: amount,
      currency,
      itemCount: payload.ItemCount ?? 0,
      cssClass: this.miscService.getTableCss(table!, waiterState),
      initiatedBy: initiatedBy ?? 'system'
    };
  }

  mapComputedDtoToComputed(
    dto: TableComputedDTO,
    tables: TableDTO[],
    waiterState: Record<string, WaiterCallState>,
    initiatedBy?: string
  ) {    
    const table = tables.find(t => t.tableId === dto.tableId);
    const subTotal = (dto as { subTotal?: unknown; SubTotal?: unknown }).subTotal
      ?? (dto as { SubTotal?: unknown }).SubTotal;

    return {
      lastActionAt: dto.lastActionAt ?? '',
      lastAddedItem: dto.lastAddedItem ?? '—',
      total: readMoneyAmount(subTotal) ?? 0,
      currency: readMoneyCurrency(subTotal),
      itemCount: dto.itemCount ?? 0,
      cssClass: this.miscService.getTableCss(table!, waiterState),
      initiatedBy: initiatedBy ?? ''
    };
  }


  async listOpenOrderForTableWithFallback(
    restaurantId: string,
    tableId: string
  ): Promise<OrderDTO | null> {

    const localOrder = await this.offlineDB.loadOrder(tableId);

    if (!this.onlineStateService.isOnline) {
      return localOrder;
    }

    try {
      const remoteOrder = await firstValueFrom(
        this.listOpenOrderForTable(restaurantId, tableId)
      );

      if (!remoteOrder || !remoteOrder.orderId) {
        return localOrder;
      }

      await this.offlineDB.saveOrderSnapshot(tableId, remoteOrder);
      return remoteOrder;

    } catch (err: any) {
      console.warn('Failed to fetch order from server, falling back to local. Error:', err);
      return localOrder;
    }
  }

  moveOrder(restaurantId: string, sourceTableId: string, targetTableId: string) {
    return this.http.post<{ orderId?: string, sourceTable?: TableDTO, targetTable?: TableDTO }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/tables/${sourceTableId}/move-cart`,
      { targetTableId },
      { withCredentials: true }
    );
  }


}
