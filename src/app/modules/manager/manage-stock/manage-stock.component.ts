import { Component, OnDestroy, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  ButtonDirective,
  ButtonCloseDirective,
  CardBodyComponent,
  CardComponent,
  CardHeaderComponent,
  FormControlDirective,
  FormLabelDirective,
  FormSelectDirective,
  ModalBodyComponent,
  ModalComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
} from '@coreui/angular';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService } from '../../../core/auth/auth.service';
import { RecipeInventoryService } from '../../../core/services/recipe-inventory/recipe-inventory.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import {
  INGREDIENT_ALLERGEN_CODES,
  INVENTORY_COSTING_OPTIONS,
  IngredientDto,
  StockItemDto,
  UNIT_OF_MEASURE_OPTIONS,
  normalizeCostingMethod,
  normalizeUom,
} from '../../../core/models/recipe/recipe.models';

@Component({
  selector: 'app-manage-stock',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    TranslocoPipe,
    DecimalPipe,
    ButtonDirective,
    CardComponent,
    CardHeaderComponent,
    CardBodyComponent,
    FormControlDirective,
    FormLabelDirective,
    FormSelectDirective,
    ModalComponent,
    ModalHeaderComponent,
    ModalTitleDirective,
    ButtonCloseDirective,
    ModalBodyComponent,
    ModalFooterComponent,
  ],
  templateUrl: './manage-stock.component.html',
  styleUrls: ['./manage-stock.component.scss'],
})
export class ManageStockComponent implements OnInit, OnDestroy {
  readonly uomOptions = UNIT_OF_MEASURE_OPTIONS;
  readonly costingOptions = INVENTORY_COSTING_OPTIONS;
  readonly allergenCodes = INGREDIENT_ALLERGEN_CODES;

  restaurantId: string | null = null;
  restaurantCurrency = 'RON';
  ingredients: IngredientDto[] = [];
  filtered: IngredientDto[] = [];
  searchTerm = '';
  loading = false;
  costingMethod = 0;
  costingSaving = false;

  selected: IngredientDto | null = null;
  lots: StockItemDto[] = [];
  lotsLoading = false;

