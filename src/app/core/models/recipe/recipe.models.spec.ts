import {
  canConvertUom,
  convertUomQuantity,
  effectiveQtyInStockUom,
  stockPurchaseTotalFromUnitCost,
  suggestedPriceFromMargin,
  unitCostFromStockPurchaseTotal,
} from './recipe.models';

describe('recipe UOM conversion', () => {
  it('converts g to kg', () => {
    expect(convertUomQuantity(150, 0, 1)).toBeCloseTo(0.15, 6);
  });

  it('converts kg to g', () => {
    expect(convertUomQuantity(10, 1, 0)).toBeCloseTo(10000, 6);
  });

  it('rejects incompatible UOMs', () => {
    expect(canConvertUom(0, 2)).toBeFalse();
    expect(() => convertUomQuantity(1, 0, 2)).toThrow();
  });

  it('computes portion cost qty for 150g priced per kg', () => {
    const qty = effectiveQtyInStockUom(150, 0, 1, null);
    expect(qty).toBeCloseTo(0.15, 6);
    expect(qty * 10).toBeCloseTo(1.5, 6);
    expect(suggestedPriceFromMargin(1.5, 5)).toBeCloseTo(1.5789, 3);
  });

  it('derives unit cost from stock purchase total (20 lei / 10 kg)', () => {
    expect(unitCostFromStockPurchaseTotal(20, 10)).toBeCloseTo(2, 6);
    const qty = effectiveQtyInStockUom(100, 0, 1, null); // 100g → 0.1kg
    expect(qty * unitCostFromStockPurchaseTotal(20, 10)).toBeCloseTo(0.2, 6);
  });

  it('round-trips purchase total from unit cost', () => {
    expect(stockPurchaseTotalFromUnitCost(2, 10)).toBeCloseTo(20, 6);
  });
});
