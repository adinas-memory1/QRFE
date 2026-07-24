import type { ResolvedPrinterType } from '../print/printer-agent-printer.util';

export type FiscalCountryCode = 'RO' | 'IT';

export interface FiscalProfileCapabilities {
  supportsFiscalPrinting: boolean;
  supportsInvoice: boolean;
  supportsStornoReso: boolean;
  expectedPrinterType: ResolvedPrinterType;
}

export function fiscalCapabilitiesForProvider(
  fiscalProvider: ResolvedPrinterType | null | undefined,
): Pick<FiscalProfileCapabilities, 'supportsInvoice' | 'supportsStornoReso'> {
  const isEpson = fiscalProvider === 'epson-fiscal';
  return {
    supportsInvoice: isEpson,
    supportsStornoReso: isEpson,
  };
}

export function normalizeFiscalCountryCode(value: string | null | undefined): FiscalCountryCode {
  return value?.trim().toUpperCase() === 'IT' ? 'IT' : 'RO';
}

export function fiscalProfileForCountry(countryCode: string | null | undefined): FiscalProfileCapabilities {
  const country = normalizeFiscalCountryCode(countryCode);
  if (country === 'IT') {
    return {
      supportsFiscalPrinting: true,
      supportsInvoice: true,
      supportsStornoReso: true,
      expectedPrinterType: 'epson-fiscal',
    };
  }

  return {
    supportsFiscalPrinting: true,
    supportsInvoice: false,
    supportsStornoReso: false,
    expectedPrinterType: 'fiscalnet',
  };
}

export function isFiscalCountrySupported(countryCode: string | null | undefined): boolean {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized === 'RO' || normalized === 'IT';
}
