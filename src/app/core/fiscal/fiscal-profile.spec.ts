import {
  fiscalCapabilitiesForProvider,
  fiscalProfileForCountry,
  isFiscalCountrySupported,
  normalizeFiscalCountryCode,
} from './fiscal-profile';

describe('fiscal-profile', () => {
  it('normalizeFiscalCountryCode defaults to RO', () => {
    expect(normalizeFiscalCountryCode(undefined)).toBe('RO');
    expect(normalizeFiscalCountryCode('it')).toBe('IT');
  });

  it('fiscalCapabilitiesForProvider enables invoice on epson regardless of country', () => {
    expect(fiscalCapabilitiesForProvider('epson-fiscal')).toEqual({
      supportsInvoice: true,
      supportsStornoReso: true,
    });
    expect(fiscalCapabilitiesForProvider('fiscalnet')).toEqual({
      supportsInvoice: true,
      supportsStornoReso: true,
    });
  });

  it('fiscalProfileForCountry exposes IT invoice and storno capabilities', () => {
    expect(fiscalProfileForCountry('IT')).toEqual({
      supportsFiscalPrinting: true,
      supportsInvoice: true,
      supportsStornoReso: true,
      expectedPrinterType: 'epson-fiscal',
    });
  });

  it('fiscalProfileForCountry exposes RO invoice via FiscalNet', () => {
    expect(fiscalProfileForCountry('RO')).toEqual({
      supportsFiscalPrinting: true,
      supportsInvoice: true,
      supportsStornoReso: true,
      expectedPrinterType: 'fiscalnet',
    });
  });

  it('isFiscalCountrySupported accepts RO and IT only', () => {
    expect(isFiscalCountrySupported('RO')).toBeTrue();
    expect(isFiscalCountrySupported('IT')).toBeTrue();
    expect(isFiscalCountrySupported('US')).toBeFalse();
  });
});
