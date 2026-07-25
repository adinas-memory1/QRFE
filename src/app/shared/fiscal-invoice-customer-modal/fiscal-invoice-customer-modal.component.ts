import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonDirective,
  FormControlDirective,
  FormLabelDirective,
  ModalBodyComponent,
  ModalComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
} from '@coreui/angular';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  FiscalInvoiceCustomerDetails,
  isFiscalInvoiceCustomerValid,
} from '../../core/fiscal/fiscal-invoice-customer.model';

@Component({
  selector: 'app-fiscal-invoice-customer-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonDirective,
    FormControlDirective,
    FormLabelDirective,
    ModalComponent,
    ModalHeaderComponent,
    ModalTitleDirective,
    ModalBodyComponent,
    ModalFooterComponent,
    TranslocoPipe,
  ],
  templateUrl: './fiscal-invoice-customer-modal.component.html',
})
export class FiscalInvoiceCustomerModalComponent {
  @Input() visible = false;
  @Input() submitting = false;
  @Input() confirmLabelKey = 'orderHistory.issueInvoice';

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() confirm = new EventEmitter<FiscalInvoiceCustomerDetails>();

  customerName = '';
  customerFiscalCode = '';
  customerAddressLine1 = '';
  customerAddressLine2 = '';
  paymentMethod: 'cash' | 'card' = 'cash';

  onVisibleChange(value: boolean): void {
    this.visible = value;
    this.visibleChange.emit(value);
    if (value) {
      this.resetFields();
    }
  }

  onCancel(): void {
    this.onVisibleChange(false);
  }

  onSubmit(): void {
    const customer: FiscalInvoiceCustomerDetails = {
      customerName: this.customerName.trim(),
      customerFiscalCode: this.customerFiscalCode.trim(),
      customerAddressLine1: this.customerAddressLine1.trim(),
      customerAddressLine2: this.customerAddressLine2.trim() || undefined,
      paymentMethod: this.paymentMethod,
    };

    if (!isFiscalInvoiceCustomerValid(customer)) {
      return;
    }

    this.confirm.emit(customer);
  }

  canSubmit(): boolean {
    return isFiscalInvoiceCustomerValid({
      customerName: this.customerName,
      customerFiscalCode: this.customerFiscalCode,
      customerAddressLine1: this.customerAddressLine1,
      paymentMethod: this.paymentMethod,
    });
  }

  private resetFields(): void {
    this.customerName = '';
    this.customerFiscalCode = '';
    this.customerAddressLine1 = '';
    this.customerAddressLine2 = '';
    this.paymentMethod = 'cash';
  }
}
