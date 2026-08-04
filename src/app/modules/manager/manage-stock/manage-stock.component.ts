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
  StockReceiptDto,
  StockReceiptLineDto,
  StockReceiptLineUpdateInput,
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
  showNirModal = false;
  catalogForm: FormGroup;
  nirForm: FormGroup;
  editingIngredientId: string | null = null;
  receipts: StockReceiptDto[] = [];
  receiptsLoading = false;
  lastCreatedReceipt: StockReceiptDto | null = null;
  editingReceiptId: string | null = null;
  nirError: string | null = null;
  nirSaving = false;
  showInactiveIngredients = false;
  nirIngredientSearchByLine: Record<number, string> = {};
  nirIngredientDropdownOpen: number | null = null;
  selectedNirLineIndex: number | null = null;

  private nirLineSeq = 0;
  private focusIngredientIdAfterReload: string | null = null;
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

  /** Active catalog entries for NIR line pickers. */
  get pickableIngredients(): IngredientDto[] {
    return this.ingredients.filter((i) => i.isActive);
  }

  get costingColumnLabelKey(): string {
    return (
      this.costingOptions.find((o) => o.value === this.costingMethod)?.labelKey ??
      'stock.costing.cmp'
    );
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
          if (this.focusIngredientIdAfterReload) {
            const focusId = this.focusIngredientIdAfterReload;
            this.focusIngredientIdAfterReload = null;
            const focused = this.ingredients.find((i) => i.ingredientId === focusId);
            if (focused) {
              this.selected = focused;
              this.loadLots(focused.ingredientId);
            }
          } else if (this.selected) {
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

  private selectIngredientById(ingredientId: string): void {
    const row = this.ingredients.find((i) => i.ingredientId === ingredientId);
    if (row) {
      this.selected = row;
      this.loadLots(row.ingredientId);
    } else {
      this.focusIngredientIdAfterReload = ingredientId;
    }
  }

  filteredIngredientsForNirLine(lineIndex: number): IngredientDto[] {
    const term = (this.nirIngredientSearchByLine[lineIndex] ?? '').trim().toLowerCase();
    if (!term) return this.pickableIngredients.slice(0, 12);
    return this.pickableIngredients
      .filter((i) => i.name.toLowerCase().includes(term))
      .slice(0, 12);
  }

  onNirIngredientSearch(lineIndex: number, term: string): void {
    this.nirIngredientSearchByLine[lineIndex] = term;
    this.nirIngredientDropdownOpen = lineIndex;
    const group = this.nirLines.at(lineIndex) as FormGroup | null;
    group?.patchValue({ name: term, ingredientId: '' }, { emitEvent: false });
  }

  selectNirIngredientForLine(lineIndex: number, ingredient: IngredientDto): void {
    const group = this.nirLines.at(lineIndex) as FormGroup | null;
    if (!group || group.get('readOnly')?.value) return;
    group.patchValue({
      ingredientId: ingredient.ingredientId,
      name: ingredient.name,
      unitOfMeasure: normalizeUom(ingredient.unitOfMeasure),
      unitPrice: ingredient.weightedAverageUnitCost ?? ingredient.unitCostAmount ?? 0,
    });
    this.nirIngredientSearchByLine[lineIndex] = ingredient.name;
    this.nirIngredientDropdownOpen = null;
  }

  closeNirIngredientDropdown(): void {
    this.nirIngredientDropdownOpen = null;
  }

  selectNirLine(index: number): void {
    this.selectedNirLineIndex = index;
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

  openNir(): void {
    this.openNirForIngredient(this.selected?.ingredientId);
  }

  openNirForIngredient(ingredientId?: string | null): void {
    this.editingReceiptId = null;
    this.resetNirForm();
    const today = new Date().toISOString().slice(0, 10);
    this.nirLines.push(this.createNirLineGroup({ ingredientId, purchaseDate: today, lineIndex: 0 }));
    this.nirForm.patchValue({
      supplier: '',
      invoiceNumber: '',
      receivedOn: today,
      note: '',
    });
    this.lastCreatedReceipt = null;
    this.nirError = null;
    this.nirSaving = false;
    this.showNirModal = true;
  }

  openEditNir(receipt: StockReceiptDto): void {
    if (!this.restaurantId) return;
    this.editingReceiptId = receipt.stockReceiptId;
    this.lastCreatedReceipt = null;
    this.nirError = null;
    this.nirSaving = false;
    this.api
      .getStockReceipt(this.restaurantId, receipt.stockReceiptId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (full) => {
          this.resetNirForm();
          this.nirForm.patchValue({
            supplier: full.supplier ?? '',
            invoiceNumber: full.invoiceNumber ?? '',
            receivedOn: full.receivedOn ?? '',
            note: full.note ?? '',
          });
          for (const line of full.lines ?? []) {
            const index = this.nirLines.length;
            this.nirLines.push(this.createNirLineGroup({ line, readOnly: true, lineIndex: index }));
            this.nirIngredientSearchByLine[index] = line.ingredientName;
          }
          this.showNirModal = true;
        },
        error: () => this.toast.error(this.transloco.translate('stock.loadError')),
      });
  }

  private resetNirForm(): void {
    while (this.nirLines.length > 0) this.nirLines.removeAt(0);
    this.nirIngredientSearchByLine = {};
    this.nirIngredientDropdownOpen = null;
    this.selectedNirLineIndex = null;
  }

  createNirLineGroup(opts?: {
    ingredientId?: string | null;
    purchaseDate?: string;
    line?: StockReceiptLineDto;
    readOnly?: boolean;
    lineIndex?: number;
  }): FormGroup {
    const line = opts?.line;
    const ingredient = line
      ? this.ingredients.find((i) => i.ingredientId === line.ingredientId)
      : opts?.ingredientId
        ? this.ingredients.find((i) => i.ingredientId === opts.ingredientId)
        : null;
    const purchase = line?.purchaseDate ?? opts?.purchaseDate ?? new Date().toISOString().slice(0, 10);
    const readOnly = opts?.readOnly ?? false;
    if (ingredient && !line && opts?.lineIndex != null) {
      this.nirIngredientSearchByLine[opts.lineIndex] = ingredient.name;
    }
    return this.fb.group({
      lineKey: [++this.nirLineSeq],
      stockReceiptLineId: [line?.stockReceiptLineId ?? ''],
      readOnly: [readOnly],
      ingredientId: [line?.ingredientId ?? ingredient?.ingredientId ?? ''],
      name: [line?.ingredientName ?? ingredient?.name ?? ''],
      quantity: [{ value: line?.quantity ?? 1, disabled: readOnly }],
      unitOfMeasure: [{ value: normalizeUom(line?.unitOfMeasure ?? ingredient?.unitOfMeasure ?? 4), disabled: readOnly }],
      unitPrice: [{ value: line?.unitPrice ?? ingredient?.weightedAverageUnitCost ?? ingredient?.unitCostAmount ?? 0, disabled: readOnly }],
      totalPrice: [{ value: line?.lineTotal ?? null, disabled: readOnly }],
      vatPercent: [{ value: line?.vatPercent ?? 19, disabled: readOnly }],
      lotNumber: [line?.lotNumber ?? ''],
      purchaseDate: [line?.purchaseDate ?? purchase],
      expiryDate: [line?.expiryDate ?? ''],
      note: [line?.note ?? ''],
    });
  }

  addNirLine(): void {
    if (this.editingReceiptId) return;
    const receivedOn = String(this.nirForm.get('receivedOn')?.value ?? '');
    this.nirLines.push(this.createNirLineGroup({ purchaseDate: receivedOn || undefined, lineIndex: this.nirLines.length }));
    this.selectedNirLineIndex = this.nirLines.length - 1;
  }

  removeNirLine(index: number): void {
    if (this.editingReceiptId || this.nirLines.length <= 1) return;
    this.nirLines.removeAt(index);
    const nextSearch: Record<number, string> = {};
    for (let i = 0; i < this.nirLines.length; i++) {
      const g = this.nirLines.at(i) as FormGroup;
      nextSearch[i] = this.nirIngredientSearchByLine[i >= index ? i + 1 : i] ?? String(g.get('name')?.value ?? '');
    }
    this.nirIngredientSearchByLine = nextSearch;
    this.selectedNirLineIndex = Math.min(index, this.nirLines.length - 1);
  }

  removeSelectedNirLine(): void {
    if (this.selectedNirLineIndex == null) return;
    this.removeNirLine(this.selectedNirLineIndex);
  }

  saveNir(): void {
    if (!this.restaurantId || this.nirSaving) return;
    if (!this.editingReceiptId && this.lastCreatedReceipt) return;
    this.nirError = null;

    const raw = this.nirForm.getRawValue() as {
      supplier: string;
      invoiceNumber: string;
      receivedOn: string;
      note: string;
      lines: Array<{
        stockReceiptLineId: string;
        readOnly: boolean;
        ingredientId: string;
        quantity: number | string | null;
        unitOfMeasure: number | string | null;
        unitPrice: number | string | null;
        totalPrice: number | string | null;
        vatPercent: number | string | null;
        lotNumber: string;
        purchaseDate: string;
        expiryDate: string;
        note: string;
      }>;
    };

    if (this.editingReceiptId) {
      const updateLines: StockReceiptLineUpdateInput[] = [];
      for (const l of raw.lines ?? []) {
        const stockReceiptLineId = String(l.stockReceiptLineId ?? '').trim();
        if (!stockReceiptLineId) continue;
        updateLines.push({
          stockReceiptLineId,
          lotNumber: l.lotNumber?.trim() || null,
          purchaseDate: l.purchaseDate || raw.receivedOn || null,
          expiryDate: l.expiryDate || null,
          note: l.note?.trim() || null,
        });
      }
      if (updateLines.length === 0) {
        this.nirError = this.transloco.translate('stock.nirInvalid');
        return;
      }

      this.nirSaving = true;
      this.api
        .updateStockReceipt(this.restaurantId, this.editingReceiptId, {
          supplier: raw.supplier || null,
          invoiceNumber: raw.invoiceNumber || null,
          receivedOn: raw.receivedOn || null,
          note: raw.note || null,
          lines: updateLines,
        })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (receipt) => {
            this.nirSaving = false;
            this.nirError = null;
            this.showNirModal = false;
            this.editingReceiptId = null;
            this.toast.success(
              this.transloco.translate('stock.nirUpdated', { number: receipt.documentNumber }),
            );
            const focusId = receipt.lines?.[0]?.ingredientId;
            if (focusId) {
              this.focusIngredientIdAfterReload = focusId;
              this.selectIngredientById(focusId);
            }
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
      return;
    }

    const lines: Array<{
      ingredientId: string;
      quantity: number;
      unitOfMeasure: number;
      unitPrice: number | null;
      totalPrice: number | null;
      vatPercent: number;
      lotNumber: string | null;
      purchaseDate: string | null;
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
      const totalNum =
        totalRaw == null || String(totalRaw).trim() === '' ? null : Number(totalRaw);
      const hasTotal = totalNum != null && Number.isFinite(totalNum) && totalNum > 0;
      const unitRaw = l.unitPrice;
      const unitPrice = hasTotal
        ? null
        : Number(unitRaw == null || String(unitRaw).trim() === '' ? 0 : unitRaw);
      const totalPrice = hasTotal ? totalNum! : null;

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
        lotNumber: l.lotNumber?.trim() || null,
        purchaseDate: l.purchaseDate || raw.receivedOn || null,
        expiryDate: l.expiryDate || null,
        note: l.note?.trim() || null,
      });
    }

    if (lines.length === 0) {
      this.nirError = this.transloco.translate('stock.pickIngredientRequired');
      return;
    }

    const focusIngredientId = lines[0]?.ingredientId ?? null;
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
          if (focusIngredientId) {
            this.focusIngredientIdAfterReload = focusIngredientId;
            this.selectIngredientById(focusIngredientId);
          }
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

  lotStatus(lot: StockItemDto): 'active' | 'depleted' {
    return lot.remainingQty > 0 ? 'active' : 'depleted';
  }
}
