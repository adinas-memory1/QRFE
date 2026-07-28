/** Matches API camelCase JSON for SalesSummaryReportResponse. */
export interface SalesByCurrencyRow {
  currency: string;
  orderCount: number;
  totalAmount: number;
  totalSubTotal?: number;
  totalTaxAmount?: number;
}

export interface SalesSummaryReportResponse {
  orderCount: number;
  byCurrency: SalesByCurrencyRow[];
  totalSubTotal?: number;
  totalTaxAmount?: number;
}

/** Matches API camelCase JSON for TopProductRow. */
export interface TopProductRow {
  menuItemId: string;
  orderItemName: string;
  currency: string;
  totalQuantity: number;
  totalLineAmount: number;
}
