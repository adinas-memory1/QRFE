import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, viewChild } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ButtonCloseDirective,
  ButtonDirective,
  DropdownComponent,
  DropdownItemDirective,
  DropdownMenuDirective,
  DropdownToggleDirective,
  FormCheckComponent,
  FormCheckInputDirective,
  FormCheckLabelDirective,
  FormControlDirective,
  FormLabelDirective,
  FormSelectDirective,
  ModalBodyComponent,
  ModalComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
  TableDirective,
  Tabs2Module,
  TemplateIdDirective,
  ToasterComponent
} from '@coreui/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, takeUntil } from 'rxjs';
import { GlobalAdminService } from '../../../core/services/global-admin-service/global-admin.service';
import {
  RestaurantDetailDTO,
  RestaurantStatisticDTO
} from '../../../core/models/global-admin-restaurant.model';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';
import { VenueSizeConfigList } from '../../../core/models/venueSizeConfigModel';
import { ToastBaseComponent } from '../../../shared/components/toast-base/toast-base.component';
import { emailFieldValidators } from '../../../core/validators/email.validator';

@Component({
  selector: 'app-manage-restaurants',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    DecimalPipe,
    ReactiveFormsModule,
    Tabs2Module,
    TableDirective,
    ModalComponent,
    ModalBodyComponent,
    ModalHeaderComponent,
    ModalFooterComponent,
    ModalTitleDirective,
    ButtonDirective,
    ButtonCloseDirective,
    FormControlDirective,
    FormLabelDirective,
    FormSelectDirective,
    FormCheckComponent,
    FormCheckInputDirective,
    FormCheckLabelDirective,
    DropdownComponent,
    DropdownItemDirective,
    DropdownMenuDirective,
    DropdownToggleDirective,
    ToasterComponent,
    TemplateIdDirective,
    TranslocoPipe
  ],
  templateUrl: './manage-restaurants.component.html'
})
export class ManageRestaurantsComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  readonly pageSizeOptions = [10, 25, 50];

  restaurants: RestaurantStatisticDTO[] = [];
  selectedRestaurant: RestaurantStatisticDTO | null = null;
  detailRestaurant: RestaurantDetailDTO | null = null;

  pageNumber = 1;
  pageSize = 10;
  totalCount = 0;

  restaurantTypes: VenueSizeConfigList = [];
  currencies: string[] = [];

  addForm: FormGroup;
  editForm: FormGroup;
  repairForm: FormGroup;

  activeTab = 0;
  loading = false;
  inventoryToggleId: string | null = null;
  repairSubmitting = false;
  editModalVisible = false;
  deleteModalVisible = false;
  detailsModalVisible = false;
  repairModalVisible = false;
  placement = 'top-end';

  readonly toaster = viewChild(ToasterComponent);

  constructor(
    private fb: FormBuilder,
    private globalAdmin: GlobalAdminService,
    private miscService: MiscellaneousService,
    private transloco: TranslocoService
  ) {
    this.addForm = this.fb.group({
      restaurantName: ['', [Validators.required, Validators.maxLength(200)]],
      restaurantType: ['', Validators.required],
      useCurrency: ['RON', Validators.required],
      name: ['', [Validators.required, Validators.maxLength(100)]],
      surname: ['', [Validators.required, Validators.maxLength(100)]],
      email: ['', emailFieldValidators],
      password: ['', [Validators.required, Validators.minLength(6)]],
      phone: [''],
      city: [''],
      country: [''],
      address: [''],
      registrationNumber: ['', [Validators.required, Validators.maxLength(50)]],
      zip: ['', Validators.maxLength(20)]
    });

    this.editForm = this.fb.group({
      restaurantName: ['', [Validators.required, Validators.maxLength(200)]],
      itHasBar: [false]
    });

    this.repairForm = this.fb.group({
      restaurantName: [''],
      name: ['', Validators.required],
      surname: ['', Validators.required],
      email: ['', emailFieldValidators],
      password: ['', [Validators.required, Validators.minLength(6)]],
      phone: ['']
    });
  }

  ngOnInit(): void {
    this.loadPage();
    this.loadDropdownData();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    const current = this.pageNumber;
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, current - half);
    const end = Math.min(total, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get showPagination(): boolean {
    return this.totalPages > 1;
  }

  get showEmptyPageHint(): boolean {
    return !this.loading && this.restaurants.length === 0 && this.totalCount > 0;
  }

  loadDropdownData(): void {
    this.miscService.getRestaurantLimits()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: limits => this.restaurantTypes = limits,
        error: err => console.error('Failed to load restaurant limits', err)
      });

    this.miscService.getCurrencies()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: currencies => this.currencies = currencies,
        error: err => console.error('Failed to load currencies', err)
      });
  }

  loadPage(): void {
    this.loading = true;
    this.globalAdmin.listRestaurants(this.pageNumber, this.pageSize)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.restaurants = res.result ?? [];
          this.totalCount = res.totalCount;
          this.loading = false;
        },
        error: err => {
          this.loading = false;
          this.addToast(
            this.transloco.translate('manageRestaurants.errorTitle'),
            err?.error?.message ?? this.transloco.translate('manageRestaurants.loadError'),
            'danger'
          );
        }
      });
  }

  onPageSizeChange(raw: string): void {
    const next = Number(raw);
    if (!Number.isFinite(next) || next <= 0) return;
    this.pageSize = next;
    this.pageNumber = 1;
    this.loadPage();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.pageNumber || this.loading) return;
    this.pageNumber = page;
    this.loadPage();
  }

  onPrevPage(): void {
    this.goToPage(this.pageNumber - 1);
  }

  onNextPage(): void {
    this.goToPage(this.pageNumber + 1);
  }

  onAdd(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }

    const payload = this.addForm.value as {
      restaurantName: string;
      restaurantType: string;
      useCurrency: string;
      name: string;
      surname: string;
      email: string;
      password: string;
      phone: string;
      city: string;
      country: string;
      address: string;
      registrationNumber: string;
      zip: string;
    };

    this.globalAdmin.provisionRestaurantWithManager(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.addToast(
            this.transloco.translate('manageRestaurants.createSuccessTitle'),
            res.message ?? payload.restaurantName,
            'success'
          );
          this.addForm.reset({
            useCurrency: 'RON',
            restaurantType: '',
            phone: '',
            city: '',
            country: '',
            address: '',
            registrationNumber: '',
            zip: ''
          });
          this.activeTab = 0;
          this.pageNumber = 1;
          this.loadPage();
        },
        error: err => this.addToast(
          this.transloco.translate('manageRestaurants.errorTitle'),
          err?.error?.message ?? this.transloco.translate('manageRestaurants.createError'),
          'danger'
        )
      });
  }

  needsRepair(restaurant: RestaurantStatisticDTO): boolean {
    return !restaurant.hasManager
      || !restaurant.hasRestaurantKey
      || (restaurant.subscriptionStatus ?? '').toLowerCase() !== 'active';
  }

  onRepair(restaurant: RestaurantStatisticDTO): void {
    this.selectedRestaurant = restaurant;
    const requiresManager = !restaurant.hasManager;
    this.repairForm = this.fb.group({
      restaurantName: [restaurant.baseRestaurantName || restaurant.restaurantName],
      name: ['', requiresManager ? Validators.required : []],
      surname: ['', requiresManager ? Validators.required : []],
      email: ['', requiresManager ? emailFieldValidators : []],
      password: ['', requiresManager ? [Validators.required, Validators.minLength(6)] : []],
      phone: ['']
    });
    this.repairModalVisible = true;
  }

  onConfirmRepair(): void {
    if (!this.selectedRestaurant || this.repairForm.invalid) {
      this.repairForm.markAllAsTouched();
      return;
    }

    const payload = this.repairForm.value as {
      restaurantName: string;
      name: string;
      surname: string;
      email: string;
      password: string;
      phone: string;
    };

    this.repairSubmitting = true;
    this.globalAdmin.repairRestaurantProvisioning(this.selectedRestaurant.restaurantId, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.repairSubmitting = false;
          this.repairModalVisible = false;
          this.selectedRestaurant = null;
          this.addToast(
            this.transloco.translate('manageRestaurants.repairSuccessTitle'),
            res.message ?? this.transloco.translate('manageRestaurants.repairSuccessBody'),
            'success'
          );
          this.loadPage();
        },
        error: err => {
          this.repairSubmitting = false;
          this.addToast(
            this.transloco.translate('manageRestaurants.errorTitle'),
            err?.error?.message ?? this.transloco.translate('manageRestaurants.repairError'),
            'danger'
          );
        }
      });
  }

  provisioningLabel(restaurant: RestaurantStatisticDTO): string {
    if (this.needsRepair(restaurant))
      return this.transloco.translate('manageRestaurants.provisioningIncomplete');
    return this.transloco.translate('manageRestaurants.provisioningComplete');
  }

  toggleInventoryManagement(restaurant: RestaurantStatisticDTO): void {
    const next = !restaurant.inventoryManagementEnabled;
    this.inventoryToggleId = restaurant.restaurantId;
    this.globalAdmin
      .setInventoryManagement(restaurant.restaurantId, next)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          restaurant.inventoryManagementEnabled = res.inventoryManagementEnabled;
          this.inventoryToggleId = null;
          this.addToast(
            this.transloco.translate('manageRestaurants.inventoryUpdatedTitle'),
            this.transloco.translate(
              res.inventoryManagementEnabled
                ? 'manageRestaurants.inventoryEnabledMsg'
                : 'manageRestaurants.inventoryDisabledMsg',
              { name: restaurant.baseRestaurantName || restaurant.restaurantName },
            ),
            'success',
          );
        },
        error: err => {
          this.inventoryToggleId = null;
          this.addToast(
            this.transloco.translate('manageRestaurants.errorTitle'),
            err?.error?.message ?? this.transloco.translate('manageRestaurants.inventoryToggleError'),
            'danger',
          );
        },
      });
  }

  onEdit(restaurant: RestaurantStatisticDTO): void {
    this.selectedRestaurant = restaurant;
    this.editForm.patchValue({
      restaurantName: restaurant.baseRestaurantName || restaurant.restaurantName,
      itHasBar: (restaurant.numberOfBars ?? 0) > 0
    });
    this.editModalVisible = true;
  }

  onSaveEdit(): void {
    if (!this.selectedRestaurant || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const payload = this.editForm.value as { restaurantName: string; itHasBar: boolean };

    this.globalAdmin.updateRestaurant(this.selectedRestaurant.restaurantId, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.addToast(
            this.transloco.translate('manageRestaurants.updateSuccessTitle'),
            payload.restaurantName,
            'success'
          );
          this.editModalVisible = false;
          this.selectedRestaurant = null;
          this.loadPage();
        },
        error: err => this.addToast(
          this.transloco.translate('manageRestaurants.errorTitle'),
          err?.error?.message ?? this.transloco.translate('manageRestaurants.updateError'),
          'danger'
        )
      });
  }

  onDelete(restaurant: RestaurantStatisticDTO): void {
    this.selectedRestaurant = restaurant;
    this.deleteModalVisible = true;
  }

  onConfirmDelete(): void {
    if (!this.selectedRestaurant) return;

    this.globalAdmin.deleteRestaurant(this.selectedRestaurant.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.addToast(
            this.transloco.translate('manageRestaurants.deleteSuccessTitle'),
            this.selectedRestaurant?.restaurantName ?? '',
            'success'
          );
          this.deleteModalVisible = false;
          this.selectedRestaurant = null;
          if (this.restaurants.length === 1 && this.pageNumber > 1) {
            this.pageNumber--;
          }
          this.loadPage();
        },
        error: err => this.addToast(
          this.transloco.translate('manageRestaurants.errorTitle'),
          err?.error?.message ?? this.transloco.translate('manageRestaurants.deleteError'),
          'danger'
        )
      });
  }

  onDetails(restaurant: RestaurantStatisticDTO): void {
    this.selectedRestaurant = restaurant;
    this.detailRestaurant = null;
    this.detailsModalVisible = true;

    this.globalAdmin.getRestaurant(restaurant.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: detail => this.detailRestaurant = detail,
        error: err => this.addToast(
          this.transloco.translate('manageRestaurants.errorTitle'),
          err?.error?.message ?? this.transloco.translate('manageRestaurants.detailsError'),
          'danger'
        )
      });
  }

  tableCount(detail: RestaurantDetailDTO | null): number {
    return detail?.tables?.length ?? 0;
  }

  barCount(detail: RestaurantDetailDTO | null): number {
    return detail?.bars?.length ?? 0;
  }

  hasMenu(detail: RestaurantDetailDTO | null): boolean {
    return detail?.menu != null;
  }

  addToast(title: string, message: string, color: string): void {
    this.toaster()?.addToast(ToastBaseComponent, {
      title,
      message,
      color,
      delay: 3000,
      placement: this.placement,
      autohide: true
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
