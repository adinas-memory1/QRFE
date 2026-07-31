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

export interface IngredientDto {
  ingredientId: string;
  name: string;
  unitOfMeasure: UnitOfMeasure;
  unitCostAmount: number;
  unitCostCurrency: string | number;
  currentStockQty: number;
  isActive: boolean;
  vatPercent?: number;
  vatInclusive?: boolean;
  allergens?: string[];
  yieldPercent?: number | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  purchaseDate?: string | null;
  supplier?: string | null;
  lowStockAlertPercent?: number | null;
  stockAlertBaselineQty?: number | null;
  isExpired?: boolean;
  isLowStock?: boolean;
  unitCostExVat?: number;
  unitCostIncVat?: number;
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
  vatPercent?: number;
  vatInclusive?: boolean;
  allergens?: string[];
  yieldPercent?: number | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  purchaseDate?: string | null;
  supplier?: string | null;
  lowStockAlertPercent?: number | null;
  isExpired?: boolean;
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
  name: string;
  unitOfMeasure: UnitOfMeasure | number;
  stockUnitOfMeasure?: UnitOfMeasure | number;
  quantity: number;
  unitCostAmount: number;
  currentStockQty: number;
  vatPercent?: number;
  vatInclusive?: boolean;
  allergens?: string[];
  yieldPercent?: number | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
  purchaseDate?: string | null;
  supplier?: string | null;
  lowStockAlertPercent?: number | null;
}

export interface StockMovementDto {
  stockMovementId: string;
  ingredientId: string;
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
  name: string;
  unitOfMeasure: UnitOfMeasure;
  currentStockQty: number;
  expiryDate: string;
  daysUntilExpiry: number;
  isExpired: boolean;
  lotNumber?: string | null;
  supplier?: string | null;
}

export const UNIT_OF_MEASURE_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: 'recipes.uom.g' },
  { value: 1, labelKey: 'recipes.uom.kg' },
  { value: 2, labelKey: 'recipes.uom.ml' },
  { value: 3, labelKey: 'recipes.uom.l' },
  { value: 4, labelKey: 'recipes.uom.pcs' },
];

/** Normalize API enum/string UOM to numeric form used in forms. */
export function normalizeUom(value: string | number): number {
  if (typeof value === 'number') return value;
  const map: Record<string, number> = { G: 0, Kg: 1, Ml: 2, L: 3, Pcs: 4 };
  return map[value] ?? 4;
}

function uomFamily(uom: number): 'mass' | 'volume' | 'count' {
  if (uom === 0 || uom === 1) return 'mass';
  if (uom === 2 || uom === 3) return 'volume';
  return 'count';
}

function toCanonical(qty: number, uom: number): number {
  if (uom === 1 || uom === 3) return qty * 1000; // kg / l
  return qty; // g / ml / pcs
}

function fromCanonical(canonical: number, uom: number): number {
  if (uom === 1 || uom === 3) return canonical / 1000;
  return canonical;
}

export function canConvertUom(from: number, to: number): boolean {
  return from === to || (uomFamily(from) === uomFamily(to) && uomFamily(from) !== 'count');
}

/** Convert quantity between compatible UOMs (g↔kg, ml↔l). */
export function convertUomQuantity(quantity: number, from: number, to: number): number {
  if (from === to) return quantity;
  if (!canConvertUom(from, to)) {
    throw new Error(`Cannot convert UOM ${from} to ${to}`);
  }
  return fromCanonical(toCanonical(quantity, from), to);
}

/** Qty in stock UOM after yield, for cost / portions. */
export function effectiveQtyInStockUom(
  quantity: number,
  recipeUom: number,
  stockUom: number,
  yieldPercent: number | null | undefined,
): number {
  const qtyInStock = convertUomQuantity(quantity, recipeUom, stockUom);
  return effectiveQtyForYield(qtyInStock, yieldPercent);
}

/** Collapse whitespace / trim for display & API. */
export function normalizeIngredientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function splitVat(
  amount: number,
  vatPercent: number,
  inclusive: boolean,
): { exVat: number; incVat: number } {
  const rate = Math.min(100, Math.max(0, vatPercent)) / 100;
  if (inclusive) {
    const ex = rate > 0 ? amount / (1 + rate) : amount;
    return { exVat: round4(ex), incVat: round4(amount) };
  }
  return { exVat: round4(amount), incVat: round4(amount * (1 + rate)) };
}

export function effectiveQtyForYield(quantity: number, yieldPercent: number | null | undefined): number {
  if (yieldPercent == null || yieldPercent <= 0) {
    return quantity;
  }
  return quantity / (yieldPercent / 100);
}

/** Suggested sell price from portion cost and desired margin % on cost. */
export function suggestedPriceFromMargin(portionCostExVat: number, marginPercent: number): number {
  if (marginPercent < 0 || marginPercent >= 100) {
    return portionCostExVat;
  }
  // price = cost / (1 - margin/100)  → margin is gross margin on sell price
  return round4(portionCostExVat / (1 - marginPercent / 100));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
