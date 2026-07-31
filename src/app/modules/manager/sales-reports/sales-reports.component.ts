import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonDirective,
  CardBodyComponent,
  CardComponent,
  CardHeaderComponent,
  ColComponent,
  ContainerComponent,
  FormControlDirective,
  FormLabelDirective,
  RowComponent,
  TableDirective
} from '@coreui/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/auth/auth.service';
import { SalesSummaryReportResponse, TopProductRow } from '../../../core/models/sales-report.model';
import { ReportingService } from '../../../core/services/reporting/reporting.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';

@Component({
  selector: 'app-sales-reports',
  standalone: true,
  imports: [
    FormsModule,
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
    TranslocoPipe
  ],
  templateUrl: './sales-reports.component.html',
  styleUrl: './sales-reports.component.scss'
})
export class SalesReportsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  restaurantId = '';
  startDate = '';
  endDate = '';
  topN = 20;
  loading = false;
  downloadingOrders = false;
  downloadingLines = false;

  summary: SalesSummaryReportResponse | null = null;
  topProducts: TopProductRow[] = [];

  constructor(
    private readonly auth: AuthService,
    private readonly reporting: ReportingService,
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

    const { start, end } = SalesReportsComponent.defaultDateRangeLocal();
    this.startDate = start;
    this.endDate = end;
    if (this.restaurantId) {
      this.load();
    }
  }

  /** Last 7 days inclusive, yyyy-MM-dd (local calendar). */
  private static defaultDateRangeLocal(): { start: string; end: string } {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    return {
      start: SalesReportsComponent.formatLocalDateOnly(start),
      end: SalesReportsComponent.formatLocalDateOnly(end)
    };
  }

  private static formatLocalDateOnly(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  load(): void {
    if (!this.restaurantId) {
      this.toast.error(this.transloco.translate('salesReports.noRestaurant'), 'Error');
      return;
    }
    if (!this.startDate || !this.endDate) {
      return;
    }
    if (this.startDate > this.endDate) {
      this.toast.error(this.transloco.translate('salesReports.invalidRange'), 'Error');
      return;
    }
    const top = Math.min(100, Math.max(1, Math.floor(this.topN) || 20));
    this.topN = top;

    this.loading = true;
    forkJoin({
      summary: this.reporting.getSalesSummary(this.restaurantId, this.startDate, this.endDate),
      top: this.reporting.getTopProducts(this.restaurantId, this.startDate, this.endDate, top),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary: s, top: t }) => {
          this.summary = s;
          this.topProducts = t ?? [];
          this.loading = false;
        },
        error: err => {
          this.loading = false;
          this.toast.error(
            this.misc.getFirstErrorMessage(err) ?? this.transloco.translate('salesReports.error'),
            'Error'
          );
        }
      });
  }

  currencyLabel(code: string): string {
    return code ? code.toUpperCase() : '—';
  }

  downloadOrders(): void {
    if (!this.canDownload()) {
      return;
    }
    this.downloadingOrders = true;
    this.reporting
      .downloadAccountingOrdersCsv(this.restaurantId, this.startDate, this.endDate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.downloadingOrders = false;
        },
        error: err => {
          this.downloadingOrders = false;
          this.toast.error(
            this.misc.getFirstErrorMessage(err) ?? this.transloco.translate('salesReports.downloadError'),
            'Error'
          );
        }
      });
  }

  downloadLines(): void {
    if (!this.canDownload()) {
      return;
    }
    this.downloadingLines = true;
    this.reporting
      .downloadAccountingOrderLinesCsv(this.restaurantId, this.startDate, this.endDate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.downloadingLines = false;
        },
        error: err => {
          this.downloadingLines = false;
          this.toast.error(
            this.misc.getFirstErrorMessage(err) ?? this.transloco.translate('salesReports.downloadError'),
            'Error'
          );
        }
      });
  }

  private canDownload(): boolean {
    if (!this.restaurantId) {
      this.toast.error(this.transloco.translate('salesReports.noRestaurant'), 'Error');
      return false;
    }
    if (!this.startDate || !this.endDate || this.startDate > this.endDate) {
      this.toast.error(this.transloco.translate('salesReports.invalidRange'), 'Error');
      return false;
    }
    return true;
  }
}
