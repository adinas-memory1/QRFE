import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  IngredientConsumptionRow,
  IngredientDto,
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
    let params = new HttpParams();
    for (const id of menuItemIds ?? []) {
      params = params.append('menuItemIds', id);
    }
    return this.http.get<MenuItemPortionsDto[]>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/recipes/portions-remaining`,
      { params, withCredentials: true },
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
}
