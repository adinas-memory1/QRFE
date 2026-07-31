import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { of } from 'rxjs';
import { RecipeInventoryService } from './recipe-inventory.service';
import { environment } from '../../../../environments/environment';

describe('RecipeInventoryService', () => {
  let service: RecipeInventoryService;
  let http: jasmine.SpyObj<HttpClient>;

  beforeEach(() => {
    http = jasmine.createSpyObj('HttpClient', ['get', 'post', 'put', 'delete']);
    service = new RecipeInventoryService(http);
  });

  it('lists ingredients with includeInactive query', () => {
    http.get.and.returnValue(of([]));
    service.listIngredients('r1', true).subscribe();
    expect(http.get).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/ingredients`,
      jasmine.objectContaining({
        withCredentials: true,
        params: jasmine.any(HttpParams),
      }),
    );
    const params = http.get.calls.mostRecent().args[1]?.params as HttpParams;
    expect(params.get('includeInactive')).toBe('true');
  });

  it('upserts recipe lines', () => {
    http.put.and.returnValue(of({ menuItemId: 'm1', lines: [], portionCostAmount: 0 }));
    service
      .upsertRecipe('r1', 'm1', [
        {
          name: 'Faina',
          unitOfMeasure: 0,
          quantity: 150,
          unitCostAmount: 0.01,
          currentStockQty: 10000,
        },
      ])
      .subscribe();
    expect(http.put).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/recipes/m1`,
      {
        lines: [
          {
            name: 'Faina',
            unitOfMeasure: 0,
            quantity: 150,
            unitCostAmount: 0.01,
            currentStockQty: 10000,
          },
        ],
      },
      { withCredentials: true },
    );
  });

  it('updates ingredient including total stock', () => {
    http.put.and.returnValue(of({ ingredientId: 'i1' }));
    service
      .updateIngredient('r1', 'i1', {
        name: 'faina',
        unitOfMeasure: 0,
        unitCostAmount: 1,
        currentStockQty: 10000,
        isActive: true,
      })
      .subscribe();
    expect(http.put).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/ingredients/i1`,
      jasmine.objectContaining({ currentStockQty: 10000, unitCostAmount: 1 }),
      { withCredentials: true },
    );
  });
});
