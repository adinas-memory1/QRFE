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
import { FormArray, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, Subject, switchMap, takeUntil } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService } from '../../../core/auth/auth.service';
import { RecipeInventoryService } from '../../../core/services/recipe-inventory/recipe-inventory.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import {
  INGREDIENT_ALLERGEN_CODES,
  INVENTORY_COSTING_OPTIONS,
  IngredientDto,
  StockItemDto,
  StockReceiptDto,
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
  showNirModal = false;
  catalogForm: FormGroup;
  receiptForm: FormGroup;
  nirForm: FormGroup;
  editingIngredientId: string | null = null;
  receipts: StockReceiptDto[] = [];
  receiptsLoading = false;
  lastCreatedReceipt: StockReceiptDto | null = null;
  nirError: string | null = null;
  nirSaving = false;
  showInactiveIngredients = false;

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
      initialQuantity: [null as number | null, [Validators.min(0)]],
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
    this.nirForm = this.fb.group({
      supplier: [''],
      invoiceNumber: [''],
      receivedOn: [''],
      note: [''],
      lines: this.fb.array([this.createNirLineGroup()]),
    });
  }

  get nirLines(): FormArray {
    return this.nirForm.get('lines') as FormArray;
  }

  /** Only active ingredients in NIR / receipt pickers. */
  get pickableIngredients(): IngredientDto[] {
    return this.ingredients.filter((i) => i.isActive);
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
    this.loadReceipts();
    this.api
      .listIngredients(this.restaurantId, this.showInactiveIngredients)
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
            if (!refreshed || (!this.showInactiveIngredients && !refreshed.isActive)) {
              this.selected = null;
              this.lots = [];
            } else {
              this.selected = refreshed;
              this.loadLots(this.selected.ingredientId);
            }
          }
        },
        error: () => {
          this.loading = false;
          this.toast.error(this.transloco.translate('stock.loadError'));
        },
      });
  }

  loadReceipts(): void {
    if (!this.restaurantId) return;
    this.receiptsLoading = true;
    this.api
      .listStockReceipts(this.restaurantId, { take: 20 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.receipts = rows ?? [];
          this.receiptsLoading = false;
        },
        error: () => {
          this.receiptsLoading = false;
        },
      });
  }

  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    const base = this.showInactiveIngredients
      ? this.ingredients
      : this.ingredients.filter((i) => i.isActive);
    this.filtered = !term
      ? [...base]
      : base.filter((i) => i.name.toLowerCase().includes(term));
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
      initialQuantity: null,
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
      initialQuantity: number | null;
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

    if (this.editingIngredientId) {
      this.api
        .updateIngredient(this.restaurantId, this.editingIngredientId, {
          ...body,
          isActive: raw.isActive,
        })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.showCatalogModal = false;
            this.toast.success(this.transloco.translate('stock.saved'));
            this.reload();
          },
          error: () => this.toast.error(this.transloco.translate('stock.saveError')),
        });
      return;
    }

    const initialQty = Number(raw.initialQuantity);
    const hasInitialStock = Number.isFinite(initialQty) && initialQty > 0;

    this.api
      .createIngredient(this.restaurantId, body)
      .pipe(
        switchMap((created) => {
          if (!hasInitialStock) return of(created);
          return this.api.receiveStock(this.restaurantId!, created.ingredientId, {
            quantity: initialQty,
            unitOfMeasure: raw.unitOfMeasure,
            unitPrice: 0,
            vatPercent: 19,
            note: this.transloco.translate('stock.initialStockReceiptNote'),
          });
        }),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: () => {
          this.showCatalogModal = false;
          this.toast.success(this.transloco.translate('stock.saved'));
          this.reload();
        },
        error: () => this.toast.error(this.transloco.translate('stock.saveError')),
      });
  }

  deleteIngredient(row: IngredientDto): void {
    if (!this.restaurantId || !row.isActive) return;
    const ok = window.confirm(
      this.transloco.translate('stock.confirmDeleteIngredient', { name: row.name }),
    );
    if (!ok) return;

    this.api
      .deactivateIngredient(this.restaurantId, row.ingredientId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (this.selected?.ingredientId === row.ingredientId) {
            this.selected = null;
            this.lots = [];
          }
          this.ingredients = this.ingredients.filter((i) => i.ingredientId !== row.ingredientId);
          this.applyFilter();
          this.toast.success(this.transloco.translate('stock.ingredientDeleted'));
        },
        error: () => this.toast.error(this.transloco.translate('stock.saveError')),
      });
  }

  reactivateIngredient(row: IngredientDto): void {
    if (!this.restaurantId || row.isActive) return;
    this.api
      .updateIngredient(this.restaurantId, row.ingredientId, {
        name: row.name,
        unitOfMeasure: normalizeUom(row.unitOfMeasure),
        isActive: true,
        allergens: [...(row.allergens ?? [])],
        yieldPercent: row.yieldPercent ?? null,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast.success(this.transloco.translate('stock.ingredientReactivated'));
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

  openNir(): void {
    while (this.nirLines.length > 0) this.nirLines.removeAt(0);
    this.nirLines.push(this.createNirLineGroup(this.selected?.ingredientId));
    this.nirForm.patchValue({
      supplier: '',
      invoiceNumber: '',
      receivedOn: new Date().toISOString().slice(0, 10),
      note: '',
    });
    this.lastCreatedReceipt = null;
    this.nirError = null;
    this.nirSaving = false;
    this.showNirModal = true;
  }

  createNirLineGroup(ingredientId?: string | null): FormGroup {
    const ingredient = ingredientId
      ? this.ingredients.find((i) => i.ingredientId === ingredientId)
      : null;
    return this.fb.group({
      ingredientId: [ingredient?.ingredientId ?? ''],
      quantity: [1],
      unitOfMeasure: [normalizeUom(ingredient?.unitOfMeasure ?? 4)],
      unitPrice: [ingredient?.weightedAverageUnitCost ?? ingredient?.unitCostAmount ?? 0],
      totalPrice: [null as number | null],
      vatPercent: [19],
      vatInclusive: [false],
      lotNumber: [''],
      expiryDate: [''],
      note: [''],
    });
  }

  addNirLine(): void {
    this.nirLines.push(this.createNirLineGroup());
  }

  removeNirLine(index: number): void {
    if (this.nirLines.length <= 1) return;
    this.nirLines.removeAt(index);
  }

  onNirIngredientChange(index: number, event: Event): void {
    const group = this.nirLines.at(index) as FormGroup;
    const id = String((event.target as HTMLSelectElement).value ?? '');
    group.get('ingredientId')?.setValue(id, { emitEvent: false });
    const ingredient = this.ingredients.find((i) => i.ingredientId === id);
    if (!ingredient) return;
    group.patchValue({
      unitOfMeasure: normalizeUom(ingredient.unitOfMeasure),
      unitPrice: ingredient.weightedAverageUnitCost ?? ingredient.unitCostAmount ?? 0,
    });
  }

  saveNir(): void {
    if (!this.restaurantId || this.nirSaving || this.lastCreatedReceipt) return;
    this.nirError = null;

    const raw = this.nirForm.getRawValue() as {
      supplier: string;
      invoiceNumber: string;
      receivedOn: string;
      note: string;
      lines: Array<{
        ingredientId: string;
        quantity: number | string | null;
        unitOfMeasure: number | string | null;
        unitPrice: number | string | null;
        totalPrice: number | string | null;
        vatPercent: number | string | null;
        vatInclusive: boolean;
        lotNumber: string;
        expiryDate: string;
        note: string;
      }>;
    };

    const lines: Array<{
      ingredientId: string;
      quantity: number;
      unitOfMeasure: number;
      unitPrice: number | null;
      totalPrice: number | null;
      vatPercent: number;
      vatInclusive: boolean;
      lotNumber: string | null;
      expiryDate: string | null;
      note: string | null;
    }> = [];
    for (const l of raw.lines ?? []) {
      const ingredientId = String(l.ingredientId ?? '').trim();
      if (!ingredientId) continue;

      const quantity = Number(l.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        this.nirError = this.transloco.translate('stock.nirInvalid');
        return;
      }

      const totalRaw = l.totalPrice;
      const hasTotal = totalRaw != null && String(totalRaw).trim() !== '';
      const unitRaw = l.unitPrice;
      const unitPrice = hasTotal
        ? null
        : Number(unitRaw == null || String(unitRaw).trim() === '' ? 0 : unitRaw);
      const totalPrice = hasTotal ? Number(totalRaw) : null;

      if (hasTotal && (!Number.isFinite(totalPrice!) || totalPrice! < 0)) {
        this.nirError = this.transloco.translate('stock.nirInvalid');
        return;
      }
      if (!hasTotal && (!Number.isFinite(unitPrice!) || unitPrice! < 0)) {
        this.nirError = this.transloco.translate('stock.nirInvalid');
        return;
      }

      lines.push({
        ingredientId,
        quantity,
        unitOfMeasure: Number(l.unitOfMeasure ?? 4),
        unitPrice,
        totalPrice,
        vatPercent: Number(l.vatPercent ?? 19),
        vatInclusive: !!l.vatInclusive,
        lotNumber: l.lotNumber || null,
        expiryDate: l.expiryDate || null,
        note: l.note || null,
      });
    }

    if (lines.length === 0) {
      this.nirError = this.transloco.translate('stock.pickIngredientRequired');
      return;
    }

    this.nirSaving = true;
    this.api
      .createStockReceipt(this.restaurantId, {
        supplier: raw.supplier || null,
        invoiceNumber: raw.invoiceNumber || null,
        receivedOn: raw.receivedOn || null,
        note: raw.note || null,
        lines,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (receipt) => {
          this.nirSaving = false;
          this.lastCreatedReceipt = receipt;
          this.nirError = null;
          this.toast.success(
            this.transloco.translate('stock.nirSaved', { number: receipt.documentNumber }),
          );
          this.reload();
        },
        error: (err: { error?: { error?: string }; message?: string }) => {
          this.nirSaving = false;
          const apiMsg =
            typeof err?.error?.error === 'string'
              ? err.error.error
              : this.transloco.translate('stock.saveError');
          this.nirError = apiMsg;
          this.toast.error(apiMsg);
        },
      });
  }

  downloadNirPdf(receipt: StockReceiptDto): void {
    if (!this.restaurantId) return;
    this.api
      .downloadStockReceiptPdf(this.restaurantId, receipt.stockReceiptId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `NIR-${receipt.documentNumber}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => this.toast.error(this.transloco.translate('stock.pdfError')),
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
