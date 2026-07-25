export interface FiscalInvoiceCustomerDetails {
  customerName: string;
  customerFiscalCode: string;
  customerAddressLine1: string;
  customerAddressLine2?: string;
  paymentMethod: 'cash' | 'card';
}

export function isFiscalInvoiceCustomerValid(customer: FiscalInvoiceCustomerDetails): boolean {
  return Boolean(
    customer.customerName.trim()
    && customer.customerFiscalCode.trim()
    && customer.customerAddressLine1.trim(),
  );
}
