import { Component, OnDestroy, OnInit } from '@angular/core';
import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import {
  AccordionButtonDirective,
  AccordionComponent,
  AccordionItemComponent,
  ButtonDirective,
  ButtonCloseDirective,
  CardBodyComponent,
  CardComponent,
  CardHeaderComponent,
  FormCheckInputDirective,
  FormControlDirective,
  FormLabelDirective,
  FormSelectDirective,
  ModalBodyComponent,
  ModalComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
  TemplateIdDirective,
} from '@coreui/angular';
import { Subject, takeUntil } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FormsModule, ReactiveFormsModule, FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { MenuItemServiceService } from '../../../core/services/menu-item-service/menu-item-service.service';
import { RecipeInventoryService } from '../../../core/services/recipe-inventory/recipe-inventory.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { MenuItem } from '../../../core/models/menu/menuItem';
import {
  canonicalMenuItemCategory,
  mergeManagementCategories,
} from '../../../core/models/menu/menu-item-categories';
import {
  IngredientConsumptionRow,
  INGREDIENT_ALLERGEN_CODES,
  ExpiringIngredientDto,
  LowStockIngredientDto,
  RecipeDto,
  UNIT_OF_MEASURE_OPTIONS,
  canConvertUom,
  effectiveQtyInStockUom,
  normalizeIngredientName,
  normalizeUom,
  splitVat,
  suggestedPriceFromMargin,
} from '../../../core/models/recipe/recipe.models';

type TabId = 'menu' | 'consumption' | 'stockAlerts' | 'expiryAlerts';
const EXPIRY_ALERT_DAYS_AHEAD = 10;

@Component({
  selector: 'app-manage-recipes',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    FormsModule,
    ReactiveFormsModule,
    TranslocoPipe,
    DecimalPipe,
    ButtonDirective,
    CardComponent,
    CardHeaderComponent,
    CardBodyComponent,
    FormCheckInputDirective,
    FormControlDirective,
    FormLabelDirective,
    FormSelectDirective,
    ModalComponent,
    ModalHeaderComponent,
    ModalTitleDirective,
    ButtonCloseDirective,
    ModalBodyComponent,
    ModalFooterComponent,
    AccordionComponent,
    AccordionItemComponent,
    AccordionButtonDirective,
    TemplateIdDirective,
  ],
  templateUrl: './manage-recipes.component.html',
  styleUrls: ['./manage-recipes.component.scss'],
})
export class ManageRecipesComponent implements OnInit, OnDestroy {
  readonly uomOptions = UNIT_OF_MEASURE_OPTIONS;
  readonly allergenCodes = INGREDIENT_ALLERGEN_CODES;
  activeTab: TabId = 'menu';
  restaurantId: string | null = null;
  restaurantCurrency = 'RON';
  menuItems: MenuItem[] = [];
  categories: string[] = [];
  groupedMenuItems: { [category: string]: MenuItem[] } = {};
  /** menuItemId -> portions remaining (only loaded for opened accordion categories). */
  portionsByMenuItemId: Record<string, number | null | undefined> = {};
  selectedMenuItemId = '';
  selectedLineIndex: number | null = null;
  recipe: RecipeDto | null = null;
  consumption: IngredientConsumptionRow[] = [];
  lowStockAlerts: LowStockIngredientDto[] = [];
  expiryAlerts: ExpiringIngredientDto[] = [];
  alertsLoading = false;
  desiredMarginPercent: number | null = null;

  recipeForm: FormGroup;
  consumptionForm: FormGroup;

  showRecipeModal = false;

  private readonly destroy$ = new Subject<void>();
  private readonly loadedPortionCategories = new Set<string>();

  constructor(
    private readonly fb: FormBuilder,
    private readonly auth: AuthService,
    private readonly recipesApi: RecipeInventoryService,
    private readonly menuApi: MenuItemServiceService,
    private readonly toast: AppToastService,
    private readonly transloco: TranslocoService,
  ) {
    this.recipeForm = this.fb.group({
      lines: this.fb.array([]),
    });
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    this.consumptionForm = this.fb.group({
      startDate: [weekAgo.toISOString().slice(0, 10), Validators.required],
      endDate: [today.toISOString().slice(0, 10), Validators.required],
    });
  }

  get recipeLines(): FormArray {
    return this.recipeForm.get('lines') as FormArray;
  }

