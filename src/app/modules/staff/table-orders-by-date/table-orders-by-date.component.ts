import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonDirective,
  CardBodyComponent,
  CardComponent,
  CardHeaderComponent,
  ColComponent,
  ContainerComponent,
  FormControlDirective,
  FormLabelDirective,
  ModalBodyComponent,
  ModalComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
  RowComponent,
  TableDirective
} from '@coreui/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, forkJoin, map, of, switchMap, catchError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { isFiscalCountrySupported, fiscalProfileForCountry } from '../../../core/fiscal/fiscal-profile';
import type { FiscalCountryCode } from '../../../core/fiscal/fiscal-profile';
import {
  buildFiscalInvoicePayload,
  buildFiscalStornoResoPayload,
  canIssueInvoiceForOrder,
  getOrderFiscalStornoState,
  hasActiveReceipt,
  isFiscalDocumentStorned,
  listStornoEligibleDocuments,
  type OrderFiscalStornoState,
} from '../../../core/fiscal/fiscal-order-print.builder';
import { OrderDTO, readIsOrderOpen, readOrderId } from '../../../core/models/orderingModel';
import { TableDTO } from '../../../core/models/restaurantTablesModel';
import { FiscalDocumentsService, type FiscalDocumentDto } from '../../../core/services/fiscal-documents/fiscal-documents.service';
import { isIssuedFiscalDocumentStatus } from '../../../core/services/fiscal-receipt-pdf/fiscal-receipt-pdf.service';
import { FiscalReceiptActionsComponent } from '../../../shared/fiscal-receipt-actions/fiscal-receipt-actions.component';
import { OrdersService } from '../../../core/services/order-service/orders.service';
import { PrintJobsService, type FiscalPrinterSettingsDto } from '../../../core/services/print-jobs/print-jobs.service';
import { TablesService } from '../../../core/services/tables-service/tables.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';

export interface OrderHistoryRow {
  order: OrderDTO;
  tableId: string;
  tableName: string;
}

export interface OrderHistoryPeriodTotal {
  currency: string;
  orderCount: number;
  totalAmount: number;
}

