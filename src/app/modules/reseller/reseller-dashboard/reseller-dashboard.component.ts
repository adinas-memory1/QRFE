import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ButtonDirective,
  FormSelectDirective,
  TableDirective
} from '@coreui/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, takeUntil } from 'rxjs';
import { ResellerService } from '../../../core/services/reseller-service/reseller.service';
import { RestaurantStatisticDTO } from '../../../core/models/global-admin-restaurant.model';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';

@Component({
  selector: 'app-reseller-dashboard',
  standalone: true,
  imports: [DecimalPipe, RouterLink, TableDirective, ButtonDirective, FormSelectDirective, TranslocoPipe],
  templateUrl: './reseller-dashboard.component.html'
})
export class ResellerDashboardComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  readonly pageSizeOptions = [10, 25, 50];

  restaurants: RestaurantStatisticDTO[] = [];
  pageNumber = 1;
  pageSize = 10;
  totalCount = 0;
  loading = false;
  inventoryToggleId: string | null = null;

  constructor(
    private readonly reseller: ResellerService,
    private readonly toast: AppToastService,
    private readonly transloco: TranslocoService
  ) {}

  ngOnInit(): void {
    this.loadPage();
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

  loadPage(): void {
    this.loading = true;
    this.reseller.listRestaurants(this.pageNumber, this.pageSize)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.restaurants = res.result ?? [];
          this.totalCount = res.totalCount;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toast.error(this.transloco.translate('resellerDashboard.loadError'));
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

  toggleInventoryManagement(restaurant: RestaurantStatisticDTO): void {
    const next = !restaurant.inventoryManagementEnabled;
    this.inventoryToggleId = restaurant.restaurantId;
    this.reseller
      .setInventoryManagement(restaurant.restaurantId, next)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          restaurant.inventoryManagementEnabled = res.inventoryManagementEnabled;
          this.inventoryToggleId = null;
          this.toast.success(
            this.transloco.translate(
              res.inventoryManagementEnabled
                ? 'resellerDashboard.inventoryEnabledMsg'
                : 'resellerDashboard.inventoryDisabledMsg',
              { name: restaurant.restaurantName },
            ),
          );
        },
        error: () => {
          this.inventoryToggleId = null;
          this.toast.error(this.transloco.translate('resellerDashboard.inventoryToggleError'));
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