  get selectedMenuItem(): MenuItem | undefined {
    return this.menuItems.find((m) => m.menuItemId === this.selectedMenuItemId);
  }

  get selectedMenuItemName(): string {
    return this.recipe?.menuItemName ?? this.selectedMenuItem?.menuItemName ?? '';
  }

  get selectedMenuItemVatPercent(): number {
    return this.recipe?.menuItemVatPercent
      ?? this.selectedMenuItem?.menuItemVatPercent
      ?? 19;
  }

  /** Sum of line costs ex-VAT (qty converted to stock UOM, with yield). */
  get portionCostExVat(): number {
    return this.recipeLines.controls.reduce((sum, ctrl) => {
      const g = ctrl as FormGroup;
      const raw = g.getRawValue() as LineFormValue;
      return sum + this.computeLineCost(raw, 'exVat');
    }, 0);
  }

  get suggestedSellPrice(): number | null {
    if (this.desiredMarginPercent == null || this.desiredMarginPercent < 0 || this.desiredMarginPercent >= 100) {
      return null;
    }
    return suggestedPriceFromMargin(this.portionCostExVat, this.desiredMarginPercent);
  }

  get selectedMenuItemPrice(): number | null {
    const price = this.recipe?.menuItemPriceAmount ?? this.selectedMenuItem?.menuItemPriceAmount;
    return price != null && price > 0 ? Number(price) : null;
  }

  /** Food cost % from live form costs vs menu item sell price. */
  get liveFoodCostPercent(): number | null {
    const price = this.selectedMenuItemPrice;
    if (price == null || price <= 0) return null;
    return Math.round((this.portionCostExVat / price) * 10000) / 100;
  }

  /** Min portions remaining from live stock / effective qty per line. */
  get livePortionsRemaining(): number | null {
    if (this.recipeLines.length === 0) return null;
    let min: number | null = null;
    for (const ctrl of this.recipeLines.controls) {
      const raw = (ctrl as FormGroup).getRawValue() as LineFormValue;
      const recipeUom = Number(raw.unitOfMeasure);
      const stockUom = Number(raw.stockUnitOfMeasure ?? raw.unitOfMeasure);
      if (!canConvertUom(recipeUom, stockUom)) continue;
      const effectiveQty = effectiveQtyInStockUom(
        Number(raw.quantity) || 0,
        recipeUom,
        stockUom,
        raw.yieldPercent,
      );
      if (effectiveQty <= 0) continue;
      const portions = Math.floor((Number(raw.currentStockQty) || 0) / effectiveQty);
      min = min == null ? portions : Math.min(min, portions);
    }
    return min;
  }

  ngOnInit(): void {
    const id = this.auth.getUserRestaurantId();
    this.restaurantId = Array.isArray(id) ? id[0] ?? null : id;
    if (!this.restaurantId) {
      return;
    }
    this.reloadMenuItems();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: TabId): void {
    this.activeTab = tab;
    if (tab === 'stockAlerts') {
      this.loadLowStockAlerts();
    } else if (tab === 'expiryAlerts') {
      this.loadExpiryAlerts();
    }
  }

