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
  RecipeDto,
  UNIT_OF_MEASURE_OPTIONS,
  normalizeIngredientName,
} from '../../../core/models/recipe/recipe.models';

type TabId = 'menu' | 'consumption';

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
  selectedMenuItemId = '';
  recipe: RecipeDto | null = null;
  consumption: IngredientConsumptionRow[] = [];

  recipeForm: FormGroup;
  consumptionForm: FormGroup;

  showRecipeModal = false;

  private readonly destroy$ = new Subject<void>();

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

  /** VAT % taken from the menu item (not edited on the recipe line). */
  get selectedMenuItemVatPercent(): number {
    return this.recipe?.menuItemVatPercent
      ?? this.selectedMenuItem?.menuItemVatPercent
      ?? 19;
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
    this.showRecipeModal = true;
    this.loadRecipe();
  }

  onRecipeModalVisible(visible: boolean): void {
    this.showRecipeModal = visible;
    if (!visible) {
      this.selectedMenuItemId = '';
      this.recipe = null;
      this.recipeLines.clear();
    }
  }

  closeRecipeModal(): void {
    this.showRecipeModal = false;
    this.onRecipeModalVisible(false);
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
              quantity: line.quantity,
              unitCostAmount: line.unitCostAmount,
              currentStockQty: line.currentStockQty,
            }));
          }
          if (this.recipeLines.length === 0) {
            this.addRecipeLine();
          }
        },
        error: () => this.toast.error(this.transloco.translate('recipes.loadError')),
      });
  }

  private createLineGroup(values?: {
    ingredientId?: string | null;
    name?: string;
    unitOfMeasure?: number;
    quantity?: number;
    unitCostAmount?: number;
    currentStockQty?: number;
  }): FormGroup {
    return this.fb.group({
      ingredientId: [values?.ingredientId ?? null],
      name: [values?.name ?? '', Validators.required],
      unitOfMeasure: [values?.unitOfMeasure ?? 4, Validators.required],
      quantity: [values?.quantity ?? 1, [Validators.required, Validators.min(0.0001)]],
      unitCostAmount: [values?.unitCostAmount ?? 0, [Validators.required, Validators.min(0)]],
      currentStockQty: [values?.currentStockQty ?? 0, [Validators.required, Validators.min(0)]],
    });
  }

  addRecipeLine(): void {
    this.recipeLines.push(this.createLineGroup());
  }

  removeRecipeLine(index: number): void {
    this.recipeLines.removeAt(index);
  }

  saveRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId || this.recipeForm.invalid) return;
    const lines = this.recipeLines.getRawValue().map(
      (l: {
        ingredientId: string | null;
        name: string;
        unitOfMeasure: number;
        quantity: number;
        unitCostAmount: number;
        currentStockQty: number;
      }) => ({
        ingredientId: l.ingredientId || undefined,
        name: normalizeIngredientName(l.name),
        unitOfMeasure: Number(l.unitOfMeasure),
        quantity: Number(l.quantity),
        unitCostAmount: Number(l.unitCostAmount),
        currentStockQty: Number(l.currentStockQty),
      }),
    );

    if (lines.some((l) => !l.name)) {
      this.toast.error(this.transloco.translate('recipes.saveError'));
      return;
    }

    this.recipesApi
      .upsertRecipe(this.restaurantId, this.selectedMenuItemId, lines)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (recipe) => {
          this.recipe = recipe;
          this.recipeLines.clear();
          for (const line of recipe.lines ?? []) {
            this.recipeLines.push(this.createLineGroup({
              ingredientId: line.ingredientId,
              name: line.ingredientName,
              unitOfMeasure: normalizeUom(line.unitOfMeasure),
              quantity: line.quantity,
              unitCostAmount: line.unitCostAmount,
              currentStockQty: line.currentStockQty,
            }));
          }
          if (this.recipeLines.length === 0) {
            this.addRecipeLine();
          }
          this.toast.success(this.transloco.translate('recipes.saved'));
        },
        error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
      });
  }

  clearRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId) return;
    this.recipesApi
      .deleteRecipe(this.restaurantId, this.selectedMenuItemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.recipe = null;
          this.recipeLines.clear();
          this.addRecipeLine();
          this.toast.success(this.transloco.translate('recipes.saved'));
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

  currencyCode(value: string | number | null | undefined): string {
    if (value == null) return this.restaurantCurrency || 'RON';
    if (typeof value === 'string') return value;
    const map = ['USD', 'EUR', 'RON', 'GBP', 'SEK', 'NOK', 'DKK', 'JPY', 'CHF', 'AUD', 'CAD', 'CNY', 'INR', 'BRL'];
    return map[value] ?? (this.restaurantCurrency || 'RON');
  }
}

function normalizeUom(value: string | number): number {
  if (typeof value === 'number') return value;
  const map: Record<string, number> = { G: 0, Kg: 1, Ml: 2, L: 3, Pcs: 4 };
  return map[value] ?? 4;
}
