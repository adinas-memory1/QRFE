export type UnitOfMeasure = 'G' | 'Kg' | 'Ml' | 'L' | 'Pcs' | 0 | 1 | 2 | 3 | 4;

export const INGREDIENT_ALLERGEN_CODES = [
  'gluten',
  'lactose',
  'egg',
  'fish',
  'crustaceans',
  'peanuts',
  'soy',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
] as const;

export type IngredientAllergenCode = (typeof INGREDIENT_ALLERGEN_CODES)[number];

/** Cmp = 0, Fifo = 1, Lifo = 2 */
export type InventoryCostingMethod = 'Cmp' | 'Fifo' | 'Lifo' | 0 | 1 | 2;

export interface IngredientDto {
  ingredientId: string;
  name: string;
  unitOfMeasure: UnitOfMeasure;
  unitCostAmount: number;
  weightedAverageUnitCost?: number;
  unitCostCurrency: string | number;
  currentStockQty: number;
  isActive: boolean;
  allergens?: string[];
  yieldPercent?: number | null;
  lowStockAlertPercent?: number | null;
  stockAlertBaselineQty?: number | null;
  isLowStock?: boolean;
  nearestExpiryDate?: string | null;
  isExpired?: boolean;
  openLotsCount?: number;
}

export interface StockItemDto {
  stockItemId: string;
  ingredientId: string;
  ingredientName?: string | null;
  quantity: number;
  remainingQty: number;
  unitOfMeasure: UnitOfMeasure;
  unitPrice: number;
  vatPercent?: number;
  vatInclusive?: boolean;
  lotNumber?: string | null;
  supplier?: string | null;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  isExpired?: boolean;
  createdOn: string;
}

export interface RecipeLineDto {
  ingredientId: string;
  ingredientName: string;
  unitOfMeasure: UnitOfMeasure;
  stockUnitOfMeasure?: UnitOfMeasure;
  quantity: number;
  unitCostAmount: number;
  lineCostAmount: number;
  currentStockQty: number;
  portionsRemaining?: number | null;
  allergens?: string[];
  yieldPercent?: number | null;
  isLowStock?: boolean;
  unitCostExVat?: number;
  unitCostIncVat?: number;
  lineCostExVat?: number;
  lineCostIncVat?: number;
  effectiveQty?: number;
}

export interface RecipeDto {
  menuItemId: string;
  menuItemName?: string | null;
  menuItemPriceAmount?: number | null;
  menuItemPriceCurrency?: string | number | null;
  menuItemVatPercent?: number | null;
  recipeId?: string | null;
  lines: RecipeLineDto[];
  portionCostAmount: number;
  foodCostPercent?: number | null;
  portionsRemaining?: number | null;
  allergens?: string[];
}

export interface RecipeLineInput {
  ingredientId?: string | null;
  name?: string | null;
  unitOfMeasure: UnitOfMeasure | number;
  quantity: number;
}

export interface StockMovementDto {
  stockMovementId: string;
  ingredientId: string;
  stockItemId?: string | null;
  movementType: string | number;
  quantityDelta: number;
  stockAfter: number;
  note?: string | null;
  orderId?: string | null;
  createdAt: string;
}

export interface IngredientConsumptionRow {
  ingredientId: string;
  ingredientName: string;
  unitOfMeasure: UnitOfMeasure;
  quantityConsumed: number;
  estimatedCostAmount: number;
  currency: string | number;
}

export interface MenuItemPortionsDto {
  menuItemId: string;
  portionsRemaining?: number | null;
}

export interface LowStockIngredientDto {
  ingredientId: string;
  name: string;
  unitOfMeasure: UnitOfMeasure;
  currentStockQty: number;
  lowStockAlertPercent: number;
  stockAlertBaselineQty: number;
  stockPercentOfBaseline: number;
  expiryDate?: string | null;
  isExpired: boolean;
}

export interface ExpiringIngredientDto {
  ingredientId: string;
  stockItemId: string;
  name: string;
  unitOfMeasure: UnitOfMeasure;
  remainingQty: number;
  expiryDate: string;
  daysUntilExpiry: number;
  isExpired: boolean;
  isExpiringSoon?: boolean;
  lotNumber?: string | null;
  supplier?: string | null;
  /** @deprecated use remainingQty */
  currentStockQty?: number;
}

