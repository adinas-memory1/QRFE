export interface TaxLineDto {
  label: string;
  amount: number;
  jurisdiction?: string;
  rate?: number;
}

export interface TaxCalculationResult {
  subTotal: number;
  taxAmount: number;
  total: number;
  currency: string;
  stripeCalculationId: string;
  taxLines: TaxLineDto[];
}

export enum UsSalesTaxCategory {
  PreparedFood = 'PreparedFood',
  SoftDrinks = 'SoftDrinks',
  Alcohol = 'Alcohol',
}

export const US_SALES_TAX_CATEGORY_OPTIONS: { value: UsSalesTaxCategory; labelKey: string }[] = [
  { value: UsSalesTaxCategory.PreparedFood, labelKey: 'menu.manageMenu.salesTaxCategory.preparedFood' },
  { value: UsSalesTaxCategory.SoftDrinks, labelKey: 'menu.manageMenu.salesTaxCategory.softDrinks' },
  { value: UsSalesTaxCategory.Alcohol, labelKey: 'menu.manageMenu.salesTaxCategory.alcohol' },
];
