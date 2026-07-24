import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type FiscalReceiptPdfApiScope = 'public' | 'staff' | 'admin';

export interface FiscalReceiptPdfStatus {
  available: boolean;
  orderId: string | null;
  fiscalDocumentId: string | null;
  documentType: string | null;
  status: string | null;
}

export interface EmailFiscalReceiptPdfResult {
  sent: boolean;
  message?: string | null;
}

function normalizeStatus(raw: unknown): FiscalReceiptPdfStatus {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nullableString = (value: unknown): string | null => {
    if (value == null) {
      return null;
    }
    const text = String(value).trim();
    return text || null;
  };

  return {
    available: Boolean(record['available'] ?? record['Available']),
    orderId: nullableString(record['orderId'] ?? record['OrderId']),
    fiscalDocumentId: nullableString(record['fiscalDocumentId'] ?? record['FiscalDocumentId']),
    documentType: nullableString(record['documentType'] ?? record['DocumentType']),
    status: nullableString(record['status'] ?? record['Status']),
  };
}

function normalizeEmailResult(raw: unknown): EmailFiscalReceiptPdfResult {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    sent: Boolean(record['sent'] ?? record['Sent']),
    message: record['message'] != null || record['Message'] != null
      ? String(record['message'] ?? record['Message'])
      : null,
  };
}

@Injectable({ providedIn: 'root' })
export class FiscalReceiptPdfService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  getStatus(
    restaurantId: string,
    orderId: string,
    apiScope: FiscalReceiptPdfApiScope,
    fiscalDocumentId?: string | null,
  ): Observable<FiscalReceiptPdfStatus> {
    let params = new HttpParams();
    if (fiscalDocumentId) {
      params = params.set('fiscalDocumentId', fiscalDocumentId);
    }

    return this.http.get<unknown>(
      `${this.orderBase(restaurantId, orderId, apiScope)}/fiscal-receipt-pdf/status`,
      { params, withCredentials: true },
    ).pipe(map(normalizeStatus));
  }

  downloadPdf(
    restaurantId: string,
    orderId: string,
    apiScope: FiscalReceiptPdfApiScope,
    fiscalDocumentId?: string | null,
  ): Observable<Blob> {
    let params = new HttpParams();
    if (fiscalDocumentId) {
      params = params.set('fiscalDocumentId', fiscalDocumentId);
    }

    return this.http.get(
      `${this.orderBase(restaurantId, orderId, apiScope)}/fiscal-receipt-pdf`,
      { params, responseType: 'blob', withCredentials: true },
    );
  }

  emailPdf(
    restaurantId: string,
    orderId: string,
    email: string,
    apiScope: FiscalReceiptPdfApiScope,
    fiscalDocumentId?: string | null,
  ): Observable<EmailFiscalReceiptPdfResult> {
    return this.http.post<unknown>(
      `${this.orderBase(restaurantId, orderId, apiScope)}/fiscal-receipt-pdf/email`,
      {
        email: email.trim(),
        fiscalDocumentId: fiscalDocumentId ?? null,
      },
      { withCredentials: true },
    ).pipe(map(normalizeEmailResult));
  }

  private orderBase(restaurantId: string, orderId: string, apiScope: FiscalReceiptPdfApiScope): string {
    if (apiScope === 'public') {
      return `${this.apiUrl}/api/public/${restaurantId}/orders/${orderId}`;
    }
    return `${this.apiUrl}/api/restaurants/${restaurantId}/${apiScope}/orders/${orderId}`;
  }
}

export function isIssuedFiscalDocumentStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'issued' || normalized === 'success';
}
