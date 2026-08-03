import { Component } from '@angular/core';
import { AsyncPipe, NgFor } from '@angular/common';
import { ToasterComponent } from '@coreui/angular';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { ToastBaseComponent } from '../toast-base/toast-base.component';

@Component({
  selector: 'app-toasts',
  standalone: true,
  imports: [AsyncPipe, NgFor, ToasterComponent, ToastBaseComponent],
  template: `
    <c-toaster position="fixed" placement="top-end" class="p-3 app-toasts-host">
      <app-toast-base
        *ngFor="let toast of toastService.toasts$ | async; trackBy: trackById"
        [color]="toast.color || 'primary'"
        [title]="toast.title || ''"
        [message]="toast.message"
        [autohide]="toast.autohide ?? true"
        [delay]="toast.delay"
        [visible]="true"
        (visibleChange)="onDismiss($event, toast.id)"
      />
    </c-toaster>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .app-toasts-host {
        z-index: 2100;
      }
    `,
  ],
})
export class AppToastsComponent {
  constructor(public toastService: AppToastService) {}

  trackById(_: number, toast: { id: string }) {
    return toast.id;
  }

  onDismiss(visible: boolean, id: string) {
    if (!visible) this.toastService.remove(id);
  }
}