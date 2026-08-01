import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  IngredientConsumptionRow,
  IngredientDto,
  ExpiringIngredientDto,
  InventoryAlertSettingsDto,
  LowStockIngredientDto,
  MenuItemPortionsDto,
  RecipeDto,
  RecipeLineInput,
  StockMovementDto,
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
      unitCostAmount: number;
      initialStockQty: number;
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
      unitCostAmount: number;
      currentStockQty: number;
      isActive: boolean;
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
}
