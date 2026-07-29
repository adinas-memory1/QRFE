import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { VenueSizeConfigList } from '../../models/venueSizeConfigModel';
import { WaiterCallState } from '../../models/callWaiter/callWaiter';
import { TableDTO } from '../../models/restaurantTablesModel';

@Injectable({
  providedIn: 'root'
})
export class MiscellaneousService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getCurrencies(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/api/restaurants/currencies`);
  }

  getRestaurantLimits(): Observable<VenueSizeConfigList> {
    return this.http.get<VenueSizeConfigList>(`${this.apiUrl}/api/user/restaurant-limits`);
  }

  getLastActionTime(lastActionAt: string | null): string {
    if (!lastActionAt) return '—';

    const ts = new Date(lastActionAt).getTime();
    if (isNaN(ts) || ts < 946684800000) return '—'; // invalid or before year 2000

    const diffMs = Date.now() - ts;
    if (diffMs < 0) return 'now';

    const mins = Math.floor(diffMs / 60_000);
    if (mins === 0) return 'now';
    if (mins === 1) return '1 minute ago';
    if (mins < 60) return `${mins} minutes ago`;

    const hours = Math.floor(mins / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }


  getTableCss(table: TableDTO, waiterState: Record<string, WaiterCallState>): string {
    if (!table) return 'bg-secondary text-white';
    const direct = waiterState[table.tableId];
    if (direct === WaiterCallState.Active) return 'bg-warning text-dark';
    if (direct == null && table.tableId) {
      const lower = table.tableId.toLowerCase();
      for (const [key, state] of Object.entries(waiterState)) {
        if (key.toLowerCase() === lower && state === WaiterCallState.Active) {
          return 'bg-warning text-dark';
        }
      }
    }
    if (table.isTableOpen) return 'bg-success text-white';
    return 'bg-danger text-white';
  }

  parseApiError(err: any): { exception?: string, details?: string, errors?: any[] } {
    try {
      const body = err?.error ?? err;
      return {
        exception: body?.exception ?? body?.Exception,
        details: body?.details ?? body?.Details ?? (err?.message || 'Server error'),
        errors: body?.errors ?? body?.Errors
      };
    } catch {
      return { details: 'Unexpected server error' };
    }
  }

  /** User-facing message from API error body (e.g. GlobalExceptionHandler JSON) or network failure. */
  getFirstErrorMessage(err: unknown): string {
    const http = err as { status?: number; statusText?: string; message?: string; error?: unknown };
    if (http?.status === 0) {
      return 'Network error — check your connection or try again.';
    }
    const p = this.parseApiError(err);
    const list = p.errors;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0] as { message?: string; Message?: string };
      const msg = first?.message ?? first?.Message;
      if (msg && String(msg).trim()) {
        return String(msg).trim();
      }
    }
    if (p.details && typeof p.details === 'string' && p.details.trim() && p.details !== 'Server error') {
      return p.details.trim();
    }
    if (http?.status === 409) {
      return 'This action conflicts with the current state (e.g. email already registered).';
    }
    if (http?.status === 401 || http?.status === 403) {
      return 'You are not allowed to perform this action. Sign in again if needed.';
    }
    if (http?.status && http.status >= 500) {
      return 'Server error — please try again later.';
    }
    return 'Something went wrong. Please try again.';
  }

}
