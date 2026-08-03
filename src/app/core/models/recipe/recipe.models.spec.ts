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
    // markup 5% on cost: 1.5 × 1.05 = 1.575 → rounded to 1.58
    expect(suggestedPriceFromMargin(1.5, 5)).toBeCloseTo(1.58, 2);
  });

  it('derives unit cost from stock purchase total (20 lei / 10 kg)', () => {
    expect(unitCostFromStockPurchaseTotal(20, 10)).toBeCloseTo(2, 6);
    const qty = effectiveQtyInStockUom(100, 0, 1, null); // 100g → 0.1kg
    const cashCost = qty * unitCostFromStockPurchaseTotal(20, 10);
    expect(cashCost).toBeCloseTo(0.2, 6);
    // markup 10% on Cost Total when VAT-inclusive (Cost Total = cash 0.2)
    expect(suggestedPriceFromMargin(0.2, 10)).toBeCloseTo(0.22, 6);
    // markup 10% on Cost Total when VAT-exclusive (0.2 × 1.19 = 0.238) → 0.2618 → 0.26
    expect(suggestedPriceFromMargin(0.238, 10)).toBeCloseTo(0.26, 2);
  });

  it('round-trips purchase total from unit cost', () => {
    expect(stockPurchaseTotalFromUnitCost(2, 10)).toBeCloseTo(20, 6);
  });
});
