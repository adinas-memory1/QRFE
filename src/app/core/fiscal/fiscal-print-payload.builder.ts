import { resolveFiscalVatGroup, type FiscalVatGroupMapping } from './fiscal-vat-group.mapper';

export interface FiscalPrintItemInput {
  name: string;
  quantity: number;
  unitPrice: number;
  menuItemId?: string;
  menuItemVatPercent?: number | null;
}

export interface FiscalPrintItemOutput extends FiscalPrintItemInput {
  vatGroup?: number;
}

export function buildFiscalPrintItems(
  items: FiscalPrintItemInput[],
  mapping: FiscalVatGroupMapping | null | undefined,
): FiscalPrintItemOutput[] {
  return items.map(item => ({
    ...item,
    vatGroup: resolveFiscalVatGroup(item.menuItemVatPercent, mapping),
  }));
}
