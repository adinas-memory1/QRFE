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
  IngredientDto,
  ExpiringIngredientDto,
  InventoryAlertSettingsDto,
  LowStockIngredientDto,
  RecipeDto,
  UNIT_OF_MEASURE_OPTIONS,
  canConvertUom,
  effectiveQtyInStockUom,
  normalizeUom,
  suggestedPriceFromMargin,
} from '../../../core/models/recipe/recipe.models';

type TabId = 'menu' | 'consumption' | 'stockAlerts' | 'expiryAlerts';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  alertSettingsLoading = false;
  alertSettingsSaving = false;
  desiredMarginPercent: number | null = null;
  applyingPrice = false;
  catalogIngredients: IngredientDto[] = [];
  ingredientSearchByLine: Record<number, string> = {};
  ingredientDropdownOpen: number | null = null;

  /** Restaurant-level alert settings (stock % / emails / expiry days). */
  stockAlertPercent: number | null = 20;
  stockAlertEmail = '';
  expiryAlertDaysAhead = 10;
  expiryAlertEmail = '';
  defaultManagerEmail: string | null = null;

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

  /** Sum of line costs ex-VAT (qty converted to stock UOM, with yield) using CMP. */
  get portionCostExVat(): number {
    return this.recipeLines.controls.reduce((sum, ctrl) => {
      const g = ctrl as FormGroup;
      const raw = g.getRawValue() as LineFormValue;
      return sum + this.computeLineCost(raw);
    }, 0);
  }

  /** Sum of line costs with VAT — recipe lines use CMP as ex-VAT unit cost. */
  get portionCostIncVat(): number {
    return this.portionCostExVat;
  }

  get suggestedSellPrice(): number | null {
    if (this.desiredMarginPercent == null || this.desiredMarginPercent < 0) {
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
    this.reloadCatalogIngredients();
    this.desiredMarginPercent = this.loadDesiredMarginPercent();
    this.recipesApi
      .getInventoryAlertSettings(this.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (settings) => this.applyAlertSettings(settings),
        error: () => {
          /* keep defaults; settings load again on alert tabs */
        },
      });
  }

  private reloadCatalogIngredients(): void {
    if (!this.restaurantId) return;
    this.recipesApi
      .listIngredients(this.restaurantId, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.catalogIngredients = rows ?? [];
        },
      });
  }

  filteredIngredientsForLine(lineIndex: number): IngredientDto[] {
    const term = (this.ingredientSearchByLine[lineIndex] ?? '').trim().toLowerCase();
    if (!term) return this.catalogIngredients.slice(0, 12);
    return this.catalogIngredients
      .filter((i) => i.name.toLowerCase().includes(term))
      .slice(0, 12);
  }

  onIngredientSearch(lineIndex: number, term: string): void {
    this.ingredientSearchByLine[lineIndex] = term;
    this.ingredientDropdownOpen = lineIndex;
    const g = this.recipeLines.at(lineIndex) as FormGroup | null;
    g?.patchValue({ name: term, ingredientId: null }, { emitEvent: false });
  }

  selectIngredientForLine(lineIndex: number, ingredient: IngredientDto): void {
    const g = this.recipeLines.at(lineIndex) as FormGroup | null;
    if (!g) return;
    g.patchValue({
      ingredientId: ingredient.ingredientId,
      name: ingredient.name,
      stockUnitOfMeasure: normalizeUom(ingredient.unitOfMeasure),
      unitCostAmount: ingredient.weightedAverageUnitCost ?? ingredient.unitCostAmount ?? 0,
      currentStockQty: ingredient.currentStockQty,
      yieldPercent: ingredient.yieldPercent ?? null,
    });
    this.ingredientSearchByLine[lineIndex] = ingredient.name;
    this.ingredientDropdownOpen = null;
  }

  closeIngredientDropdown(): void {
    this.ingredientDropdownOpen = null;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: TabId): void {
    this.activeTab = tab;
    if (tab === 'stockAlerts') {
      this.loadAlertSettingsThen(() => this.loadLowStockAlerts());
    } else if (tab === 'expiryAlerts') {
      this.loadAlertSettingsThen(() => this.loadExpiryAlerts());
    }
  }

  private loadAlertSettingsThen(after: () => void): void {
    if (!this.restaurantId) return;
    this.alertSettingsLoading = true;
    this.recipesApi
      .getInventoryAlertSettings(this.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (settings) => {
          this.applyAlertSettings(settings);
          this.alertSettingsLoading = false;
          after();
        },
        error: () => {
          this.alertSettingsLoading = false;
          this.toast.error(this.transloco.translate('recipes.loadError'));
          after();
        },
      });
  }

  private applyAlertSettings(settings: InventoryAlertSettingsDto): void {
    this.defaultManagerEmail =
      settings.defaultManagerEmail?.trim()
      || this.auth.getUserSnapshot()?.email?.trim()
      || null;
    this.stockAlertPercent =
      settings.lowStockAlertPercent == null ? 20 : Number(settings.lowStockAlertPercent);
    this.expiryAlertDaysAhead =
      settings.expiryAlertDaysAhead == null ? 10 : Number(settings.expiryAlertDaysAhead);
    this.stockAlertEmail = (settings.lowStockAlertEmail?.trim() || this.defaultManagerEmail || '');
    this.expiryAlertEmail = (settings.expiryAlertEmail?.trim() || this.defaultManagerEmail || '');
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
      .listExpiringIngredients(this.restaurantId, this.expiryAlertDaysAhead)
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

  saveStockAlertSettings(): void {
    this.saveAlertSettings('stock');
  }

  saveExpiryAlertSettings(): void {
    this.saveAlertSettings('expiry');
  }

  private saveAlertSettings(scope: 'stock' | 'expiry'): void {
    if (!this.restaurantId) return;
    const stockEmail = this.stockAlertEmail.trim();
    const expiryEmail = this.expiryAlertEmail.trim();
    if (stockEmail && !EMAIL_PATTERN.test(stockEmail)) {
      this.toast.error(this.transloco.translate('recipes.alertEmailInvalid'));
      return;
    }
    if (expiryEmail && !EMAIL_PATTERN.test(expiryEmail)) {
      this.toast.error(this.transloco.translate('recipes.alertEmailInvalid'));
      return;
    }
    const percent = this.stockAlertPercent == null ? null : Number(this.stockAlertPercent);
    if (percent != null && (percent < 0 || percent > 100)) {
      this.toast.error(this.transloco.translate('recipes.saveError'));
      return;
    }
    const days = Math.min(365, Math.max(0, Number(this.expiryAlertDaysAhead) || 0));
    this.alertSettingsSaving = true;
    this.recipesApi
      .updateInventoryAlertSettings(this.restaurantId, {
        lowStockAlertPercent: percent,
        lowStockAlertEmail: stockEmail || null,
        expiryAlertDaysAhead: days,
        expiryAlertEmail: expiryEmail || null,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (settings) => {
          this.applyAlertSettings(settings);
          this.alertSettingsSaving = false;
          this.toast.success(this.transloco.translate('recipes.saved'));
          if (scope === 'stock') {
            this.loadLowStockAlerts();
          } else {
            this.loadExpiryAlerts();
          }
        },
        error: () => {
          this.alertSettingsSaving = false;
          this.toast.error(this.transloco.translate('recipes.saveError'));
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
    this.desiredMarginPercent = this.loadDesiredMarginPercent();
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
    }
  }

  closeRecipeModal(): void {
    this.showRecipeModal = false;
    this.onRecipeModalVisible(false);
  }

  onDesiredMarginChange(value: number | null): void {
    this.desiredMarginPercent = value;
    this.persistDesiredMarginPercent(value);
  }

  applySuggestedPrice(): void {
    if (!this.restaurantId || !this.selectedMenuItemId || this.suggestedSellPrice == null) {
      return;
    }
    const amount = Math.round(this.suggestedSellPrice * 100) / 100;
    this.applyingPrice = true;
    this.menuApi
      .updatePriceAmount(this.restaurantId, this.selectedMenuItemId, amount)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.applyingPrice = false;
          const updated = res.menuItem;
          const idx = this.menuItems.findIndex((m) => m.menuItemId === this.selectedMenuItemId);
          if (idx >= 0 && updated) {
            this.menuItems[idx] = {
              ...this.menuItems[idx],
              menuItemPriceAmount: updated.menuItemPriceAmount,
            };
            this.rebuildGroupedMenuItems();
          }
          if (this.recipe) {
            this.recipe = {
              ...this.recipe,
              menuItemPriceAmount: updated?.menuItemPriceAmount ?? amount,
            };
          }
          this.toast.success(this.transloco.translate('recipes.priceApplied'));
        },
        error: () => {
          this.applyingPrice = false;
          this.toast.error(this.transloco.translate('recipes.saveError'));
        },
      });
  }

  private desiredMarginStorageKey(): string | null {
    return this.restaurantId ? `recipes.desiredMarginPercent.${this.restaurantId}` : null;
  }

  private loadDesiredMarginPercent(): number | null {
    const key = this.desiredMarginStorageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }

  private persistDesiredMarginPercent(value: number | null): void {
    const key = this.desiredMarginStorageKey();
    if (!key) return;
    try {
      if (value == null || value === ('' as unknown) || !Number.isFinite(Number(value))) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, String(Number(value)));
    } catch {
      /* ignore quota / private mode */
    }
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
          this.ingredientSearchByLine = {};
          for (const [idx, line] of (recipe.lines ?? []).entries()) {
            this.recipeLines.push(this.createLineGroup({
              ingredientId: line.ingredientId,
              name: line.ingredientName,
              unitOfMeasure: normalizeUom(line.unitOfMeasure),
              stockUnitOfMeasure: normalizeUom(line.stockUnitOfMeasure ?? line.unitOfMeasure),
              quantity: line.quantity,
              unitCostAmount: Number(line.unitCostAmount) || 0,
              currentStockQty: line.currentStockQty,
              yieldPercent: line.yieldPercent ?? null,
            }));
            this.ingredientSearchByLine[idx] = line.ingredientName;
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
      ingredientId: [values?.ingredientId ?? null, Validators.required],
      name: [values?.name ?? '', Validators.required],
      unitOfMeasure: [recipeUom, Validators.required],
      stockUnitOfMeasure: [values?.stockUnitOfMeasure ?? recipeUom],
      quantity: [values?.quantity ?? 1, [Validators.required, Validators.min(0.0001)]],
      unitCostAmount: [values?.unitCostAmount ?? 0],
      currentStockQty: [values?.currentStockQty ?? 0],
      yieldPercent: [values?.yieldPercent ?? null],
    });
  }

  addRecipeLine(): void {
    this.recipeLines.push(this.createLineGroup());
    this.selectedLineIndex = this.recipeLines.length - 1;
    this.ingredientSearchByLine[this.selectedLineIndex] = '';
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
    const nextSearch: Record<number, string> = {};
    for (let i = 0; i < this.recipeLines.length; i++) {
      const g = this.recipeLines.at(i) as FormGroup;
      nextSearch[i] = this.ingredientSearchByLine[i < index ? i : i + 1]
        ?? (g.get('name')?.value as string)
        ?? '';
    }
    this.ingredientSearchByLine = nextSearch;
    if (this.recipeLines.length === 0) {
      this.selectedLineIndex = null;
      return;
    }
    this.selectedLineIndex = Math.min(index, this.recipeLines.length - 1);
  }

  private computeLineCost(raw: LineFormValue): number {
    const recipeUom = Number(raw.unitOfMeasure);
    const stockUom = Number(raw.stockUnitOfMeasure ?? raw.unitOfMeasure);
    if (!canConvertUom(recipeUom, stockUom)) {
      return 0;
    }
    const unitCost = Number(raw.unitCostAmount) || 0;
    const qty = effectiveQtyInStockUom(
      Number(raw.quantity) || 0,
      recipeUom,
      stockUom,
      raw.yieldPercent,
    );
    return unitCost * qty;
  }

  lineCostExVat(index: number): number {
    const g = this.recipeLines.at(index) as FormGroup | null;
    if (!g) return 0;
    return this.computeLineCost(g.getRawValue() as LineFormValue);
  }

  saveRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId || this.recipeForm.invalid) return;
    const lines = this.recipeLines.getRawValue().map((l: LineFormValue) => ({
      ingredientId: l.ingredientId || undefined,
      name: (l.name ?? '').trim(),
      unitOfMeasure: Number(l.unitOfMeasure),
      quantity: Number(l.quantity),
    }));

    if (lines.some((l) => !l.ingredientId || !l.name)) {
      this.toast.error(this.transloco.translate('recipes.pickIngredientRequired'));
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
          this.reloadCatalogIngredients();
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
  yieldPercent: number | null;
}
