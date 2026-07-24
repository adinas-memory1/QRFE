import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface OrderCheckoutCompletionResult {
  success: boolean;
  alreadyClosed: boolean;
  orderId?: string | null;
  message?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  completeOrderCheckout(sessionId: string, restaurantId: string): Observable<OrderCheckoutCompletionResult> {
    const params = new HttpParams()
      .set('session_id', sessionId)
      .set('restaurantId', restaurantId);

    return this.http.post<OrderCheckoutCompletionResult>(
      `${this.apiUrl}/api/payments/checkout-complete`,
      null,
      { params, withCredentials: true },
    );
  }
}
