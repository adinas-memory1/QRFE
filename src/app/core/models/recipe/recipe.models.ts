export type UnitOfMeasure = 'G' | 'Kg' | 'Ml' | 'L' | 'Pcs' | 0 | 1 | 2 | 3 | 4;

export interface IngredientDto {
  ingredientId: string;
  name: string;
  unitOfMeasure: UnitOfMeasure;
  unitCostAmount: number;
  unitCostCurrency: string | number;
  currentStockQty: number;
  isActive: boolean;
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
}

export interface RecipeDto {
  menuItemId: string;
  menuItemName?: string | null;
  menuItemPriceAmount?: number | null;
  menuItemPriceCurrency?: string | number | null;
  recipeId?: string | null;
  lines: RecipeLineDto[];
  portionCostAmount: number;
  foodCostPercent?: number | null;
  portionsRemaining?: number | null;
}

export interface RecipeLineInput {
  ingredientId: string;
  quantity: number;
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

export const UNIT_OF_MEASURE_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: 'recipes.uom.g' },
  { value: 1, labelKey: 'recipes.uom.kg' },
  { value: 2, labelKey: 'recipes.uom.ml' },
  { value: 3, labelKey: 'recipes.uom.l' },
  { value: 4, labelKey: 'recipes.uom.pcs' },
];
