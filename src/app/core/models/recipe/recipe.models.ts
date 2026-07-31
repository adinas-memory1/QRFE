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
