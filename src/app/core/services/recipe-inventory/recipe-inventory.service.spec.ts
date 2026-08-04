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
          ingredientId: 'i1',
          name: 'Faina',
          unitOfMeasure: 0,
          quantity: 150,
        },
      ])
      .subscribe();
    expect(http.put).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/recipes/m1`,
      {
        lines: [
          {
            ingredientId: 'i1',
            name: 'Faina',
            unitOfMeasure: 0,
            quantity: 150,
          },
        ],
      },
      { withCredentials: true },
    );
  });

  it('updates ingredient catalog fields', () => {
    http.put.and.returnValue(of({ ingredientId: 'i1' }));
    service
      .updateIngredient('r1', 'i1', {
        name: 'faina',
        unitOfMeasure: 0,
        isActive: true,
        allergens: ['gluten'],
        yieldPercent: 90,
      })
      .subscribe();
    expect(http.put).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/ingredients/i1`,
      jasmine.objectContaining({ isActive: true, yieldPercent: 90 }),
      { withCredentials: true },
    );
  });

  it('deactivates ingredient via DELETE', () => {
    http.delete.and.returnValue(of(void 0));
    service.deactivateIngredient('r1', 'i1').subscribe();
    expect(http.delete).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/ingredients/i1`,
      { withCredentials: true },
    );
  });

  it('posts stock receipt', () => {
    http.post.and.returnValue(of({ ingredientId: 'i1' }));
    service
      .receiveStock('r1', 'i1', { quantity: 10, unitPrice: 5, vatPercent: 19 })
      .subscribe();
    expect(http.post).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/ingredients/i1/receipts`,
      jasmine.objectContaining({ quantity: 10, unitPrice: 5 }),
      { withCredentials: true },
    );
  });

  it('creates multi-line NIR stock receipt', () => {
    http.post.and.returnValue(of({ stockReceiptId: 'sr1', documentNumber: 'NIR-2026-0001' }));
    service
      .createStockReceipt('r1', {
        supplier: 'Metro',
        invoiceNumber: 'F-99',
        receivedOn: '2026-08-02',
        lines: [
          { ingredientId: 'i1', quantity: 10, unitPrice: 5, vatPercent: 19, lotNumber: 'LOT-1' },
          { ingredientId: 'i2', quantity: 2, totalPrice: 40, vatPercent: 19 },
        ],
      })
      .subscribe();
    expect(http.post).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/stock-receipts`,
      jasmine.objectContaining({
        supplier: 'Metro',
        invoiceNumber: 'F-99',
        lines: jasmine.any(Array),
      }),
      { withCredentials: true },
    );
  });

  it('gets stock receipt by id', () => {
    http.get.and.returnValue(of({ stockReceiptId: 'sr1', documentNumber: 'NIR-2026-0001', lines: [] }));
    service.getStockReceipt('r1', 'sr1').subscribe();
    expect(http.get).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/stock-receipts/sr1`,
      { withCredentials: true },
    );
  });

  it('updates stock receipt lot metadata', () => {
    http.post.and.returnValue(of({ stockReceiptId: 'sr1', documentNumber: 'NIR-2026-0001' }));
    service
      .updateStockReceipt('r1', 'sr1', {
        supplier: 'Metro',
        lines: [{ stockReceiptLineId: 'l1', lotNumber: 'LOT-42' }],
      })
      .subscribe();
    expect(http.post).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/stock-receipts/sr1/update`,
      jasmine.objectContaining({
        lines: [{ stockReceiptLineId: 'l1', lotNumber: 'LOT-42' }],
      }),
      { withCredentials: true },
    );
  });

  it('lists stock receipts with take', () => {
    http.get.and.returnValue(of([]));
    service.listStockReceipts('r1', { take: 20 }).subscribe();
    expect(http.get).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/stock-receipts`,
      jasmine.objectContaining({
        withCredentials: true,
        params: jasmine.any(HttpParams),
      }),
    );
    const params = http.get.calls.mostRecent().args[1]?.params as HttpParams;
    expect(params.get('take')).toBe('20');
  });

  it('downloads stock receipt PDF as blob', () => {
    http.get.and.returnValue(of(new Blob(['pdf'])));
    service.downloadStockReceiptPdf('r1', 'sr1').subscribe();
    expect(http.get).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/stock-receipts/sr1/pdf`,
      jasmine.objectContaining({ responseType: 'blob', withCredentials: true }),
    );
  });

  it('lists low-stock ingredients', () => {
    http.get.and.returnValue(of([]));
    service.listLowStockIngredients('r1').subscribe();
    expect(http.get).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/reports/low-stock-ingredients`,
      { withCredentials: true },
    );
  });

  it('lists expiring ingredients with daysAhead', () => {
    http.get.and.returnValue(of([]));
    service.listExpiringIngredients('r1', 10).subscribe();
    expect(http.get).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/reports/expiring-ingredients`,
      jasmine.objectContaining({
        withCredentials: true,
        params: jasmine.any(HttpParams),
      }),
    );
    const params = http.get.calls.mostRecent().args[1]?.params as HttpParams;
    expect(params.get('daysAhead')).toBe('10');
  });

  it('posts portions-remaining with menuItemIds in body', () => {
    http.post.and.returnValue(of([]));
    service.getPortionsRemaining('r1', ['m1', 'm2']).subscribe();
    expect(http.post).toHaveBeenCalledWith(
      `${environment.apiUrl}/api/restaurants/r1/admin/recipes/portions-remaining`,
      { menuItemIds: ['m1', 'm2'] },
      { withCredentials: true },
    );
  });
});
