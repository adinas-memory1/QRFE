import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, Input, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonDirective,
  DropdownComponent,
  DropdownItemDirective,
  DropdownMenuDirective,
  DropdownToggleDirective,
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { FiscalInvoiceCustomerDetails } from '../../core/fiscal/fiscal-invoice-customer.model';
import { isFiscalInvoiceEmailValid } from '../../core/fiscal/fiscal-invoice-customer.model';
import {
  FiscalReceiptPdfApiScope,
  FiscalReceiptPdfService,
} from '../../core/services/fiscal-receipt-pdf/fiscal-receipt-pdf.service';
import { AppToastService } from '../../core/services/toast-service/toast-service.service';
import { FiscalInvoiceCustomerModalComponent } from '../fiscal-invoice-customer-modal/fiscal-invoice-customer-modal.component';

type PendingPdfAction = 'download' | 'email';

@Component({
  selector: 'app-fiscal-receipt-actions',
  standalone: true,
  imports: [
    ButtonDirective,
    DropdownComponent,
    DropdownToggleDirective,
    DropdownMenuDirective,
    DropdownItemDirective,
    IconDirective,
    TranslocoPipe,
    FiscalInvoiceCustomerModalComponent,
  ],
  templateUrl: './fiscal-receipt-actions.component.html',
  styleUrl: './fiscal-receipt-actions.component.scss',
})
export class FiscalReceiptActionsComponent {
  @Input({ required: true }) restaurantId!: string;
  @Input({ required: true }) orderId!: string;
  @Input() fiscalDocumentId: string | null = null;
  @Input() apiScope: FiscalReceiptPdfApiScope = 'public';

  busy = false;
  customerModalVisible = false;
  customerModalConfirmKey = 'client.fiscalReceiptPdf.download';
  customerModalTitleKey = 'orderHistory.invoiceModalTitle';
  requireCustomerEmail = false;
  pendingAction: PendingPdfAction | null = null;

  private readonly destroyRef = inject(DestroyRef);
  private readonly fiscalReceiptPdf = inject(FiscalReceiptPdfService);
  private readonly toast = inject(AppToastService);
  private readonly transloco = inject(TranslocoService);

  requestDownload(): void {
    this.pendingAction = 'download';
    this.requireCustomerEmail = false;
    this.customerModalTitleKey = 'orderHistory.invoiceModalTitle';
    this.customerModalConfirmKey = 'client.fiscalReceiptPdf.download';
    this.customerModalVisible = true;
  }

  requestEmail(): void {
    this.pendingAction = 'email';
    this.requireCustomerEmail = true;
    this.customerModalTitleKey = 'orderHistory.emailInvoiceModalTitle';
    this.customerModalConfirmKey = 'orderHistory.sendInvoiceEmail';
    this.customerModalVisible = true;
  }

  onCustomerConfirmed(customer: FiscalInvoiceCustomerDetails): void {
    if (this.pendingAction === 'download') {
      this.downloadPdf(customer);
      return;
    }

    if (this.pendingAction === 'email') {
      this.sendEmail(customer);
    }
  }

  downloadPdf(customer: FiscalInvoiceCustomerDetails): void {
    if (this.busy) {
      return;
    }

    this.busy = true;
    this.fiscalReceiptPdf.downloadPdf(
      this.restaurantId,
      this.orderId,
      this.apiScope,
      customer,
      this.fiscalDocumentId,
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          const prefix = 'FISCAL-INVOICE';
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${prefix}-${this.orderId}.pdf`;
          anchor.click();
          URL.revokeObjectURL(url);
          this.busy = false;
          this.customerModalVisible = false;
          this.pendingAction = null;
        },
        error: err => this.handleError(err, 'client.fiscalReceiptPdf.downloadError'),
      });
  }

  sendEmail(customer: FiscalInvoiceCustomerDetails): void {
    const email = customer.customerEmail?.trim() ?? '';
    if (!isFiscalInvoiceEmailValid(email) || this.busy) {
      return;
    }

    this.busy = true;
    this.fiscalReceiptPdf.emailPdf(
      this.restaurantId,
      this.orderId,
      email,
      this.apiScope,
      customer,
      this.fiscalDocumentId,
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.busy = false;
          if (result.sent) {
            this.customerModalVisible = false;
            this.pendingAction = null;
            this.toast.success(this.transloco.translate('client.fiscalReceiptPdf.emailSent'));
            return;
          }
          this.toast.error(
            result.message ?? this.transloco.translate('client.fiscalReceiptPdf.emailError'),
          );
        },
        error: err => this.handleError(err, 'client.fiscalReceiptPdf.emailError'),
      });
  }

  private handleError(err: unknown, messageKey: string): void {
    this.busy = false;
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    const msg = status === 429
      ? this.transloco.translate('client.fiscalReceiptPdf.rateLimited')
      : this.transloco.translate(messageKey);
    this.toast.error(msg);
  }
}