export interface InventoryAlertSettingsDto {
  lowStockAlertPercent?: number | null;
  lowStockAlertEmail?: string | null;
  expiryAlertDaysAhead: number;
  expiryAlertEmail?: string | null;
  defaultManagerEmail?: string | null;
}

export interface InventorySettingsDto {
  inventoryCostingMethod: InventoryCostingMethod;
  lowStockAlertPercent?: number | null;
  lowStockAlertEmail?: string | null;
  expiryAlertDaysAhead: number;
  expiryAlertEmail?: string | null;
  defaultManagerEmail?: string | null;
}

export const UNIT_OF_MEASURE_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: 'recipes.uom.g' },
  { value: 1, labelKey: 'recipes.uom.kg' },
  { value: 2, labelKey: 'recipes.uom.ml' },
  { value: 3, labelKey: 'recipes.uom.l' },
  { value: 4, labelKey: 'recipes.uom.pcs' },
];

export const INVENTORY_COSTING_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: 'stock.costing.cmp' },
  { value: 1, labelKey: 'stock.costing.fifo' },
  { value: 2, labelKey: 'stock.costing.lifo' },
];

/** Normalize API enum/string UOM to numeric form used in forms. */
export function normalizeUom(value: string | number): number {
  if (typeof value === 'number') return value;
  const map: Record<string, number> = { G: 0, Kg: 1, Ml: 2, L: 3, Pcs: 4 };
  return map[value] ?? 4;
}

export function normalizeCostingMethod(value: string | number): number {
  if (typeof value === 'number') return value;
  const map: Record<string, number> = { Cmp: 0, Fifo: 1, Lifo: 2 };
  return map[value] ?? 0;
}

function uomFamily(uom: number): 'mass' | 'volume' | 'count' {
  if (uom === 0 || uom === 1) return 'mass';
  if (uom === 2 || uom === 3) return 'volume';
  return 'count';
}

export function canConvertUom(from: number, to: number): boolean {
  return uomFamily(from) === uomFamily(to);
}

/** Convert qty between compatible UOMs (g↔kg, ml↔l). Throws if incompatible. */
export function convertUomQuantity(qty: number, from: number, to: number): number {
  if (!canConvertUom(from, to)) {
    throw new Error(`Cannot convert UOM ${from} to ${to}`);
  }
  return convertUom(qty, from, to);
}

/** Convert qty between compatible UOMs (g↔kg, ml↔l). */
export function convertUom(qty: number, from: number, to: number): number {
  if (from === to) return qty;
  if (!canConvertUom(from, to)) return qty;
  // to base (g or ml)
  let base = qty;
  if (from === 1) base = qty * 1000; // kg → g
  if (from === 3) base = qty * 1000; // l → ml
  if (to === 1) return base / 1000; // → kg
  if (to === 3) return base / 1000; // → l
  return base; // → g or ml
}

export function effectiveQtyInStockUom(
  quantity: number,
  recipeUom: number,
  stockUom: number,
  yieldPercent: number | null | undefined,
): number {
  const qtyInStock = convertUom(quantity, recipeUom, stockUom);
  const yieldFactor =
    yieldPercent != null && yieldPercent > 0 && yieldPercent <= 1000
      ? yieldPercent / 100
      : 1;
  return qtyInStock / yieldFactor;
}

export function normalizeIngredientName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).join(' ');
}

export function splitVat(
  amount: number,
  vatPercent: number,
  vatInclusive: boolean,
): { exVat: number; incVat: number } {
  const rate = Math.min(100, Math.max(0, vatPercent)) / 100;
  if (vatInclusive) {
    const ex = rate > 0 ? amount / (1 + rate) : amount;
    return { exVat: ex, incVat: amount };
  }
  return { exVat: amount, incVat: amount * (1 + rate) };
}

export function stockPurchaseTotalFromUnitCost(unitCost: number, stockQty: number): number {
  return Math.round(unitCost * Math.max(0, stockQty) * 10000) / 10000;
}

export function unitCostFromStockPurchaseTotal(total: number, stockQty: number): number {
  if (stockQty <= 0) return 0;
  return Math.round((total / stockQty) * 10000) / 10000;
}

export function suggestedPriceFromMargin(portionCost: number, marginPercent: number): number | null {
  if (portionCost < 0 || marginPercent < 0) return null;
  const factor = 1 + marginPercent / 100;
  if (factor <= 0) return null;
  return Math.round(portionCost * factor * 100) / 100;
}
