import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, Input, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonDirective,
  DropdownComponent,
  DropdownItemDirective,
  DropdownMenuDirective,
  DropdownToggleDirective,
  FormControlDirective,
  FormLabelDirective,
  ModalBodyComponent,
  ModalComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
} from '@coreui/angular';
import { IconDirective } from '@coreui/icons-angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  FiscalReceiptPdfApiScope,
  FiscalReceiptPdfService,
} from '../../core/services/fiscal-receipt-pdf/fiscal-receipt-pdf.service';
import { AppToastService } from '../../core/services/toast-service/toast-service.service';

@Component({
  selector: 'app-fiscal-receipt-actions',
  standalone: true,
  imports: [
    FormsModule,
    ButtonDirective,
    DropdownComponent,
    DropdownToggleDirective,
    DropdownMenuDirective,
    DropdownItemDirective,
    FormControlDirective,
    FormLabelDirective,
    ModalComponent,
    ModalHeaderComponent,
    ModalTitleDirective,
    ModalBodyComponent,
    ModalFooterComponent,
    IconDirective,
    TranslocoPipe,
  ],
  templateUrl: './fiscal-receipt-actions.component.html',
  styleUrl: './fiscal-receipt-actions.component.scss',
})
export class FiscalReceiptActionsComponent {
  @Input({ required: true }) restaurantId!: string;
  @Input({ required: true }) orderId!: string;
  @Input() fiscalDocumentId: string | null = null;
  @Input() apiScope: FiscalReceiptPdfApiScope = 'public';
  @Input() compact = false;

  busy = false;
  emailModalVisible = false;
  emailAddress = '';
  emailSending = false;

  private readonly destroyRef = inject(DestroyRef);
  private readonly fiscalReceiptPdf = inject(FiscalReceiptPdfService);
  private readonly toast = inject(AppToastService);
  private readonly transloco = inject(TranslocoService);

  openEmailModal(): void {
    this.emailAddress = '';
    this.emailModalVisible = true;
  }

  downloadPdf(): void {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.fiscalReceiptPdf.downloadPdf(
      this.restaurantId,
      this.orderId,
      this.apiScope,
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
        },
        error: err => this.handleError(err, 'client.fiscalReceiptPdf.downloadError'),
      });
  }

  sendEmail(): void {
    const email = this.emailAddress.trim();
    if (!email.includes('@') || this.emailSending) {
      return;
    }

    this.emailSending = true;
    this.fiscalReceiptPdf.emailPdf(
      this.restaurantId,
      this.orderId,
      email,
      this.apiScope,
      this.fiscalDocumentId,
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.emailSending = false;
          if (result.sent) {
            this.emailModalVisible = false;
            this.toast.success(this.transloco.translate('client.fiscalReceiptPdf.emailSent'));
            return;
          }
          this.toast.error(
            result.message ?? this.transloco.translate('client.fiscalReceiptPdf.emailError'),
          );
        },
        error: err => {
          this.emailSending = false;
          this.handleError(err, 'client.fiscalReceiptPdf.emailError');
        },
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
