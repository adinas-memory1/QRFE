import {
  FiscalInvoiceCustomerDetails,
  isFiscalInvoiceCustomerValid,
  isFiscalInvoiceEmailValid,
} from './fiscal-invoice-customer.model';

describe('fiscal-invoice-customer.model', () => {
  const validCustomer: FiscalInvoiceCustomerDetails = {
    customerName: 'Acme SRL',
    customerFiscalCode: 'RO12345678',
    customerAddressLine1: 'Str. Exemplu 1',
    paymentMethod: 'cash',
  };

  it('isFiscalInvoiceCustomerValid accepts customer without email by default', () => {
    expect(isFiscalInvoiceCustomerValid(validCustomer)).toBeTrue();
  });

  it('isFiscalInvoiceCustomerValid requires email when requireEmail is set', () => {
    expect(isFiscalInvoiceCustomerValid(validCustomer, { requireEmail: true })).toBeFalse();
    expect(isFiscalInvoiceCustomerValid(
      { ...validCustomer, customerEmail: 'client@example.com' },
      { requireEmail: true },
    )).toBeTrue();
  });

  it('isFiscalInvoiceEmailValid rejects invalid addresses', () => {
    expect(isFiscalInvoiceEmailValid('')).toBeFalse();
    expect(isFiscalInvoiceEmailValid('not-an-email')).toBeFalse();
    expect(isFiscalInvoiceEmailValid('a@b.c')).toBeTrue();
  });
});
