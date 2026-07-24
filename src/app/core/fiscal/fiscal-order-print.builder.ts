import { buildFiscalPrintItems, type FiscalPrintItemInput } from './fiscal-print-payload.builder';
import type { OrderDTO } from '../models/orderingModel';
import type { FiscalVatGroupMapping } from './fiscal-vat-group.mapper';

import type { FiscalDocumentDto } from '../services/fiscal-documents/fiscal-documents.service';

export interface FiscalInvoiceCustomerInput {
  customerName: string;
  customerFiscalCode: string;
  customerAddressLine1: string;
  customerAddressLine2?: string;
}

export function buildFiscalPrintItemsFromOrder(
  order: OrderDTO,
  mapping: FiscalVatGroupMapping | null | undefined,
): ReturnType<typeof buildFiscalPrintItems> {
  const items: FiscalPrintItemInput[] = (order.orderItems ?? [])
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map(item => ({
      name: item.orderItemName,
      quantity: item.quantity,
      unitPrice: item.orderItemPriceAmount ?? 0,
    }));

  return buildFiscalPrintItems(items, mapping);
}

export function buildFiscalInvoicePayload(args: {
  order: OrderDTO;
  tableName: string;
  restaurantName: string;
  paymentMethod: 'cash' | 'card';
  customer: FiscalInvoiceCustomerInput;
  mapping: FiscalVatGroupMapping | null | undefined;
}): Record<string, unknown> {
  const items = buildFiscalPrintItemsFromOrder(args.order, args.mapping);
  const finalTotal = args.order.finalTotalPrice?.amount ?? args.order.subTotal?.amount ?? 0;

  return {
    type: 'fiscal-invoice',
    orderId: args.order.orderId,
    restaurantName: args.restaurantName,
    tableName: args.tableName,
    currency: args.order.finalTotalPrice?.currency ?? args.order.subTotal?.currency ?? args.order.currency,
    subTotal: args.order.subTotal?.amount ?? finalTotal,
    finalTotal,
    paymentMethod: args.paymentMethod,
    closedAtUtc: args.order.closedAt ?? new Date().toISOString(),
    customerName: args.customer.customerName.trim(),
    customerFiscalCode: args.customer.customerFiscalCode.trim(),
    customerAddressLine1: args.customer.customerAddressLine1.trim(),
    customerAddressLine2: args.customer.customerAddressLine2?.trim() || null,
    items: items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatGroup: item.vatGroup,
    })),
  };
}

export function buildFiscalStornoResoPayload(args: {
  order: OrderDTO;
  tableName: string;
  restaurantName: string;
  paymentMethod: 'cash' | 'card';
  referencedFiscalDocumentId: string;
  mapping: FiscalVatGroupMapping | null | undefined;
}): Record<string, unknown> {
  const items = buildFiscalPrintItemsFromOrder(args.order, args.mapping);
  const finalTotal = args.order.finalTotalPrice?.amount ?? args.order.subTotal?.amount ?? 0;

  return {
    type: 'fiscal-storno-reso',
    orderId: args.order.orderId,
    restaurantName: args.restaurantName,
    tableName: args.tableName,
    currency: args.order.finalTotalPrice?.currency ?? args.order.subTotal?.currency ?? args.order.currency,
    subTotal: args.order.subTotal?.amount ?? finalTotal,
    finalTotal,
    paymentMethod: args.paymentMethod,
    closedAtUtc: args.order.closedAt ?? new Date().toISOString(),
    referencedFiscalDocumentId: args.referencedFiscalDocumentId,
    items: items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatGroup: item.vatGroup,
    })),
  };
}

function normalizeFiscalDocumentType(value: string): string {
  return value.trim().toLowerCase();
}

function isIssuedFiscalStatus(status: string): boolean {
  const normalized = normalizeFiscalDocumentType(status);
  return normalized === 'issued' || normalized === 'success';
}

function sameFiscalDocumentId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isActiveFiscalStatus(status: string): boolean {
  const normalized = normalizeFiscalDocumentType(status);
  return normalized === 'pending' || normalized === 'issued' || normalized === 'success';
}

export function hasActiveReceipt(documents: Array<{ documentType: string; status: string }>): boolean {
  return documents.some(
    doc =>
      normalizeFiscalDocumentType(doc.documentType) === 'receipt'
      && isActiveFiscalStatus(doc.status),
  );
}

export function hasActiveInvoice(documents: Array<{ documentType: string; status: string }>): boolean {
  return documents.some(
    doc =>
      normalizeFiscalDocumentType(doc.documentType) === 'invoice'
      && isActiveFiscalStatus(doc.status),
  );
}

export function canIssueInvoiceForOrder(
  documents: Array<{ documentType: string; status: string }>,
  isOrderOpen: boolean,
): boolean {
  if (isOrderOpen) {
    return false;
  }
  return !hasActiveInvoice(documents) && !hasActiveReceipt(documents);
}

export function canIssueFiscalReceiptForOrder(documents: Array<{ documentType: string; status: string }>): boolean {
  return !hasActiveInvoice(documents) && !hasActiveReceipt(documents);
}

export function hasIssuedInvoice(documents: Array<{ documentType: string; status: string }>): boolean {
  return documents.some(
    doc =>
      normalizeFiscalDocumentType(doc.documentType) === 'invoice'
      && isIssuedFiscalStatus(doc.status),
  );
}

export function listStornoEligibleDocuments(documents: FiscalDocumentDto[]): FiscalDocumentDto[] {
  return documents.filter(
    doc => {
      const documentType = normalizeFiscalDocumentType(doc.documentType);
      return isIssuedFiscalStatus(doc.status)
        && (documentType === 'receipt' || documentType === 'invoice')
        && !hasIssuedStornoForReference(documents, doc.id);
    },
  );
}

export type OrderFiscalStornoState = 'none' | 'partial' | 'full';

export function getOrderFiscalStornoState(documents: FiscalDocumentDto[]): OrderFiscalStornoState {
  const issuedOriginals = documents.filter(doc => {
    const documentType = normalizeFiscalDocumentType(doc.documentType);
    return isIssuedFiscalStatus(doc.status)
      && (documentType === 'receipt' || documentType === 'invoice');
  });

  if (!issuedOriginals.length) {
    return 'none';
  }

  const stornedCount = issuedOriginals.filter(doc => hasIssuedStornoForReference(documents, doc.id)).length;
  if (stornedCount === 0) {
    return 'none';
  }
  return stornedCount === issuedOriginals.length ? 'full' : 'partial';
}

export function isFiscalDocumentStorned(document: FiscalDocumentDto, documents: FiscalDocumentDto[]): boolean {
  const documentType = normalizeFiscalDocumentType(document.documentType);
  if (documentType !== 'receipt' && documentType !== 'invoice') {
    return false;
  }
  if (!isIssuedFiscalStatus(document.status)) {
    return false;
  }
  return hasIssuedStornoForReference(documents, document.id);
}

function hasIssuedStornoForReference(documents: FiscalDocumentDto[], referencedDocumentId: string): boolean {
  return documents.some(
    storno =>
      normalizeFiscalDocumentType(storno.documentType) === 'stornoreso'
      && isIssuedFiscalStatus(storno.status)
      && sameFiscalDocumentId(storno.referencedFiscalDocumentId, referencedDocumentId),
  );
}
