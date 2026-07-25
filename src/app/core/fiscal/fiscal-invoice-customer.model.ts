export interface FiscalInvoiceCustomerDetails {
  customerName: string;
  customerFiscalCode: string;
  customerAddressLine1: string;
  customerAddressLine2?: string;
  paymentMethod: 'cash' | 'card';
  /** Required when sending the invoice PDF by email. */
  customerEmail?: string;
}

export interface FiscalInvoiceCustomerValidationOptions {
  requireEmail?: boolean;
}

export function isFiscalInvoiceEmailValid(email: string | null | undefined): boolean {
  const trimmed = email?.trim() ?? '';
  return trimmed.includes('@') && trimmed.length >= 5;
}

export function isFiscalInvoiceCustomerValid(
  customer: FiscalInvoiceCustomerDetails,
  options: FiscalInvoiceCustomerValidationOptions = {},
): boolean {
  const baseValid = Boolean(
    customer.customerName.trim()
    && customer.customerFiscalCode.trim()
    && customer.customerAddressLine1.trim(),
  );

  if (!baseValid) {
    return false;
  }

  if (options.requireEmail) {
    return isFiscalInvoiceEmailValid(customer.customerEmail);
  }

  return true;
}
