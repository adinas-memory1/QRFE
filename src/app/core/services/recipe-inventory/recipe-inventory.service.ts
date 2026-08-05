import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  IngredientConsumptionRow,
  IngredientDto,
  ExpiringIngredientDto,
  InventoryAlertSettingsDto,
  InventoryCostingMethod,
  InventorySettingsDto,
  LowStockIngredientDto,
  MenuItemPortionsDto,
  RecipeDto,
  RecipeLineInput,
  StockItemDto,
  StockMovementDto,
  StockReceiptDto,
  StockReceiptLineInput,
  StockReceiptLineUpdateInput,
  UnitOfMeasure,
} from '../../models/recipe/recipe.models';

@Injectable({ providedIn: 'root' })
export class RecipeInventoryService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  listIngredients(restaurantId: string, includeInactive = false): Observable<IngredientDto[]> {
    const params = new HttpParams().set('includeInactive', String(includeInactive));
    return this.http.get<IngredientDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients`,
      { params, withCredentials: true },
    );
  }

  createIngredient(
    restaurantId: string,
    body: {
      name: string;
      unitOfMeasure: UnitOfMeasure | number;
      allergens?: string[];
      yieldPercent?: number | null;
    },
  ): Observable<IngredientDto> {
    return this.http.post<IngredientDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients`,
      body,
      { withCredentials: true },
    );
  }

  updateIngredient(
    restaurantId: string,
    ingredientId: string,
    body: {
      name: string;
      unitOfMeasure: UnitOfMeasure | number;
      isActive: boolean;
      allergens?: string[];
      yieldPercent?: number | null;
    },
  ): Observable<IngredientDto> {
    return this.http.put<IngredientDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients/${ingredientId}`,
      body,
      { withCredentials: true },
    );
  }

  deactivateIngredient(restaurantId: string, ingredientId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients/${ingredientId}`,
      { withCredentials: true },
    );
  }

  listStockItems(restaurantId: string, ingredientId: string): Observable<StockItemDto[]> {
    return this.http.get<StockItemDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients/${ingredientId}/stock-items`,
      { withCredentials: true },
    );
  }

  searchStockItems(restaurantId: string, search?: string, take = 50): Observable<StockItemDto[]> {
    let params = new HttpParams().set('take', String(take));
    if (search?.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<StockItemDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-items`,
      { params, withCredentials: true },
    );
  }

  receiveStock(
    restaurantId: string,
    ingredientId: string,
    body: {
      quantity: number;
      unitOfMeasure?: UnitOfMeasure | number | null;
      unitPrice?: number | null;
      totalPrice?: number | null;
      vatPercent?: number;
      vatInclusive?: boolean;
      lotNumber?: string | null;
      supplier?: string | null;
      purchaseDate?: string | null;
      expiryDate?: string | null;
      note?: string | null;
    },
  ): Observable<IngredientDto> {
    return this.http.post<IngredientDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients/${ingredientId}/receipts`,
      body,
      { withCredentials: true },
    );
  }

  adjustStock(
    restaurantId: string,
    ingredientId: string,
    body: { quantityDelta: number; note?: string },
  ): Observable<IngredientDto> {
    return this.http.post<IngredientDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients/${ingredientId}/stock-adjust`,
      body,
      { withCredentials: true },
    );
  }

  listStockMovements(
    restaurantId: string,
    ingredientId: string,
    take = 50,
  ): Observable<StockMovementDto[]> {
    const params = new HttpParams().set('take', String(take));
    return this.http.get<StockMovementDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/ingredients/${ingredientId}/stock-movements`,
      { params, withCredentials: true },
    );
  }

  getRecipe(restaurantId: string, menuItemId: string): Observable<RecipeDto> {
    return this.http.get<RecipeDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/recipes/${menuItemId}`,
      { withCredentials: true },
    );
  }

  upsertRecipe(
    restaurantId: string,
    menuItemId: string,
    lines: RecipeLineInput[],
  ): Observable<RecipeDto> {
    return this.http.put<RecipeDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/recipes/${menuItemId}`,
      { lines },
      { withCredentials: true },
    );
  }

  deleteRecipe(restaurantId: string, menuItemId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/recipes/${menuItemId}`,
      { withCredentials: true },
    );
  }

  getPortionsRemaining(
    restaurantId: string,
    menuItemIds?: string[],
  ): Observable<MenuItemPortionsDto[]> {
    return this.http.post<MenuItemPortionsDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/recipes/portions-remaining`,
      { menuItemIds: menuItemIds ?? [] },
      { withCredentials: true },
    );
  }

  getConsumptionReport(
    restaurantId: string,
    startDate: string,
    endDate: string,
  ): Observable<IngredientConsumptionRow[]> {
    const params = new HttpParams().set('startDate', startDate).set('endDate', endDate);
    return this.http.get<IngredientConsumptionRow[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/reports/ingredient-consumption`,
      { params, withCredentials: true },
    );
  }

  listLowStockIngredients(restaurantId: string): Observable<LowStockIngredientDto[]> {
    return this.http.get<LowStockIngredientDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/reports/low-stock-ingredients`,
      { withCredentials: true },
    );
  }

  listExpiringIngredients(restaurantId: string, daysAhead?: number): Observable<ExpiringIngredientDto[]> {
    let params = new HttpParams();
    if (daysAhead != null) {
      params = params.set('daysAhead', String(daysAhead));
    }
    return this.http.get<ExpiringIngredientDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/reports/expiring-ingredients`,
      { params, withCredentials: true },
    );
  }

  getInventoryAlertSettings(restaurantId: string): Observable<InventoryAlertSettingsDto> {
    return this.http.get<InventoryAlertSettingsDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/inventory-alert-settings`,
      { withCredentials: true },
    );
  }

  updateInventoryAlertSettings(
    restaurantId: string,
    body: {
      lowStockAlertPercent: number | null;
      lowStockAlertEmail: string | null;
      expiryAlertDaysAhead: number;
      expiryAlertEmail: string | null;
    },
  ): Observable<InventoryAlertSettingsDto> {
    return this.http.put<InventoryAlertSettingsDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/inventory-alert-settings`,
      body,
      { withCredentials: true },
    );
  }

  getInventorySettings(restaurantId: string): Observable<InventorySettingsDto> {
    return this.http.get<InventorySettingsDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/inventory-settings`,
      { withCredentials: true },
    );
  }

  updateInventorySettings(
    restaurantId: string,
    body: { inventoryCostingMethod: InventoryCostingMethod | number },
  ): Observable<InventorySettingsDto> {
    return this.http.put<InventorySettingsDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/inventory-settings`,
      body,
      { withCredentials: true },
    );
  }

  createStockReceipt(
    restaurantId: string,
    body: {
      supplier?: string | null;
      receivedOn?: string | null;
      note?: string | null;
      documentNumber?: string | null;
      invoiceNumber?: string | null;
      lines: StockReceiptLineInput[];
    },
  ): Observable<StockReceiptDto> {
    return this.http.post<StockReceiptDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-receipts`,
      body,
      { withCredentials: true },
    );
  }

  getStockReceipt(restaurantId: string, stockReceiptId: string): Observable<StockReceiptDto> {
    return this.http.get<StockReceiptDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-receipts/${stockReceiptId}`,
      { withCredentials: true },
    );
  }

  updateStockReceipt(
    restaurantId: string,
    stockReceiptId: string,
    body: {
      supplier?: string | null;
      receivedOn?: string | null;
      note?: string | null;
      invoiceNumber?: string | null;
      lines: StockReceiptLineUpdateInput[];
    },
  ): Observable<StockReceiptDto> {
    return this.http.post<StockReceiptDto>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-receipts/${stockReceiptId}/update`,
      body,
      { withCredentials: true },
    );
  }

  deleteStockReceipt(restaurantId: string, stockReceiptId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-receipts/${stockReceiptId}`,
      { withCredentials: true },
    );
  }

  listStockReceipts(
    restaurantId: string,
    opts?: { from?: string; to?: string; take?: number },
  ): Observable<StockReceiptDto[]> {
    let params = new HttpParams();
    if (opts?.from) params = params.set('from', opts.from);
    if (opts?.to) params = params.set('to', opts.to);
    if (opts?.take != null) params = params.set('take', String(opts.take));
    return this.http.get<StockReceiptDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-receipts`,
      { params, withCredentials: true },
    );
  }

  downloadStockReceiptPdf(restaurantId: string, stockReceiptId: string): Observable<Blob> {
    return this.http.get(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/stock-receipts/${stockReceiptId}/pdf`,
      { responseType: 'blob', withCredentials: true },
    );
  }
}