  loadLowStockAlerts(): void {
    if (!this.restaurantId) return;
    this.alertsLoading = true;
    this.recipesApi
      .listLowStockIngredients(this.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.lowStockAlerts = rows ?? [];
          this.alertsLoading = false;
        },
        error: () => {
          this.alertsLoading = false;
          this.toast.error(this.transloco.translate('recipes.loadError'));
        },
      });
  }

  loadExpiryAlerts(): void {
    if (!this.restaurantId) return;
    this.alertsLoading = true;
    this.recipesApi
      .listExpiringIngredients(this.restaurantId, EXPIRY_ALERT_DAYS_AHEAD)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.expiryAlerts = rows ?? [];
          this.alertsLoading = false;
        },
        error: () => {
          this.alertsLoading = false;
          this.toast.error(this.transloco.translate('recipes.loadError'));
        },
      });
  }

  onCategoryAccordionToggle(cat: string, accordionItem: { visible: boolean; toggleItem: () => void }): void {
    const willOpen = !accordionItem.visible;
    accordionItem.toggleItem();
    if (willOpen) {
      this.loadPortionsForCategory(cat);
    }
  }

  loadPortionsForCategory(cat: string): void {
    if (!this.restaurantId || this.loadedPortionCategories.has(cat)) {
      return;
    }
    const items = this.groupedMenuItems[cat] ?? [];
    const ids = items.map((i) => i.menuItemId).filter(Boolean);
    if (ids.length === 0) {
      this.loadedPortionCategories.add(cat);
      return;
    }

    this.recipesApi
      .getPortionsRemaining(this.restaurantId, ids)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          const next = { ...this.portionsByMenuItemId };
          for (const id of ids) {
            next[id] = null;
          }
          for (const row of rows ?? []) {
            next[row.menuItemId] = row.portionsRemaining;
          }
          this.portionsByMenuItemId = next;
          this.loadedPortionCategories.add(cat);
        },
        error: () => {
          // Leave badges empty for this category; allow retry on next open.
          this.loadedPortionCategories.delete(cat);
        },
      });
  }

  private invalidatePortionsCache(): void {
    this.loadedPortionCategories.clear();
    this.portionsByMenuItemId = {};
  }

  reloadMenuItems(): void {
    if (!this.restaurantId) return;
    const clientDate = new Date().toISOString().slice(0, 10);
    this.menuApi
      .getManagementMenu(this.restaurantId, clientDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = mergeManagementCategories(res?.categories);
          this.menuItems = (res.menu?.menuItems ?? [])
            .map((item) => ({
              ...item,
              category: canonicalMenuItemCategory(item.category),
            }))
            .filter((i) => i.category.toLowerCase() !== 'setmenu');
          if (this.menuItems[0]?.menuItemPriceCurrency) {
            this.restaurantCurrency = String(this.menuItems[0].menuItemPriceCurrency);
          }
          this.rebuildGroupedMenuItems();
          this.invalidatePortionsCache();
        },
        error: () => this.toast.error(this.transloco.translate('recipes.loadError')),
      });
  }

  private rebuildGroupedMenuItems(): void {
    this.groupedMenuItems = this.menuItems.reduce(
      (acc, item) => {
        const cat = canonicalMenuItemCategory(item.category);
        if (cat.toLowerCase() === 'setmenu') {
          return acc;
        }
        if (!acc[cat]) {
          acc[cat] = [];
        }
        acc[cat].push(item);
        return acc;
      },
      {} as { [category: string]: MenuItem[] },
    );
  }

  openRecipeForMenuItem(item: MenuItem): void {
    this.selectedMenuItemId = item.menuItemId;
    this.selectedLineIndex = null;
    this.desiredMarginPercent = null;
    this.showRecipeModal = true;
    this.loadRecipe();
  }

  onRecipeModalVisible(visible: boolean): void {
    this.showRecipeModal = visible;
    if (!visible) {
      this.selectedMenuItemId = '';
      this.selectedLineIndex = null;
      this.recipe = null;
      this.recipeLines.clear();
      this.desiredMarginPercent = null;
    }
  }

  closeRecipeModal(): void {
    this.showRecipeModal = false;
    this.onRecipeModalVisible(false);
  }

  selectLine(index: number): void {
    this.selectedLineIndex = index;
  }

  loadRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId) {
      this.recipe = null;
      return;
    }
    this.recipesApi
      .getRecipe(this.restaurantId, this.selectedMenuItemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (recipe) => {
          this.recipe = recipe;
          if (recipe.menuItemPriceCurrency != null) {
            this.restaurantCurrency = this.currencyCode(recipe.menuItemPriceCurrency);
          }
          this.recipeLines.clear();
          for (const line of recipe.lines ?? []) {
            this.recipeLines.push(this.createLineGroup({
              ingredientId: line.ingredientId,
              name: line.ingredientName,
              unitOfMeasure: normalizeUom(line.unitOfMeasure),
              stockUnitOfMeasure: normalizeUom(line.stockUnitOfMeasure ?? line.unitOfMeasure),
              quantity: line.quantity,
              unitCostAmount: line.unitCostAmount,
              currentStockQty: line.currentStockQty,
              vatPercent: line.vatPercent ?? 19,
              vatInclusive: line.vatInclusive ?? false,
              allergens: [...(line.allergens ?? [])],
              yieldPercent: line.yieldPercent ?? null,
              lotNumber: line.lotNumber ?? '',
              expiryDate: line.expiryDate ?? '',
              purchaseDate: line.purchaseDate ?? '',
              supplier: line.supplier ?? '',
              lowStockAlertPercent: line.lowStockAlertPercent ?? null,
            }));
          }
          if (this.recipeLines.length === 0) {
            this.addRecipeLine();
          }
          this.selectedLineIndex = 0;
        },
        error: () => this.toast.error(this.transloco.translate('recipes.loadError')),
      });
  }

  private createLineGroup(values?: Partial<LineFormValue>): FormGroup {
    const recipeUom = values?.unitOfMeasure ?? 4;
    return this.fb.group({
      ingredientId: [values?.ingredientId ?? null],
      name: [values?.name ?? '', Validators.required],
      unitOfMeasure: [recipeUom, Validators.required],
      stockUnitOfMeasure: [values?.stockUnitOfMeasure ?? recipeUom, Validators.required],
      quantity: [values?.quantity ?? 1, [Validators.required, Validators.min(0.0001)]],
      unitCostAmount: [values?.unitCostAmount ?? 0, [Validators.required, Validators.min(0)]],
      currentStockQty: [values?.currentStockQty ?? 0, [Validators.required, Validators.min(0)]],
      vatPercent: [values?.vatPercent ?? 19, [Validators.required, Validators.min(0), Validators.max(100)]],
      vatInclusive: [values?.vatInclusive ?? false],
      allergens: [values?.allergens ?? []],
      yieldPercent: [values?.yieldPercent ?? null, [Validators.min(0.0001), Validators.max(1000)]],
      lotNumber: [values?.lotNumber ?? ''],
      expiryDate: [values?.expiryDate ?? ''],
      purchaseDate: [values?.purchaseDate ?? ''],
      supplier: [values?.supplier ?? ''],
      lowStockAlertPercent: [values?.lowStockAlertPercent ?? null, [Validators.min(0), Validators.max(100)]],
    });
  }

  addRecipeLine(): void {
    this.recipeLines.push(this.createLineGroup({
      vatPercent: this.selectedMenuItemVatPercent,
    }));
    this.selectedLineIndex = this.recipeLines.length - 1;
  }

  removeSelectedRecipeLine(): void {
    const idx = this.selectedLineIndex ?? this.recipeLines.length - 1;
    this.removeRecipeLine(idx);
  }

  removeRecipeLine(index: number): void {
    if (index < 0 || index >= this.recipeLines.length) {
      return;
    }
    this.recipeLines.removeAt(index);
    if (this.recipeLines.length === 0) {
      this.selectedLineIndex = null;
      return;
    }
    this.selectedLineIndex = Math.min(index, this.recipeLines.length - 1);
  }

  setVatInclusive(index: number, inclusive: boolean): void {
    const g = this.recipeLines.at(index) as FormGroup | null;
    g?.get('vatInclusive')?.setValue(inclusive);
  }

  lineCostExVat(index: number): number {
    const g = this.recipeLines.at(index) as FormGroup | null;
    if (!g) return 0;
    return this.computeLineCost(g.getRawValue() as LineFormValue, 'exVat');
  }

  lineCostIncVat(index: number): number {
    const g = this.recipeLines.at(index) as FormGroup | null;
    if (!g) return 0;
    return this.computeLineCost(g.getRawValue() as LineFormValue, 'incVat');
  }

  private computeLineCost(raw: LineFormValue, mode: 'exVat' | 'incVat'): number {
    const recipeUom = Number(raw.unitOfMeasure);
    const stockUom = Number(raw.stockUnitOfMeasure ?? raw.unitOfMeasure);
    if (!canConvertUom(recipeUom, stockUom)) {
      return 0;
    }
    const split = splitVat(Number(raw.unitCostAmount) || 0, Number(raw.vatPercent) || 0, !!raw.vatInclusive);
    const unit = mode === 'exVat' ? split.exVat : split.incVat;
    const qty = effectiveQtyInStockUom(
      Number(raw.quantity) || 0,
      recipeUom,
      stockUom,
      raw.yieldPercent,
    );
    return unit * qty;
  }

  isLineExpired(index: number): boolean {
    const g = this.recipeLines.at(index) as FormGroup | null;
    const expiry = g?.get('expiryDate')?.value as string | null | undefined;
    if (!expiry) return false;
    const today = new Date().toISOString().slice(0, 10);
    return expiry <= today;
  }

  toggleAllergen(index: number, code: string, checked: boolean): void {
    const g = this.recipeLines.at(index) as FormGroup;
    const current = [...((g.get('allergens')?.value as string[]) ?? [])];
    const next = checked
      ? Array.from(new Set([...current, code]))
      : current.filter((c) => c !== code);
    g.get('allergens')?.setValue(next);
  }

  hasAllergen(index: number, code: string): boolean {
    const g = this.recipeLines.at(index) as FormGroup | null;
    const list = (g?.get('allergens')?.value as string[]) ?? [];
    return list.includes(code);
  }

  saveRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId || this.recipeForm.invalid) return;
    const lines = this.recipeLines.getRawValue().map((l: LineFormValue) => ({
      ingredientId: l.ingredientId || undefined,
      name: normalizeIngredientName(l.name),
      unitOfMeasure: Number(l.unitOfMeasure),
      stockUnitOfMeasure: Number(l.stockUnitOfMeasure ?? l.unitOfMeasure),
      quantity: Number(l.quantity),
      unitCostAmount: Number(l.unitCostAmount),
      currentStockQty: Number(l.currentStockQty),
      vatPercent: Number(l.vatPercent),
      vatInclusive: !!l.vatInclusive,
      allergens: (l.allergens ?? []) as string[],
      yieldPercent: l.yieldPercent == null || l.yieldPercent === ('' as unknown) ? null : Number(l.yieldPercent),
      lotNumber: l.lotNumber?.trim() || null,
      expiryDate: l.expiryDate || null,
      purchaseDate: l.purchaseDate || null,
      supplier: l.supplier?.trim() || null,
      lowStockAlertPercent:
        l.lowStockAlertPercent == null || l.lowStockAlertPercent === ('' as unknown)
          ? null
          : Number(l.lowStockAlertPercent),
    }));

    if (lines.some((l) => !l.name || !canConvertUom(l.unitOfMeasure, l.stockUnitOfMeasure))) {
      this.toast.error(this.transloco.translate('recipes.saveError'));
      return;
    }

    this.recipesApi
      .upsertRecipe(this.restaurantId, this.selectedMenuItemId, lines)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (recipe) => {
          this.recipe = recipe;
          this.toast.success(this.transloco.translate('recipes.saved'));
          this.loadRecipe();
          this.portionsByMenuItemId = {
            ...this.portionsByMenuItemId,
            [this.selectedMenuItemId]: recipe.portionsRemaining ?? null,
          };
        },
        error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
      });
  }

  clearRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId) return;
    const menuItemId = this.selectedMenuItemId;
    this.recipesApi
      .deleteRecipe(this.restaurantId, menuItemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.recipe = null;
          this.recipeLines.clear();
          this.addRecipeLine();
          this.toast.success(this.transloco.translate('recipes.saved'));
          const next = { ...this.portionsByMenuItemId };
          delete next[menuItemId];
          this.portionsByMenuItemId = next;
        },
        error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
      });
  }

  loadConsumption(): void {
    if (!this.restaurantId || this.consumptionForm.invalid) return;
    const raw = this.consumptionForm.getRawValue();
    this.recipesApi
      .getConsumptionReport(this.restaurantId, raw.startDate, raw.endDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => (this.consumption = rows),
        error: () => this.toast.error(this.transloco.translate('recipes.loadError')),
      });
  }

  uomLabel(value: string | number): string {
    const n = normalizeUom(value);
    const opt = this.uomOptions.find((o) => o.value === n);
    return opt ? this.transloco.translate(opt.labelKey) : String(value);
  }

  allergenLabel(code: string): string {
    return this.transloco.translate(`recipes.allergens.${code}`);
  }

  currencyCode(value: string | number | null | undefined): string {
    if (value == null) return this.restaurantCurrency || 'RON';
    if (typeof value === 'string') return value;
    const map = ['USD', 'EUR', 'RON', 'GBP', 'SEK', 'NOK', 'DKK', 'JPY', 'CHF', 'AUD', 'CAD', 'CNY', 'INR', 'BRL'];
    return map[value] ?? (this.restaurantCurrency || 'RON');
  }
}

interface LineFormValue {
  ingredientId: string | null;
  name: string;
  unitOfMeasure: number;
  stockUnitOfMeasure: number;
  quantity: number;
  unitCostAmount: number;
  currentStockQty: number;
  vatPercent: number;
  vatInclusive: boolean;
  allergens: string[];
  yieldPercent: number | null;
  lotNumber: string;
  expiryDate: string;
  purchaseDate: string;
  supplier: string;
  lowStockAlertPercent: number | null;
}
