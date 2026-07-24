import {
  buildFiscalInvoicePayload,
  buildFiscalStornoResoPayload,
  canIssueFiscalReceiptForOrder,
  canIssueInvoiceForOrder,
  getOrderFiscalStornoState,
  hasIssuedInvoice,
  isFiscalDocumentStorned,
  listStornoEligibleDocuments,
} from './fiscal-order-print.builder';
import { Currency } from '../models/restaurantTablesModel';

describe('fiscal-order-print.builder', () => {
  const order = {
    orderId: 'order-1',
    createdOn: '2026-07-06T10:00:00Z',
    currency: Currency.EUR,
    isOrderOpen: false,
    subTotal: { amount: 12, currency: Currency.EUR },
    finalTotalPrice: { amount: 12, currency: Currency.EUR },
    orderItems: [
      {
        menuItemId: 'm1',
        orderItemName: 'Pizza',
        orderItemPriceAmount: 12,
        orderItemPriceCurrency: Currency.EUR,
        orderItemDescription: '',
        category: 'food',
        quantity: 1,
      },
    ],
  };

  it('buildFiscalInvoicePayload includes customer and fiscal-invoice type', () => {
    const payload = buildFiscalInvoicePayload({
      order,
      tableName: 'T1',
      restaurantName: 'Trattoria',
      paymentMethod: 'cash',
      customer: {
        customerName: 'Acme SRL',
        customerFiscalCode: 'IT12345678901',
        customerAddressLine1: 'Via Roma 1',
      },
      mapping: { '22': 1 },
    });

    expect(payload['type']).toBe('fiscal-invoice');
    expect(payload['customerName']).toBe('Acme SRL');
    expect(payload['customerFiscalCode']).toBe('IT12345678901');
    expect(Array.isArray(payload['items'])).toBeTrue();
  });

  it('buildFiscalStornoResoPayload includes referenced document id', () => {
    const payload = buildFiscalStornoResoPayload({
      order,
      tableName: 'T1',
      restaurantName: 'Trattoria',
      paymentMethod: 'card',
      referencedFiscalDocumentId: 'doc-1',
      mapping: { '22': 1 },
    });

    expect(payload['type']).toBe('fiscal-storno-reso');
    expect(payload['referencedFiscalDocumentId']).toBe('doc-1');
  });

  it('canIssueInvoiceForOrder requires closed order without receipt or invoice', () => {
    expect(canIssueInvoiceForOrder([], true)).toBeFalse();
    expect(canIssueInvoiceForOrder([], false)).toBeTrue();
    expect(canIssueInvoiceForOrder([{ documentType: 'Receipt', status: 'Issued' }], false)).toBeFalse();
    expect(canIssueInvoiceForOrder([{ documentType: 'Invoice', status: 'Pending' }], false)).toBeFalse();
  });

  it('canIssueFiscalReceiptForOrder rejects when invoice exists', () => {
    expect(canIssueFiscalReceiptForOrder([{ documentType: 'Invoice', status: 'Issued' }])).toBeFalse();
    expect(canIssueFiscalReceiptForOrder([])).toBeTrue();
  });

  it('hasIssuedInvoice detects issued invoice documents', () => {
    expect(hasIssuedInvoice([{ documentType: 'Receipt', status: 'Issued' }])).toBeFalse();
    expect(hasIssuedInvoice([{ documentType: 'Invoice', status: 'Issued' }])).toBeTrue();
  });

  it('listStornoEligibleDocuments excludes documents with existing storno', () => {
    const docs = listStornoEligibleDocuments([
      {
        id: 'a',
        orderId: 'order-1',
        printJobId: 'job-1',
        documentType: 'Receipt',
        status: 'Issued',
        fiscalNumber: '1',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
      {
        id: 'b',
        orderId: 'order-1',
        printJobId: 'job-2',
        documentType: 'StornoReso',
        status: 'Issued',
        fiscalNumber: '2',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: 'a',
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
    ]);

    expect(docs.map(d => d.id)).toEqual([]);
  });

  it('listStornoEligibleDocuments accepts PascalCase API values', () => {
    const docs = listStornoEligibleDocuments([
      {
        id: 'a',
        orderId: 'order-1',
        printJobId: 'job-1',
        documentType: 'Receipt',
        status: 'Issued',
        fiscalNumber: '1',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'FiscalNet',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
    ]);

    expect(docs.map(d => d.id)).toEqual(['a']);
  });

  it('listStornoEligibleDocuments accepts issued Epson invoice documents', () => {
    const docs = listStornoEligibleDocuments([
      {
        id: 'inv-1',
        orderId: 'order-1',
        printJobId: 'job-2',
        documentType: 'Invoice',
        status: 'Issued',
        fiscalNumber: '1001',
        zReportNumber: '1',
        fiscalDate: '2026-07-22',
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
    ]);

    expect(docs.map(d => d.id)).toEqual(['inv-1']);
  });

  it('listStornoEligibleDocuments treats Success status as issued', () => {
    const docs = listStornoEligibleDocuments([
      {
        id: 'a',
        orderId: 'order-1',
        printJobId: 'job-1',
        documentType: 'Receipt',
        status: 'Success',
        fiscalNumber: '1',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
    ]);

    expect(docs.map(d => d.id)).toEqual(['a']);
  });

  it('getOrderFiscalStornoState returns full when all issued originals are storned', () => {
    expect(getOrderFiscalStornoState([
      {
        id: 'r1',
        orderId: 'order-1',
        printJobId: 'job-1',
        documentType: 'Receipt',
        status: 'Issued',
        fiscalNumber: '1',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
      {
        id: 's1',
        orderId: 'order-1',
        printJobId: 'job-2',
        documentType: 'StornoReso',
        status: 'Issued',
        fiscalNumber: '2',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: 'r1',
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:05:00Z',
        issuedAtUtc: '2026-07-06T10:05:00Z',
      },
    ])).toBe('full');
  });

  it('getOrderFiscalStornoState returns partial when only some originals are storned', () => {
    expect(getOrderFiscalStornoState([
      {
        id: 'r1',
        orderId: 'order-1',
        printJobId: 'job-1',
        documentType: 'Receipt',
        status: 'Issued',
        fiscalNumber: '1',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
      {
        id: 'r2',
        orderId: 'order-1',
        printJobId: 'job-2',
        documentType: 'Receipt',
        status: 'Issued',
        fiscalNumber: '2',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:01:00Z',
        issuedAtUtc: '2026-07-06T10:01:00Z',
      },
      {
        id: 's1',
        orderId: 'order-1',
        printJobId: 'job-3',
        documentType: 'StornoReso',
        status: 'Issued',
        fiscalNumber: '3',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: 'r1',
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:05:00Z',
        issuedAtUtc: '2026-07-06T10:05:00Z',
      },
    ])).toBe('partial');
  });

  it('isFiscalDocumentStorned detects issued storno reference', () => {
    const docs = [
      {
        id: 'r1',
        orderId: 'order-1',
        printJobId: 'job-1',
        documentType: 'Receipt',
        status: 'Issued',
        fiscalNumber: '1',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: null,
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:00:00Z',
        issuedAtUtc: '2026-07-06T10:00:00Z',
      },
      {
        id: 's1',
        orderId: 'order-1',
        printJobId: 'job-2',
        documentType: 'StornoReso',
        status: 'Issued',
        fiscalNumber: '2',
        zReportNumber: '1',
        fiscalDate: null,
        referencedFiscalDocumentId: 'r1',
        provider: 'Epson',
        createdAtUtc: '2026-07-06T10:05:00Z',
        issuedAtUtc: '2026-07-06T10:05:00Z',
      },
    ] as const;

    expect(isFiscalDocumentStorned(docs[0], [...docs])).toBeTrue();
    expect(isFiscalDocumentStorned(docs[1], [...docs])).toBeFalse();
  });
});
