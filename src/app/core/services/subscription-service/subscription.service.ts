import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, map, of, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { ProductLimitModel, SubscriptionProductModel } from '../../models/subscription-product';
import { PendingPlanModel } from '../../models/pendingPlanModel';
import { SubscriptionPayloadModel } from '../../models/subscriptionPayloadModel';
import { CreateSubscriptionProductModel } from '../../models/subscription-product';
import { environment } from '../../../../environments/environment';
import {
  CancelSubscriptionResultModel,
  ManagerSubscriptionStatusModel,
} from '../../models/manager-subscription-status.model';
import { SubscriptionMarket } from '../../i18n/subscription-market.config';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private apiUrl = environment.apiUrl;
  private pendingPlan: PendingPlanModel | null = null;
  private products$ = new BehaviorSubject<SubscriptionProductModel[]>([]);

  constructor(private http: HttpClient) { }

  getProductsLimits(): Observable<ProductLimitModel[]> {
    return this.http.get<ProductLimitModel[]>(`${this.apiUrl}/api/user/restaurant-limits`).pipe(
      catchError(err => {
        console.error('Failed to load subscription product limits', err);
        return of([]);
      }),
    );
  }

  loadProducts(market: SubscriptionMarket): void {
    this.getProducts(market).subscribe({
      next: products => this.products$.next(products),
      error: err => console.error('Failed to load subscription products', err),
    });
  }

  /** Expose products as observable for a specific market. */
  getProducts(market: SubscriptionMarket): Observable<SubscriptionProductModel[]> {
    return this.http.get<SubscriptionProductModel[] | { products?: SubscriptionProductModel[] }>(
      `${this.apiUrl}/api/stripe/subscription`,
      { params: { market } },
    ).pipe(
      map(raw => this.normalizeProductsResponse(raw)),
      catchError(err => {
        console.error('Failed to load subscription products', err);
        return of([]);
      }),
    );
  }

  /** Global admin: all markets, no filter. */
  getAllProductsForAdmin(): Observable<SubscriptionProductModel[]> {
    return this.http.get<SubscriptionProductModel[]>(
      `${this.apiUrl}/api/restaurants/subscription-products`,
      { withCredentials: true },
    ).pipe(
      map(raw => this.normalizeProductsResponse(raw)),
      catchError(err => {
        console.error('Failed to load admin subscription products', err);
        return of([]);
      }),
    );
  }

  private normalizeProductsResponse(
    raw: SubscriptionProductModel[] | { products?: SubscriptionProductModel[] } | null | undefined,
  ): SubscriptionProductModel[] {
    if (Array.isArray(raw)) {
      return raw.map(p => this.normalizeProduct(p));
    }
    if (raw && Array.isArray(raw.products)) {
      return raw.products.map(p => this.normalizeProduct(p));
    }
    return [];
  }

  private normalizeProduct(raw: SubscriptionProductModel): SubscriptionProductModel {
    return {
      ...raw,
      market: (raw.market ?? '').toUpperCase(),
      restaurantType: (raw.restaurantType ?? '').toLowerCase(),
      subscriptionInterval: raw.subscriptionInterval ?? 'month',
    };
  }

  createProduct(payload: CreateSubscriptionProductModel): Observable<CreateSubscriptionProductModel> {
    return this.http.post<CreateSubscriptionProductModel>(`${this.apiUrl}/api/restaurants/create-subscription-product`, payload, { withCredentials: true });
  }

  updateProduct(payload: CreateSubscriptionProductModel & { productPriceId: string }): Observable<{ productId: string; priceId: string }> {
    return this.http.put<{ productId: string; priceId: string }>(
      `${this.apiUrl}/api/restaurants/update-subscription-product`,
      payload,
      { withCredentials: true }
    );
  }

  deleteProduct(productPriceId: string): Observable<{ isDeleted: boolean; productPriceId: string }> {
    return this.http.delete<{ isDeleted: boolean; productPriceId: string }>(
      `${this.apiUrl}/api/restaurants/subscription-products/${productPriceId}`,
      { withCredentials: true },
    );
  }

  /** Store a pending plan (when user not logged in yet) */
  setPendingPlan(plan: PendingPlanModel): void {
    this.pendingPlan = plan;
    sessionStorage.setItem('pendingPlan', JSON.stringify(plan));
  }

  /** Retrieve pending plan after login */
  getPendingPlan(): PendingPlanModel | null {
    if (!this.pendingPlan) {
      const stored = sessionStorage.getItem('pendingPlan');
      if (stored) {
        this.pendingPlan = JSON.parse(stored);
      }
    }
    return this.pendingPlan;
  }

  /** Clear pending plan */
  clearPendingPlan(): void {
    this.pendingPlan = null;
    sessionStorage.removeItem('pendingPlan');
  }

  private static readonly pendingRestaurantCurrencyKey = 'pendingRestaurantCurrency';

  setPendingRestaurantCurrency(isoCode: string): void {
    sessionStorage.setItem(SubscriptionService.pendingRestaurantCurrencyKey, isoCode);
  }

  getPendingRestaurantCurrency(): string | null {
    return sessionStorage.getItem(SubscriptionService.pendingRestaurantCurrencyKey);
  }

  clearPendingRestaurantCurrency(): void {
    sessionStorage.removeItem(SubscriptionService.pendingRestaurantCurrencyKey);
  }

  subscribeToPlan(payload: SubscriptionPayloadModel): Observable<{ checkoutUrl: string }> {
    return this.http.post<{ checkoutUrl: string }>(`${this.apiUrl}/api/stripe/subscription`,
      payload, { withCredentials: true });
  }

  /** Provision restaurant when Stripe webhook did not reach the API (dev LAN / missed webhook). */
  completeSubscriptionCheckout(sessionId: string): Observable<{
    isProvisioned: boolean;
    role?: string;
    restaurantId?: string;
    message?: string;
  }> {
    return this.http.post<{
      isProvisioned: boolean;
      role?: string;
      restaurantId?: string;
      message?: string;
    }>(
      `${this.apiUrl}/api/stripe/subscription/complete`,
      {},
      { params: { session_id: sessionId }, withCredentials: true },
    );
  }

  /** Current manager subscription / cancellation state from MyCustomers. */
  getManagerSubscriptionStatus(): Observable<ManagerSubscriptionStatusModel> {
    return this.http
      .get<Record<string, unknown>>(`${this.apiUrl}/api/stripe/subscription/status`, {
        withCredentials: true,
      })
      .pipe(
        map(raw => this.normalizeManagerSubscriptionStatus(raw)),
        catchError(err => {
          const status = (err as { status?: number })?.status;
          if (status === 401 || status === 403) {
            return of({
              subscriptionStatus: null,
              cancelAtPeriodEnd: false,
              cancelAtUtc: null,
            } satisfies ManagerSubscriptionStatusModel);
          }
          return throwError(() => err);
        }),
      );
  }

  /** Cancel Stripe subscription for the logged-in manager (server loads IDs from DB). */
  cancelSubscription(): Observable<CancelSubscriptionResultModel> {
    return this.http
      .request('DELETE', `${this.apiUrl}/api/stripe/subscription`, {
        body: {},
        withCredentials: true,
        observe: 'response',
        responseType: 'text',
      })
      .pipe(
        switchMap((response: HttpResponse<string>) => {
          if (response.status < 200 || response.status >= 300) {
            return throwError(() => response);
          }
          return this.mapCancelSubscriptionResponse(response.body ?? '');
        }),
      );
  }

  private mapCancelSubscriptionResponse(body: string): Observable<CancelSubscriptionResultModel> {
    const trimmed = body.trim();
    if (!trimmed) {
      return this.cancelResultFromStatusOrFallback();
    }
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      return of(this.normalizeCancelSubscriptionResult(raw));
    } catch {
      // Legacy API: Ok("Subscription cancelled.") — plain text, not JSON.
      if (!/cancel/i.test(trimmed)) {
        return throwError(() => new Error(trimmed));
      }
      return this.cancelResultFromStatusOrFallback();
    }
  }

  private cancelResultFromStatusOrFallback(): Observable<CancelSubscriptionResultModel> {
    return this.getManagerSubscriptionStatus().pipe(
      map(status => ({
        isCancelled: true,
        cancelAtPeriodEnd: status.cancelAtPeriodEnd || true,
        cancelAtUtc: status.cancelAtUtc,
        subscriptionStatus: status.subscriptionStatus,
      })),
      catchError(() =>
        of({
          isCancelled: true,
          cancelAtPeriodEnd: true,
          cancelAtUtc: null,
          subscriptionStatus: 'active',
        }),
      ),
    );
  }

  private normalizeManagerSubscriptionStatus(
    raw: Record<string, unknown>,
  ): ManagerSubscriptionStatusModel {
    const cancelAtUtcRaw = raw['cancelAtUtc'] ?? raw['CancelAtUtc'];
    return {
      subscriptionStatus: (raw['subscriptionStatus'] ?? raw['SubscriptionStatus'] ?? null) as string | null,
      cancelAtPeriodEnd: Boolean(raw['cancelAtPeriodEnd'] ?? raw['CancelAtPeriodEnd']),
      cancelAtUtc: cancelAtUtcRaw != null && cancelAtUtcRaw !== '' ? String(cancelAtUtcRaw) : null,
    };
  }

  private normalizeCancelSubscriptionResult(
    raw: Record<string, unknown>,
  ): CancelSubscriptionResultModel {
    const status = this.normalizeManagerSubscriptionStatus(raw);
    return {
      isCancelled: Boolean(raw['isCancelled'] ?? raw['IsCancelled'] ?? true),
      cancelAtPeriodEnd: status.cancelAtPeriodEnd,
      cancelAtUtc: status.cancelAtUtc,
      subscriptionStatus: status.subscriptionStatus,
    };
  }
}