  showCatalogModal = false;
  showReceiptModal = false;
  catalogForm: FormGroup;
  receiptForm: FormGroup;
  editingIngredientId: string | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly fb: FormBuilder,
    private readonly auth: AuthService,
    private readonly api: RecipeInventoryService,
    private readonly toast: AppToastService,
    private readonly transloco: TranslocoService,
  ) {
    this.catalogForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      unitOfMeasure: [4, Validators.required],
      yieldPercent: [null as number | null],
      allergens: [[] as string[]],
      isActive: [true],
    });
    this.receiptForm = this.fb.group({
      quantity: [1, [Validators.required, Validators.min(0.0001)]],
      unitOfMeasure: [4],
      unitPrice: [0, [Validators.min(0)]],
      totalPrice: [null as number | null],
      vatPercent: [19, [Validators.min(0), Validators.max(100)]],
      vatInclusive: [false],
      lotNumber: [''],
      supplier: [''],
      purchaseDate: [''],
      expiryDate: [''],
      note: [''],
    });
  }

  ngOnInit(): void {
    const id = this.auth.getUserRestaurantId();
    this.restaurantId = Array.isArray(id) ? id[0] ?? null : id;
    if (!this.restaurantId) return;
    this.reload();
    this.api
      .getInventorySettings(this.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.costingMethod = normalizeCostingMethod(s.inventoryCostingMethod);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(): void {
    if (!this.restaurantId) return;
    this.loading = true;
    this.api
      .listIngredients(this.restaurantId, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.ingredients = rows ?? [];
          if (this.ingredients[0]?.unitCostCurrency != null) {
            this.restaurantCurrency = String(this.ingredients[0].unitCostCurrency);
          }
          this.applyFilter();
          this.loading = false;
          if (this.selected) {
            const refreshed = this.ingredients.find((i) => i.ingredientId === this.selected!.ingredientId);
            this.selected = refreshed ?? null;
            if (this.selected) this.loadLots(this.selected.ingredientId);
          }
        },
        error: () => {
          this.loading = false;
          this.toast.error(this.transloco.translate('stock.loadError'));
        },
      });
  }

  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filtered = !term
      ? [...this.ingredients]
      : this.ingredients.filter((i) => i.name.toLowerCase().includes(term));
  }

  selectIngredient(row: IngredientDto): void {
    this.selected = row;
    this.loadLots(row.ingredientId);
  }

  loadLots(ingredientId: string): void {
    if (!this.restaurantId) return;
    this.lotsLoading = true;
    this.api
      .listStockItems(this.restaurantId, ingredientId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (lots) => {
          this.lots = lots ?? [];
          this.lotsLoading = false;
        },
        error: () => {
          this.lotsLoading = false;
          this.toast.error(this.transloco.translate('stock.loadError'));
        },
      });
  }

  openCreateCatalog(): void {
    this.editingIngredientId = null;
    this.catalogForm.reset({
      name: '',
      unitOfMeasure: 4,
      yieldPercent: null,
      allergens: [],
      isActive: true,
    });
    this.showCatalogModal = true;
  }

  openEditCatalog(row: IngredientDto): void {
    this.editingIngredientId = row.ingredientId;
    this.catalogForm.reset({
      name: row.name,
      unitOfMeasure: normalizeUom(row.unitOfMeasure),
      yieldPercent: row.yieldPercent ?? null,
      allergens: [...(row.allergens ?? [])],
      isActive: row.isActive,
    });
    this.showCatalogModal = true;
  }

  saveCatalog(): void {
    if (!this.restaurantId || this.catalogForm.invalid) return;
    const raw = this.catalogForm.getRawValue() as {
      name: string;
      unitOfMeasure: number;
      yieldPercent: number | null;
      allergens: string[];
      isActive: boolean;
    };
    const body = {
      name: raw.name,
      unitOfMeasure: raw.unitOfMeasure,
      allergens: raw.allergens ?? [],
      yieldPercent: raw.yieldPercent,
    };
    const req = this.editingIngredientId
      ? this.api.updateIngredient(this.restaurantId, this.editingIngredientId, {
          ...body,
          isActive: raw.isActive,
        })
      : this.api.createIngredient(this.restaurantId, body);

    req.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.showCatalogModal = false;
        this.toast.success(this.transloco.translate('stock.saved'));
        this.reload();
      },
      error: () => this.toast.error(this.transloco.translate('stock.saveError')),
    });
  }

  openReceipt(): void {
    if (!this.selected) return;
    this.receiptForm.reset({
      quantity: 1,
      unitOfMeasure: normalizeUom(this.selected.unitOfMeasure),
      unitPrice: this.selected.weightedAverageUnitCost ?? this.selected.unitCostAmount ?? 0,
      totalPrice: null,
      vatPercent: 19,
      vatInclusive: false,
      lotNumber: '',
      supplier: '',
      purchaseDate: new Date().toISOString().slice(0, 10),
      expiryDate: '',
      note: '',
    });
    this.showReceiptModal = true;
  }

  saveReceipt(): void {
    if (!this.restaurantId || !this.selected || this.receiptForm.invalid) return;
    const raw = this.receiptForm.getRawValue();
    this.api
      .receiveStock(this.restaurantId, this.selected.ingredientId, {
        quantity: Number(raw.quantity),
        unitOfMeasure: Number(raw.unitOfMeasure),
        unitPrice: raw.totalPrice != null && raw.totalPrice !== '' ? null : Number(raw.unitPrice),
        totalPrice:
          raw.totalPrice != null && raw.totalPrice !== '' ? Number(raw.totalPrice) : null,
        vatPercent: Number(raw.vatPercent),
        vatInclusive: !!raw.vatInclusive,
        lotNumber: raw.lotNumber || null,
        supplier: raw.supplier || null,
        purchaseDate: raw.purchaseDate || null,
        expiryDate: raw.expiryDate || null,
        note: raw.note || null,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showReceiptModal = false;
          this.toast.success(this.transloco.translate('stock.receiptSaved'));
          this.reload();
        },
        error: () => this.toast.error(this.transloco.translate('stock.saveError')),
      });
  }

  saveCostingMethod(): void {
    if (!this.restaurantId) return;
    this.costingSaving = true;
    this.api
      .updateInventorySettings(this.restaurantId, {
        inventoryCostingMethod: this.costingMethod,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.costingMethod = normalizeCostingMethod(s.inventoryCostingMethod);
          this.costingSaving = false;
          this.toast.success(this.transloco.translate('stock.saved'));
        },
        error: () => {
          this.costingSaving = false;
          this.toast.error(this.transloco.translate('stock.saveError'));
        },
      });
  }

  hasAllergen(code: string): boolean {
    const list = (this.catalogForm.get('allergens')?.value as string[]) ?? [];
    return list.includes(code);
  }

  toggleAllergen(code: string, checked: boolean): void {
    const ctrl = this.catalogForm.get('allergens');
    const list = new Set((ctrl?.value as string[]) ?? []);
    if (checked) list.add(code);
    else list.delete(code);
    ctrl?.setValue([...list]);
  }

  uomLabel(value: string | number | undefined): string {
    const n = normalizeUom(value ?? 4);
    const opt = this.uomOptions.find((o) => o.value === n);
    return opt ? this.transloco.translate(opt.labelKey) : String(value ?? '');
  }

  allergenLabel(code: string): string {
    return this.transloco.translate(`recipes.allergens.${code}`);
  }
}