@Component({
  selector: 'app-table-orders-by-date',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    ContainerComponent,
    RowComponent,
    ColComponent,
    CardComponent,
    CardHeaderComponent,
    CardBodyComponent,
    FormLabelDirective,
    FormControlDirective,
    ButtonDirective,
    TableDirective,
    BadgeComponent,
    ModalComponent,
    ModalHeaderComponent,
    ModalBodyComponent,
    ModalFooterComponent,
    ModalTitleDirective,
    TranslocoPipe,
    FiscalReceiptActionsComponent,
  ],
  templateUrl: './table-orders-by-date.component.html',
  styleUrl: './table-orders-by-date.component.scss'
})
export class TableOrdersByDateComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  restaurantId = '';
  apiScope: 'staff' | 'admin' = 'staff';
  tables: TableDTO[] = [];
  startDate = '';
  endDate = '';
  loading = false;
  reportLoaded = false;
  orderRows: OrderHistoryRow[] = [];
  periodTotals: OrderHistoryPeriodTotal[] = [];
  expandedRowKey: string | null = null;

  fiscalPrintingEnabled = false;
  defaultFiscalPrinterId: string | null = null;
  fiscalCountryCode: FiscalCountryCode = 'RO';
  supportsInvoice = false;
  supportsStornoReso = false;
  fiscalVatMapping: Record<string, number> = {};
  fiscalDocumentsByOrder = new Map<string, FiscalDocumentDto[]>();

  invoiceModalVisible = false;
  stornoModalVisible = false;
  fiscalSubmitting = false;
  activeRow: OrderHistoryRow | null = null;
  invoiceCustomerName = '';
  invoiceCustomerFiscalCode = '';
  invoiceCustomerAddressLine1 = '';
  invoiceCustomerAddressLine2 = '';
  invoicePaymentMethod: 'cash' | 'card' = 'cash';
  stornoPaymentMethod: 'cash' | 'card' = 'cash';
  selectedReferencedDocumentId = '';

  constructor(
    private readonly auth: AuthService,
    private readonly ordersService: OrdersService,
    private readonly tablesService: TablesService,
    private readonly printJobs: PrintJobsService,
    private readonly fiscalDocuments: FiscalDocumentsService,
    private readonly toast: AppToastService,
    private readonly misc: MiscellaneousService,
    private readonly transloco: TranslocoService
  ) {}

  ngOnInit(): void {
    const user = this.auth.getUserSnapshot();
    this.restaurantId =
      user?.restaurantId == null || user.restaurantId === ''
        ? ''
        : String(Array.isArray(user.restaurantId) ? user.restaurantId[0] : user.restaurantId);
    this.apiScope = user?.role === 'manager' ? 'admin' : 'staff';

    const today = TableOrdersByDateComponent.formatLocalDateOnly(new Date());
    this.startDate = today;
    this.endDate = today;

    if (this.restaurantId) {
      this.loadReport();
    }

    this.transloco.langChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.reportLoaded) {
          this.prefetchFiscalDocuments(this.orderRows);
        }
        this.cdr.markForCheck();
      });
  }

  get showFiscalActions(): boolean {
    if (!isFiscalCountrySupported(this.fiscalCountryCode)) {
      return false;
    }
    if (this.fiscalPrintingEnabled) {
      return true;
    }

    const profile = fiscalProfileForCountry(this.fiscalCountryCode);
    return (profile.supportsInvoice || profile.supportsStornoReso)
      && !!this.defaultFiscalPrinterId?.trim();
  }

  private loadFiscalSettings$() {
    const settings$ = this.apiScope === 'admin'
      ? this.printJobs.getFiscalPrinterSettings(this.restaurantId)
      : this.printJobs.getDefaultFiscalPrinterForStaff(this.restaurantId);

    return settings$.pipe(
      map(cfg => {
        this.applyFiscalSettings(cfg);
        return cfg;
      }),
      catchError(() => {
        this.applyFiscalSettings(null);
        return of(null);
      }),
    );
  }

  private applyFiscalSettings(cfg: FiscalPrinterSettingsDto | null): void {
    if (!cfg) {
      this.fiscalCountryCode = 'RO';
      this.fiscalPrintingEnabled = false;
      this.defaultFiscalPrinterId = null;
      this.supportsInvoice = false;
      this.supportsStornoReso = false;
      this.fiscalVatMapping = {};
      this.cdr.markForCheck();
      return;
    }

    this.fiscalCountryCode = cfg.fiscalCountryCode ?? 'RO';
    const profile = fiscalProfileForCountry(this.fiscalCountryCode);
    this.fiscalPrintingEnabled = !!cfg.fiscalPrintingEnabled;
    this.defaultFiscalPrinterId = cfg.defaultFiscalPrinterId ?? null;
    this.supportsInvoice = profile.supportsInvoice;
    this.supportsStornoReso = profile.supportsStornoReso;
    this.fiscalVatMapping = cfg.vatGroupMapping ?? {};
    this.cdr.markForCheck();
  }

  private static formatLocalDateOnly(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  loadReport(): void {
    if (!this.restaurantId) {
      this.toast.error(this.transloco.translate('orderHistory.noRestaurant'), 'Error');
      return;
    }
    if (!this.startDate || !this.endDate) {
      return;
    }
    if (this.startDate > this.endDate) {
      this.toast.error(this.transloco.translate('orderHistory.invalidRange'), 'Error');
      return;
    }

    this.loading = true;
    this.expandedRowKey = null;
    this.fiscalDocumentsByOrder.clear();

    const tables$ = this.tables.length
      ? of(this.tables)
      : this.tablesService.getAll(this.restaurantId);

    this.loadFiscalSettings$()
      .pipe(
        switchMap(() => tables$),
        switchMap(tables => {
          this.tables = tables;
          if (!tables.length) {
            return of([] as { table: TableDTO; orders: OrderDTO[] }[]);
          }
          return forkJoin(
            tables.map(table =>
              this.ordersService
                .listOrdersForTableByDate(
                  this.restaurantId,
                  table.tableId,
                  this.startDate,
                  this.endDate,
                  this.apiScope
                )
                .pipe(map(orders => ({ table, orders: orders ?? [] })))
            )
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: results => {
          this.orderRows = results
            .flatMap(({ table, orders }) =>
              orders.map(order => ({
                order,
                tableId: table.tableId,
                tableName: this.tableLabel(table)
              }))
            )
            .sort((a, b) => (b.order.createdOn ?? '').localeCompare(a.order.createdOn ?? ''));
          this.periodTotals = this.buildPeriodTotals(this.orderRows);
          this.reportLoaded = true;
          this.loading = false;
          this.prefetchFiscalDocuments(this.orderRows);
          this.cdr.markForCheck();
        },
        error: err => {
          this.loading = false;
          this.toast.error(
            this.misc.getFirstErrorMessage(err) ?? this.transloco.translate('orderHistory.error'),
            'Error'
          );
        }
      });
  }

  private buildPeriodTotals(rows: OrderHistoryRow[]): OrderHistoryPeriodTotal[] {
    const byCurrency = new Map<string, OrderHistoryPeriodTotal>();
    for (const row of rows) {
      const currency = this.orderCurrency(row.order);
      if (!currency) {
        continue;
      }
      const existing = byCurrency.get(currency) ?? { currency, orderCount: 0, totalAmount: 0 };
      existing.orderCount += 1;
      existing.totalAmount += this.orderTotal(row.order);
      byCurrency.set(currency, existing);
    }
    return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }

  tableLabel(table: TableDTO): string {
    return table.tableName?.trim() || table.tableId;
  }

  rowKey(row: OrderHistoryRow): string {
    return `${row.tableId}:${readOrderId(row.order)}`;
  }

  orderIdForRow(row: OrderHistoryRow): string {
    return readOrderId(row.order);
  }

  isClosedOrder(row: OrderHistoryRow): boolean {
    const rec = row.order as unknown as Record<string, unknown>;
    const closedAt = row.order.closedAt ?? rec['ClosedAt'];
    if (typeof closedAt === 'string' && closedAt.trim()) {
      return true;
    }
    return !readIsOrderOpen(row.order);
  }

  toggleOrderDetails(row: OrderHistoryRow): void {
    const key = this.rowKey(row);
    const next = this.expandedRowKey === key ? null : key;
    this.expandedRowKey = next;
    if (next && this.showFiscalActions && this.isClosedOrder(row)) {
      void this.loadFiscalDocuments(this.orderIdForRow(row));
    }
  }

  documentsForOrder(orderId: string): FiscalDocumentDto[] {
    return this.fiscalDocumentsByOrder.get(orderId) ?? [];
  }

  canIssueInvoice(row: OrderHistoryRow): boolean {
    if (!this.showFiscalActions || !this.supportsInvoice || !this.isClosedOrder(row)) {
      return false;
    }
    return canIssueInvoiceForOrder(
      this.documentsForOrder(this.orderIdForRow(row)),
      readIsOrderOpen(row.order),
    );
  }

  canIssueStorno(row: OrderHistoryRow): boolean {
    if (!this.showFiscalActions || !this.supportsStornoReso || !this.isClosedOrder(row)) {
      return false;
    }
    return listStornoEligibleDocuments(this.documentsForOrder(this.orderIdForRow(row))).length > 0;
  }

  fiscalActionsHint(row: OrderHistoryRow): string | null {
    if (!this.showFiscalActions || !this.isClosedOrder(row) || this.canIssueStorno(row)) {
      return null;
    }

    const docs = this.documentsForOrder(this.orderIdForRow(row));
    if (this.supportsInvoice && hasActiveReceipt(docs)) {
      return 'orderHistory.fiscalHintReceiptBlocksInvoice';
    }
    if (this.supportsInvoice && this.canIssueInvoice(row)) {
      return 'orderHistory.fiscalHintReadyForInvoice';
    }
    if (!docs.length) {
      return 'orderHistory.fiscalHintNoDocuments';
    }
    if (docs.some(doc => doc.status.trim().toLowerCase() === 'pending')) {
      return 'orderHistory.fiscalHintPending';
    }
    return 'orderHistory.fiscalHintNotEligible';
  }

  stornoEligibleDocuments(row: OrderHistoryRow | null): FiscalDocumentDto[] {
    if (!row) {
      return [];
    }
    return listStornoEligibleDocuments(this.documentsForOrder(this.orderIdForRow(row)));
  }

  fiscalStornoStateForRow(row: OrderHistoryRow): OrderFiscalStornoState {
    return getOrderFiscalStornoState(this.documentsForOrder(this.orderIdForRow(row)));
  }

  documentIsStorned(document: FiscalDocumentDto, orderId: string): boolean {
    return isFiscalDocumentStorned(document, this.documentsForOrder(orderId));
  }

  canDownloadFiscalPdf(document: FiscalDocumentDto, orderId: string): boolean {
    if (!this.fiscalPrintingEnabled) {
      return false;
    }
    if (document.documentType.trim().toLowerCase() !== 'invoice') {
      return false;
    }
    if (!isIssuedFiscalDocumentStatus(document.status)) {
      return false;
    }
    return !this.documentIsStorned(document, orderId);
  }

  documentStatusLabel(status: string): string {
    switch (status.trim().toLowerCase()) {
      case 'issued':
      case 'success':
        return this.transloco.translate('orderHistory.fiscalStatusIssued');
      case 'pending':
        return this.transloco.translate('orderHistory.fiscalStatusPending');
      case 'failed':
        return this.transloco.translate('orderHistory.fiscalStatusFailed');
      default:
        return status;
    }
  }

  documentTypeLabel(documentType: string): string {
    switch (documentType) {
      case 'Receipt':
        return this.transloco.translate('orderHistory.fiscalDocReceipt');
      case 'Invoice':
        return this.transloco.translate('orderHistory.fiscalDocInvoice');
      case 'StornoReso':
        return this.transloco.translate('orderHistory.fiscalDocStorno');
      default:
        return documentType;
    }
  }

  private prefetchFiscalDocuments(rows: OrderHistoryRow[]): void {
    if (!this.showFiscalActions || !this.restaurantId) {
      return;
    }

    const orderIds = [...new Set(
      rows
        .filter(row => this.isClosedOrder(row))
        .map(row => this.orderIdForRow(row))
        .filter((orderId): orderId is string => !!orderId?.trim()),
    )];

    if (!orderIds.length) {
      return;
    }

    forkJoin(
      orderIds.map(orderId =>
        this.fiscalDocuments.listByOrder(this.restaurantId, orderId, this.apiScope).pipe(
          map(docs => ({ orderId, docs: docs ?? [] })),
          catchError(err => {
            console.warn('Failed to load fiscal documents', orderId, err);
            return of({ orderId, docs: [] as FiscalDocumentDto[] });
          }),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(results => {
        const next = new Map(this.fiscalDocumentsByOrder);
        for (const { orderId, docs } of results) {
          next.set(orderId, docs);
        }
        this.fiscalDocumentsByOrder = next;
        this.cdr.markForCheck();
      });
  }

  private setFiscalDocuments(orderId: string, docs: FiscalDocumentDto[]): void {
    const next = new Map(this.fiscalDocumentsByOrder);
    next.set(orderId, docs);
    this.fiscalDocumentsByOrder = next;
    this.cdr.markForCheck();
  }

  async loadFiscalDocuments(orderId: string): Promise<void> {
    if (!this.restaurantId) {
      return;
    }
    try {
      const docs = await firstValueFrom(
        this.fiscalDocuments.listByOrder(this.restaurantId, orderId, this.apiScope),
      );
      this.setFiscalDocuments(orderId, docs ?? []);
    } catch (err) {
      console.warn('Failed to load fiscal documents', err);
      this.setFiscalDocuments(orderId, []);
    }
  }

  openInvoiceModal(row: OrderHistoryRow): void {
    this.activeRow = row;
    this.invoiceCustomerName = '';
    this.invoiceCustomerFiscalCode = '';
    this.invoiceCustomerAddressLine1 = '';
    this.invoiceCustomerAddressLine2 = '';
    this.invoicePaymentMethod = 'cash';
    this.invoiceModalVisible = true;
  }

  openStornoModal(row: OrderHistoryRow): void {
    this.activeRow = row;
    this.stornoPaymentMethod = 'cash';
    const eligible = this.stornoEligibleDocuments(row);
    this.selectedReferencedDocumentId = eligible[0]?.id ?? '';
    this.stornoModalVisible = true;
  }

  async submitInvoice(): Promise<void> {
    if (!this.activeRow || !this.restaurantId || !this.defaultFiscalPrinterId) {
      return;
    }
    if (!this.invoiceCustomerName.trim() || !this.invoiceCustomerFiscalCode.trim() || !this.invoiceCustomerAddressLine1.trim()) {
      this.toast.error(
        this.transloco.translate('orderHistory.fiscalInvoiceValidation'),
        this.transloco.translate('orderHistory.fiscalActionErrorTitle'),
      );
      return;
    }

    this.fiscalSubmitting = true;
    try {
      const payload = buildFiscalInvoicePayload({
        order: this.activeRow.order,
        tableName: this.activeRow.tableName,
        restaurantName: this.auth.getUserSnapshot()?.restaurantName ?? '',
        paymentMethod: this.invoicePaymentMethod,
        customer: {
          customerName: this.invoiceCustomerName,
          customerFiscalCode: this.invoiceCustomerFiscalCode,
          customerAddressLine1: this.invoiceCustomerAddressLine1,
          customerAddressLine2: this.invoiceCustomerAddressLine2,
        },
        mapping: this.fiscalVatMapping,
      });

      await firstValueFrom(
        this.printJobs.createFiscalInvoiceJob(this.restaurantId, this.defaultFiscalPrinterId, payload),
      );

      this.invoiceModalVisible = false;
      this.toast.success(
        this.transloco.translate('orderHistory.fiscalInvoiceQueuedBody'),
        this.transloco.translate('orderHistory.fiscalInvoiceQueuedTitle'),
      );
      await this.loadFiscalDocuments(this.orderIdForRow(this.activeRow));
    } catch (err) {
      console.error('Fiscal invoice failed', err);
      this.toast.error(
        this.misc.getFirstErrorMessage(err) ?? this.transloco.translate('orderHistory.fiscalActionErrorBody'),
        this.transloco.translate('orderHistory.fiscalActionErrorTitle'),
      );
    } finally {
      this.fiscalSubmitting = false;
    }
  }

  async submitStorno(): Promise<void> {
    if (!this.activeRow || !this.restaurantId || !this.defaultFiscalPrinterId || !this.selectedReferencedDocumentId) {
      return;
    }

    this.fiscalSubmitting = true;
    try {
      const payload = buildFiscalStornoResoPayload({
        order: this.activeRow.order,
        tableName: this.activeRow.tableName,
        restaurantName: this.auth.getUserSnapshot()?.restaurantName ?? '',
        paymentMethod: this.stornoPaymentMethod,
        referencedFiscalDocumentId: this.selectedReferencedDocumentId,
        mapping: this.fiscalVatMapping,
      });

      await firstValueFrom(
        this.printJobs.createFiscalStornoResoJob(this.restaurantId, this.defaultFiscalPrinterId, payload),
      );

      this.stornoModalVisible = false;
      this.toast.success(
        this.transloco.translate('orderHistory.fiscalStornoQueuedBody'),
        this.transloco.translate('orderHistory.fiscalStornoQueuedTitle'),
      );
      await this.loadFiscalDocuments(this.orderIdForRow(this.activeRow));
    } catch (err) {
      console.error('Fiscal storno failed', err);
      this.toast.error(
        this.misc.getFirstErrorMessage(err) ?? this.transloco.translate('orderHistory.fiscalActionErrorBody'),
        this.transloco.translate('orderHistory.fiscalActionErrorTitle'),
      );
    } finally {
      this.fiscalSubmitting = false;
    }
  }

  orderTotal(order: OrderDTO): number {
    return order.finalTotalPrice?.amount ?? order.subTotal?.amount ?? 0;
  }

  orderCurrency(order: OrderDTO): string {
    return (order.finalTotalPrice?.currency ?? order.subTotal?.currency ?? order.currency ?? '').toString();
  }

  itemCount(order: OrderDTO): number {
    return (order.orderItems ?? []).reduce((sum, item) => sum + (item?.quantity ?? 0), 0);
  }

  currencyLabel(code: string): string {
    return code ? code.toUpperCase() : '—';
  }
}
