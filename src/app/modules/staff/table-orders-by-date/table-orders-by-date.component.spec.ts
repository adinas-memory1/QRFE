import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TranslocoTestingModule, TranslocoService } from '@jsverse/transloco';
import { TableOrdersByDateComponent } from './table-orders-by-date.component';
import { AuthService } from '../../../core/auth/auth.service';
import { OrdersService } from '../../../core/services/order-service/orders.service';
import { TablesService } from '../../../core/services/tables-service/tables.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';
import { PrintJobsService } from '../../../core/services/print-jobs/print-jobs.service';
import type { FiscalPrinterSettingsDto } from '../../../core/services/print-jobs/print-jobs.service';

function fiscalSettings(overrides: Partial<FiscalPrinterSettingsDto> = {}): FiscalPrinterSettingsDto {
  return {
    fiscalCountryCode: 'RO',
    fiscalPrintingEnabled: false,
    defaultFiscalPrinterId: null,
    vatGroupMapping: {},
    fiscalProvider: null,
    supportsInvoice: false,
    supportsStornoReso: false,
    ...overrides,
  };
}
import { FiscalDocumentsService } from '../../../core/services/fiscal-documents/fiscal-documents.service';
import { Currency } from '../../../core/models/restaurantTablesModel';

describe('TableOrdersByDateComponent', () => {
  let component: TableOrdersByDateComponent;
  let fixture: ComponentFixture<TableOrdersByDateComponent>;
  let ordersService: jasmine.SpyObj<OrdersService>;
  let tablesService: jasmine.SpyObj<TablesService>;
  let printJobs: jasmine.SpyObj<PrintJobsService>;
  let fiscalDocuments: jasmine.SpyObj<FiscalDocumentsService>;
  let transloco: TranslocoService;

  beforeEach(async () => {
    ordersService = jasmine.createSpyObj('OrdersService', ['listOrdersForTableByDate']);
    tablesService = jasmine.createSpyObj('TablesService', ['getAll']);
    tablesService.getAll.and.returnValue(
      of([
        {
          restaurantId: 'r1',
          tableId: 't1',
          isTableOpen: true,
          tableName: 'Table 1',
          isWaiterCalled: false
        },
        {
          restaurantId: 'r1',
          tableId: 't2',
          isTableOpen: false,
          tableName: 'Table 2',
          isWaiterCalled: false
        }
      ])
    );
    ordersService.listOrdersForTableByDate.and.callFake((_r, tableId) =>
      of(
        tableId === 't1'
          ? [
              {
                orderId: 'o1',
                createdOn: '2026-07-06T10:00:00Z',
                currency: Currency.RON,
                isOrderOpen: false,
                subTotal: { amount: 50, currency: Currency.RON },
                orderItems: []
              }
            ]
          : []
      )
    );

    printJobs = jasmine.createSpyObj('PrintJobsService', [
      'getDefaultFiscalPrinterForStaff',
      'getFiscalPrinterSettings',
      'createFiscalInvoiceJob',
      'createFiscalStornoResoJob',
    ]);
    printJobs.getDefaultFiscalPrinterForStaff.and.returnValue(of(fiscalSettings()));
    printJobs.getFiscalPrinterSettings.and.returnValue(of(fiscalSettings()));

    fiscalDocuments = jasmine.createSpyObj('FiscalDocumentsService', ['listByOrder']);
    fiscalDocuments.listByOrder.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [
        TableOrdersByDateComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: { orderHistory: { error: 'err', noRestaurant: 'no rest' } },
            ro: { orderHistory: { error: 'err', noRestaurant: 'no rest' } },
          },
          translocoConfig: { availableLangs: ['en', 'ro'], defaultLang: 'en' }
        })
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: {
            getUserSnapshot: () => ({ restaurantId: 'r1', role: 'staff' })
          }
        },
        { provide: OrdersService, useValue: ordersService },
        { provide: TablesService, useValue: tablesService },
        {
          provide: AppToastService,
          useValue: jasmine.createSpyObj('AppToastService', ['error', 'success', 'info'])
        },
        {
          provide: PrintJobsService,
          useValue: printJobs,
        },
        {
          provide: FiscalDocumentsService,
          useValue: fiscalDocuments,
        },
        {
          provide: MiscellaneousService,
          useValue: jasmine.createSpyObj('MiscellaneousService', ['getFirstErrorMessage'])
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TableOrdersByDateComponent);
    component = fixture.componentInstance;
    transloco = TestBed.inject(TranslocoService);
    fixture.detectChanges();
  });

  it('should create and load merged orders with table names', () => {
    expect(component).toBeTruthy();
    expect(tablesService.getAll).toHaveBeenCalledWith('r1');
    expect(ordersService.listOrdersForTableByDate).toHaveBeenCalledTimes(2);
    expect(component.orderRows.length).toBe(1);
    expect(component.orderRows[0].tableName).toBe('Table 1');
    expect(component.startDate).toBe(component.endDate);
  });

  it('should compute period totals by currency', () => {
    expect(component.periodTotals.length).toBe(1);
    expect(component.periodTotals[0].orderCount).toBe(1);
    expect(component.periodTotals[0].totalAmount).toBe(50);
    expect(component.periodTotals[0].currency).toBe(Currency.RON);
  });

  it('should use admin scope for manager role', () => {
    const user = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService> & {
      getUserSnapshot: () => { restaurantId: string; role: string };
    };
    spyOn(user, 'getUserSnapshot').and.returnValue({ restaurantId: 'r1', role: 'manager' });
    component.ngOnInit();
    component.loadReport();
    expect(ordersService.listOrdersForTableByDate).toHaveBeenCalledWith(
      'r1',
      jasmine.any(String),
      jasmine.any(String),
      jasmine.any(String),
      'admin'
    );
    expect(printJobs.getFiscalPrinterSettings).toHaveBeenCalledWith('r1');
  });

  it('should show toast on load error', () => {
    const toast = TestBed.inject(AppToastService) as jasmine.SpyObj<AppToastService>;
    ordersService.listOrdersForTableByDate.and.returnValue(throwError(() => new Error('fail')));
    component.loadReport();
    expect(toast.error).toHaveBeenCalled();
  });

  it('should show fiscal actions when fiscal country is supported and printing is enabled', () => {
    component.fiscalCountryCode = 'RO';
    component.fiscalPrintingEnabled = true;
    expect(component.showFiscalActions).toBeTrue();
  });

  it('should show fiscal actions for IT invoice flow when printer is configured', () => {
    component.fiscalCountryCode = 'IT';
    component.fiscalPrintingEnabled = false;
    component.defaultFiscalPrinterId = 'printer-1';
    component.supportsInvoice = true;
    expect(component.showFiscalActions).toBeTrue();
  });

  it('should enable invoice for closed IT order without fiscal documents', () => {
    component.fiscalCountryCode = 'IT';
    component.fiscalPrintingEnabled = true;
    component.defaultFiscalPrinterId = 'printer-1';
    component.supportsInvoice = true;
    component.fiscalDocumentsByOrder = new Map();

    expect(component.canIssueInvoice(component.orderRows[0])).toBeTrue();
  });

  it('should hide fiscal actions when fiscal printing is disabled', () => {
    component.fiscalCountryCode = 'RO';
    component.fiscalPrintingEnabled = false;
    expect(component.showFiscalActions).toBeFalse();
  });

  it('should prefetch fiscal documents for closed orders when fiscal actions are enabled', async () => {
    printJobs.getDefaultFiscalPrinterForStaff.and.returnValue(
      of(fiscalSettings({ fiscalPrintingEnabled: true, defaultFiscalPrinterId: 'printer-1' })),
    );
    fiscalDocuments.listByOrder.and.returnValue(
      of([
        {
          id: 'doc-1',
          orderId: 'o1',
          printJobId: 'job-1',
          documentType: 'Receipt',
          status: 'Issued',
          fiscalNumber: '100',
          zReportNumber: '1',
          fiscalDate: null,
          referencedFiscalDocumentId: null,
          provider: 'fiscalnet',
          createdAtUtc: '2026-07-06T10:00:00Z',
          issuedAtUtc: '2026-07-06T10:01:00Z',
        },
      ]),
    );

    component.ngOnInit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fiscalDocuments.listByOrder).toHaveBeenCalledWith('r1', 'o1', 'staff');
    expect(component.canIssueStorno(component.orderRows[0])).toBeFalse();
  });

  it('should enable storno for issued Epson invoice documents in IT fiscal profile', async () => {
    printJobs.getDefaultFiscalPrinterForStaff.and.returnValue(
      of(fiscalSettings({
        fiscalCountryCode: 'IT',
        fiscalPrintingEnabled: true,
        defaultFiscalPrinterId: 'printer-1',
        fiscalProvider: 'epson-fiscal',
        supportsInvoice: true,
        supportsStornoReso: true,
      })),
    );
    fiscalDocuments.listByOrder.and.returnValue(
      of([
        {
          id: 'inv-1',
          orderId: 'o1',
          printJobId: 'job-2',
          documentType: 'Invoice',
          status: 'Issued',
          fiscalNumber: '1001',
          zReportNumber: '1',
          fiscalDate: '2026-07-22',
          referencedFiscalDocumentId: null,
          provider: 'Epson',
          createdAtUtc: '2026-07-06T10:00:00Z',
          issuedAtUtc: '2026-07-06T10:01:00Z',
        },
      ]),
    );

    component.ngOnInit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.canIssueStorno(component.orderRows[0])).toBeTrue();
    expect(component.canIssueInvoice(component.orderRows[0])).toBeFalse();
  });

  it('should prefetch fiscal documents after switching locale when fiscal profile is active', async () => {
    fiscalDocuments.listByOrder.calls.reset();
    printJobs.getDefaultFiscalPrinterForStaff.and.returnValue(
      of(fiscalSettings({ fiscalPrintingEnabled: true, defaultFiscalPrinterId: 'printer-1' })),
    );

    transloco.setActiveLang('en');
    component.fiscalCountryCode = 'RO';
    component.fiscalPrintingEnabled = true;
    component.reportLoaded = true;
    component.orderRows = [
      {
        order: {
          orderId: 'o1',
          createdOn: '2026-07-06T10:00:00Z',
          currency: Currency.RON,
          isOrderOpen: false,
          subTotal: { amount: 50, currency: Currency.RON },
          orderItems: [],
        },
        tableId: 't1',
        tableName: 'Table 1',
      },
    ];

    transloco.setActiveLang('ro');
    await fixture.whenStable();

    expect(fiscalDocuments.listByOrder).toHaveBeenCalledWith('r1', 'o1', 'staff');
  });

  it('should show hint when no fiscal documents are registered for the order', () => {
    component.fiscalCountryCode = 'RO';
    component.fiscalPrintingEnabled = true;
    component.fiscalDocumentsByOrder = new Map();

    expect(component.fiscalActionsHint(component.orderRows[0])).toBe('orderHistory.fiscalHintNoDocuments');
  });

  it('should expose full storno state when all issued receipts are reversed', () => {
    component.fiscalCountryCode = 'IT';
    component.fiscalPrintingEnabled = true;
    component.fiscalDocumentsByOrder = new Map([
      [
        'o1',
        [
          {
            id: 'r1',
            orderId: 'o1',
            printJobId: 'job-1',
            documentType: 'Receipt',
            status: 'Issued',
            fiscalNumber: '100',
            zReportNumber: '1',
            fiscalDate: null,
            referencedFiscalDocumentId: null,
            provider: 'Epson',
            createdAtUtc: '2026-07-06T10:00:00Z',
            issuedAtUtc: '2026-07-06T10:01:00Z',
          },
          {
            id: 's1',
            orderId: 'o1',
            printJobId: 'job-2',
            documentType: 'StornoReso',
            status: 'Issued',
            fiscalNumber: '101',
            zReportNumber: '1',
            fiscalDate: null,
            referencedFiscalDocumentId: 'r1',
            provider: 'Epson',
            createdAtUtc: '2026-07-06T10:05:00Z',
            issuedAtUtc: '2026-07-06T10:05:00Z',
          },
        ],
      ],
    ]);

    expect(component.fiscalStornoStateForRow(component.orderRows[0])).toBe('full');
    expect(component.canIssueStorno(component.orderRows[0])).toBeFalse();
  });

  it('should show hint when fiscal printer is not configured for invoice flow', () => {
    component.fiscalCountryCode = 'IT';
    component.fiscalPrintingEnabled = true;
    component.supportsInvoice = true;
    component.defaultFiscalPrinterId = null;
    component.fiscalDocumentsByOrder = new Map();

    expect(component.canIssueInvoice(component.orderRows[0])).toBeFalse();
    expect(component.fiscalActionsHint(component.orderRows[0])).toBe('orderHistory.fiscalHintPrinterRequired');
  });

  it('should expose issued invoice document for PDF actions', () => {
    component.fiscalPrintingEnabled = true;
    component.supportsInvoice = true;
    component.fiscalDocumentsByOrder = new Map([
      [
        'o1',
        [
          {
            id: 'inv-1',
            orderId: 'o1',
            printJobId: 'job-1',
            documentType: 'Invoice',
            status: 'Issued',
            fiscalNumber: '2001',
            zReportNumber: '1',
            fiscalDate: '2026-07-22',
            referencedFiscalDocumentId: null,
            provider: 'epson-fiscal',
            createdAtUtc: '2026-07-22T10:00:00Z',
            issuedAtUtc: '2026-07-22T10:01:00Z',
          },
        ],
      ],
    ]);

    expect(component.issuedInvoiceForOrder('o1')?.id).toBe('inv-1');
    expect(component.invoicePdfFiscalDocumentId(component.orderRows[0])).toBe('inv-1');
    expect(component.canShowInvoicePdf(component.orderRows[0])).toBeTrue();
  });

  it('should allow invoice PDF for closed order without issued printer invoice when no receipt exists', () => {
    component.fiscalPrintingEnabled = true;
    component.supportsInvoice = true;
    component.fiscalDocumentsByOrder = new Map();

    expect(component.canShowInvoicePdf(component.orderRows[0])).toBeTrue();
    expect(component.invoicePdfFiscalDocumentId(component.orderRows[0])).toBeNull();
  });

  it('should hide invoice PDF when an active receipt exists', () => {
    component.fiscalPrintingEnabled = true;
    component.supportsInvoice = true;
    component.fiscalDocumentsByOrder = new Map([
      [
        'o1',
        [
          {
            id: 'r1',
            orderId: 'o1',
            printJobId: 'job-1',
            documentType: 'Receipt',
            status: 'Issued',
            fiscalNumber: '100',
            zReportNumber: '1',
            fiscalDate: null,
            referencedFiscalDocumentId: null,
            provider: 'epson-fiscal',
            createdAtUtc: '2026-07-22T10:00:00Z',
            issuedAtUtc: '2026-07-22T10:01:00Z',
          },
        ],
      ],
    ]);

    expect(component.canShowInvoicePdf(component.orderRows[0])).toBeFalse();
  });

  it('should show fiscal actions for RO invoice flow when epson printer is configured', () => {
    component.fiscalCountryCode = 'RO';
    component.fiscalPrintingEnabled = false;
    component.defaultFiscalPrinterId = 'printer-1';
    component.fiscalProvider = 'epson-fiscal';
    component.supportsInvoice = true;
    expect(component.showFiscalActions).toBeTrue();
  });

  it('should enable invoice for closed RO order with epson printer and no receipt', () => {
    component.fiscalCountryCode = 'RO';
    component.fiscalPrintingEnabled = true;
    component.defaultFiscalPrinterId = 'printer-1';
    component.fiscalProvider = 'epson-fiscal';
    component.supportsInvoice = true;
    component.fiscalDocumentsByOrder = new Map();

    expect(component.canIssueInvoice(component.orderRows[0])).toBeTrue();
  });

  it('should apply supportsInvoice for RO FiscalNet from fiscal settings API response', async () => {
    printJobs.getFiscalPrinterSettings.and.returnValue(
      of(fiscalSettings({
        fiscalCountryCode: 'RO',
        fiscalPrintingEnabled: true,
        fiscalProvider: 'fiscalnet',
        supportsInvoice: true,
        supportsStornoReso: false,
        defaultFiscalPrinterId: 'fiscal-1',
      })),
    );

    const user = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService> & {
      getUserSnapshot: () => { restaurantId: string; role: string };
    };
    spyOn(user, 'getUserSnapshot').and.returnValue({ restaurantId: 'r1', role: 'manager' });
    component.ngOnInit();
    component.loadReport();
    await fixture.whenStable();

    expect(component.supportsInvoice).toBeTrue();
    expect(component.supportsStornoReso).toBeFalse();
    expect(component.showFiscalActions).toBeTrue();
    expect(component.canIssueInvoice(component.orderRows[0])).toBeTrue();
    expect(component.canShowInvoicePdf(component.orderRows[0])).toBeTrue();
  });

  it('should apply supportsInvoice from fiscal settings API response for Epson', async () => {
    printJobs.getDefaultFiscalPrinterForStaff.and.returnValue(
      of(fiscalSettings({
        fiscalCountryCode: 'RO',
        fiscalPrintingEnabled: true,
        fiscalProvider: 'epson-fiscal',
        supportsInvoice: true,
        supportsStornoReso: true,
        defaultFiscalPrinterId: 'printer-1',
      })),
    );

    component.loadReport();
    await fixture.whenStable();

    expect(component.supportsInvoice).toBeTrue();
    expect(component.supportsStornoReso).toBeTrue();
    expect(component.showFiscalActions).toBeTrue();
  });
});
