import { Component, OnDestroy, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import {
  ButtonDirective,
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
  ButtonCloseDirective,
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
  IngredientConsumptionRow,
  IngredientDto,
  RecipeDto,
  StockMovementDto,
  UNIT_OF_MEASURE_OPTIONS,
} from '../../../core/models/recipe/recipe.models';

type TabId = 'ingredients' | 'recipes' | 'consumption';

@Component({
  selector: 'app-manage-recipes',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    TranslocoPipe,
    DatePipe,
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
  templateUrl: './manage-recipes.component.html',
  styleUrls: ['./manage-recipes.component.scss'],
})
export class ManageRecipesComponent implements OnInit, OnDestroy {
  readonly uomOptions = UNIT_OF_MEASURE_OPTIONS;
  activeTab: TabId = 'ingredients';
  restaurantId: string | null = null;
  ingredients: IngredientDto[] = [];
  menuItems: MenuItem[] = [];
  selectedMenuItemId = '';
  recipe: RecipeDto | null = null;
  consumption: IngredientConsumptionRow[] = [];
  stockHistory: StockMovementDto[] = [];
  loading = false;

  ingredientForm: FormGroup;
  stockForm: FormGroup;
  recipeForm: FormGroup;
  consumptionForm: FormGroup;

  showIngredientModal = false;
  showStockModal = false;
  editingIngredient: IngredientDto | null = null;
  stockTarget: IngredientDto | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly fb: FormBuilder,
    private readonly auth: AuthService,
    private readonly recipesApi: RecipeInventoryService,
    private readonly menuApi: MenuItemServiceService,
    private readonly toast: AppToastService,
    private readonly transloco: TranslocoService,
  ) {
    this.ingredientForm = this.fb.group({
      name: ['', Validators.required],
      unitOfMeasure: [4, Validators.required],
      unitCostAmount: [0, [Validators.required, Validators.min(0)]],
      initialStockQty: [0, [Validators.min(0)]],
      isActive: [true],
    });
    this.stockForm = this.fb.group({
      quantityDelta: [0, Validators.required],
      note: [''],
    });
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

  ngOnInit(): void {
    const id = this.auth.getUserRestaurantId();
    this.restaurantId = Array.isArray(id) ? id[0] ?? null : id;
    if (!this.restaurantId) {
      return;
    }
    this.reloadIngredients();
    this.reloadMenuItems();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: TabId): void {
    this.activeTab = tab;
    if (tab === 'recipes' && this.selectedMenuItemId) {
      this.loadRecipe();
    }
  }

  reloadIngredients(): void {
    if (!this.restaurantId) return;
    this.loading = true;
    this.recipesApi
      .listIngredients(this.restaurantId, true)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.ingredients = rows;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toast.error(this.transloco.translate('recipes.loadError'));
        },
      });
  }

  reloadMenuItems(): void {
    if (!this.restaurantId) return;
    const clientDate = new Date().toISOString().slice(0, 10);
    this.menuApi
      .getManagementMenu(this.restaurantId, clientDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.menuItems = (res.menu?.menuItems ?? []).filter(
            (i) => (i.category ?? '').toString().toLowerCase() !== 'setmenu',
          );
        },
        error: () => {
          this.toast.error(this.transloco.translate('recipes.loadError'));
        },
      });
  }

  openCreateIngredient(): void {
    this.editingIngredient = null;
    this.ingredientForm.reset({
      name: '',
      unitOfMeasure: 4,
      unitCostAmount: 0,
      initialStockQty: 0,
      isActive: true,
    });
    this.showIngredientModal = true;
  }

  openEditIngredient(item: IngredientDto): void {
    this.editingIngredient = item;
    this.ingredientForm.reset({
      name: item.name,
      unitOfMeasure: normalizeUom(item.unitOfMeasure),
      unitCostAmount: item.unitCostAmount,
      initialStockQty: item.currentStockQty,
      isActive: item.isActive,
    });
    this.showIngredientModal = true;
  }

  saveIngredient(): void {
    if (!this.restaurantId || this.ingredientForm.invalid) return;
    const raw = this.ingredientForm.getRawValue();
    if (this.editingIngredient) {
      this.recipesApi
        .updateIngredient(this.restaurantId, this.editingIngredient.ingredientId, {
          name: raw.name,
          unitOfMeasure: Number(raw.unitOfMeasure),
          unitCostAmount: Number(raw.unitCostAmount),
          isActive: !!raw.isActive,
        })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.showIngredientModal = false;
            this.reloadIngredients();
            this.toast.success(this.transloco.translate('recipes.saved'));
          },
          error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
        });
      return;
    }

    this.recipesApi
      .createIngredient(this.restaurantId, {
        name: raw.name,
        unitOfMeasure: Number(raw.unitOfMeasure),
        unitCostAmount: Number(raw.unitCostAmount),
        initialStockQty: Number(raw.initialStockQty ?? 0),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showIngredientModal = false;
          this.reloadIngredients();
          this.toast.success(this.transloco.translate('recipes.saved'));
        },
        error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
      });
  }

  deactivateIngredient(item: IngredientDto): void {
    if (!this.restaurantId) return;
    this.recipesApi
      .deactivateIngredient(this.restaurantId, item.ingredientId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.reloadIngredients();
          this.toast.success(this.transloco.translate('recipes.saved'));
        },
        error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
      });
  }

  openStockAdjust(item: IngredientDto): void {
    this.stockTarget = item;
    this.stockForm.reset({ quantityDelta: 0, note: '' });
    this.stockHistory = [];
    this.showStockModal = true;
    if (!this.restaurantId) return;
    this.recipesApi
      .listStockMovements(this.restaurantId, item.ingredientId, 20)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => (this.stockHistory = rows),
      });
  }

  saveStockAdjust(): void {
    if (!this.restaurantId || !this.stockTarget || this.stockForm.invalid) return;
    const raw = this.stockForm.getRawValue();
    const delta = Number(raw.quantityDelta);
    if (!delta) return;
    this.recipesApi
      .adjustStock(this.restaurantId, this.stockTarget.ingredientId, {
        quantityDelta: delta,
        note: raw.note || undefined,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showStockModal = false;
          this.reloadIngredients();
          this.toast.success(this.transloco.translate('recipes.saved'));
        },
        error: () => this.toast.error(this.transloco.translate('recipes.saveError')),
      });
  }

  onMenuItemSelected(menuItemId: string): void {
    this.selectedMenuItemId = menuItemId;
    this.loadRecipe();
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
          this.recipeLines.clear();
          for (const line of recipe.lines ?? []) {
            this.recipeLines.push(
              this.fb.group({
                ingredientId: [line.ingredientId, Validators.required],
                quantity: [line.quantity, [Validators.required, Validators.min(0.0001)]],
              }),
            );
          }
          if (this.recipeLines.length === 0) {
            this.addRecipeLine();
          }
        },
        error: () => this.toast.error(this.transloco.translate('recipes.loadError')),
      });
  }

  addRecipeLine(): void {
    this.recipeLines.push(
      this.fb.group({
        ingredientId: ['', Validators.required],
        quantity: [1, [Validators.required, Validators.min(0.0001)]],
      }),
    );
  }

  removeRecipeLine(index: number): void {
    this.recipeLines.removeAt(index);
  }

  saveRecipe(): void {
    if (!this.restaurantId || !this.selectedMenuItemId || this.recipeForm.invalid) return;
    const lines = this.recipeLines.getRawValue().map((l: { ingredientId: string; quantity: number }) => ({
      ingredientId: l.ingredientId,
      quantity: Number(l.quantity),
    }));
    this.recipesApi
      .upsertRecipe(this.restaurantId, this.selectedMenuItemId, lines)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (recipe) => {
          this.recipe = recipe;
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
    if (value == null) return 'RON';
    if (typeof value === 'string') return value;
    const map = ['USD', 'EUR', 'RON', 'GBP', 'SEK', 'NOK', 'DKK', 'JPY', 'CHF', 'AUD', 'CAD', 'CNY', 'INR', 'BRL'];
    return map[value] ?? 'RON';
  }
}

function normalizeUom(value: string | number): number {
  if (typeof value === 'number') return value;
  const map: Record<string, number> = { G: 0, Kg: 1, Ml: 2, L: 3, Pcs: 4 };
  return map[value] ?? 4;
}
