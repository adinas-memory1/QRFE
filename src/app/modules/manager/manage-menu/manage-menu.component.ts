import { Component, OnDestroy, OnInit, viewChild } from '@angular/core';
import {
  FormControlDirective,
  FormLabelDirective, AccordionButtonDirective,
  AccordionComponent, AccordionItemComponent,
  ToasterComponent, TemplateIdDirective,
  ToasterPlacement,
  FormSelectDirective,
  ButtonDirective,
  ButtonCloseDirective,
  ButtonGroupComponent,
  FormCheckLabelDirective,
  ModalBodyComponent,
  ModalFooterComponent,
  ModalHeaderComponent,
  ModalTitleDirective,
  ModalComponent
} from '@coreui/angular';
import { } from '@coreui/angular';
import { MenuItemServiceService } from '../../../core/services/menu-item-service/menu-item-service.service';
import { filter, Subject, take, takeUntil } from 'rxjs';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { MenuItem, MenuManagementResponse } from '../../../core/models/menu/menuItem';
import { US_SALES_TAX_CATEGORY_OPTIONS, UsSalesTaxCategory } from '../../../core/models/tax-calculation.model';
import {
  canonicalMenuItemCategory,
  mergeManagementCategories,
} from '../../../core/models/menu/menu-item-categories';
import { SetMenuDTO, SetMenuLineInput } from '../../../core/models/menu/setMenu';
import { AuthService } from '../../../core/auth/auth.service';
import { NgFor, NgIf, CurrencyPipe, SlicePipe } from '@angular/common';
import { UserContextModel } from '../../../core/models/userContextModel';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { RecipeInventoryService } from '../../../core/services/recipe-inventory/recipe-inventory.service';

@Component({
  selector: 'app-manage-menu',
  imports: [FormControlDirective,
    FormLabelDirective,
    NgFor, NgIf, SlicePipe, ReactiveFormsModule,
    AccordionButtonDirective,
    AccordionComponent, AccordionItemComponent,
    TemplateIdDirective, CurrencyPipe,
    ToasterComponent, FormSelectDirective,
    ButtonDirective,
    ButtonGroupComponent,
    FormCheckLabelDirective,
    ModalComponent,
    ModalHeaderComponent,
    ModalTitleDirective,
    ButtonCloseDirective,
    ModalBodyComponent,
    ModalFooterComponent
    ,
    TranslocoPipe
  ],
  standalone: true,
  templateUrl: './manage-menu.component.html',
  styleUrls: ['./manage-menu.component.scss'],
})
export class ManageMenuComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  readonly usSalesTaxCategories = US_SALES_TAX_CATEGORY_OPTIONS;
  restaurantId = '';
  restaurantCurrency = 'RON';


  menuItems: MenuItem[] = [];
  /** Built from `menuItems` after each load (public for strict template checking). */
  groupedMenuItems: { [category: string]: MenuItem[] } = {};
  /** menuItemId -> portions remaining from recipe stock (null/undefined = no recipe). */
  portionsByMenuItemId: Record<string, number | null | undefined> = {};
  categories: string[] = [];
  selectedItem: MenuItem | null = null;
  menuItemsForm: FormGroup;
  presentationForm: FormGroup;
  weeklySetMenus: SetMenuDTO[] = [];
  setMenuForm: FormGroup;
  selectedSetMenuWeekday = new Date().getDay();
  selectedFile: File | null = null;
  placement = ToasterPlacement.TopEnd;
  editModalVisible = false;
  showAddForm = false;
  forceRefreshAfterUpdate = Date.now();
  readonly weekdayIndexes = [0, 1, 2, 3, 4, 5, 6] as const;
  private presentationModeInitialized = false;

  // readonly toaster = viewChild(ToasterComponent);

  constructor(private menuItemService: MenuItemServiceService,
    private fb: FormBuilder, private authService: AuthService,
    private appToast: AppToastService,
    private transloco: TranslocoService,
    private recipeInventory: RecipeInventoryService) {
    this.presentationForm = this.fb.group({
      menuPresentationMode: ['fixed'],
    });
    this.menuItemsForm = this.fb.group({
      menuItemName: ['', Validators.required],
      menuItemDescription: ['', Validators.required],
      menuItemPriceAmount: [0, [Validators.required, Validators.min(0.01)]],
      menuItemVatPercent: [19, [Validators.required, Validators.min(0), Validators.max(100)]],
      salesTaxCategory: [UsSalesTaxCategory.PreparedFood, Validators.required],
      menuItemCategory: ['', Validators.required],
      menuItemIcon: [null, Validators.required],
    });
    this.setMenuForm = this.fb.group({
      title: ['Meniul Zilei', Validators.required],
      priceAmount: [null, [Validators.required, Validators.min(0.01)]],
      isAvailable: [true],
      lines: this.fb.array([this.createSetMenuLineGroup()]),
    });
  }

  get isUsMarket(): boolean {
    return this.restaurantCurrency === 'USD';
  }

  createSetMenuLineGroup(text = '', vatPercent = 19): FormGroup {
    return this.fb.group({
      text: [text, Validators.required],
      vatPercent: [vatPercent, [Validators.required, Validators.min(0), Validators.max(100)]],
    });
  }

  get setMenuLines(): FormArray {
    return this.setMenuForm.get('lines') as FormArray;
  }

  addSetMenuLine(): void {
    this.setMenuLines.push(this.createSetMenuLineGroup());
  }

  removeSetMenuLine(index: number): void {
    if (this.setMenuLines.length <= 1) return;
    this.setMenuLines.removeAt(index);
  }

  selectSetMenuWeekday(d: number | string): void {
    const weekday = this.normalizeWeekday(d);
    if (weekday === null) return;
    this.selectedSetMenuWeekday = weekday;
    this.loadSetMenuForWeekday(weekday);
  }

  loadWeeklySetMenus(): void {
    this.menuItemService.getWeeklySetMenu(this.restaurantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.weeklySetMenus = res?.days ?? [];
          this.loadSetMenuForWeekday(this.selectedSetMenuWeekday);
        },
        error: (err) => console.error('[ManageMenu] loadWeeklySetMenus', err),
      });
  }

  loadSetMenuForWeekday(weekday: number): void {
    const target = this.normalizeWeekday(weekday) ?? weekday;
    const existing = this.weeklySetMenus.find(
      d => this.normalizeWeekday(d.weekday) === target,
    );
    while (this.setMenuLines.length) this.setMenuLines.removeAt(0);
    if (existing?.lines?.length) {
      for (const line of [...existing.lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
        this.setMenuLines.push(this.createSetMenuLineGroup(line.text, line.vatPercent ?? 19));
      }
      this.setMenuForm.patchValue({
        title: existing.title,
        priceAmount: existing.priceAmount,
        isAvailable: existing.isAvailable,
      });
    } else {
      this.setMenuLines.push(this.createSetMenuLineGroup());
      this.setMenuForm.patchValue({
        title: 'Meniul Zilei',
        priceAmount: null,
        isAvailable: true,
      });
    }
  }

  saveSetMenu(): void {
    if (!this.restaurantId) {
      this.appToast.error('Restaurant indisponibil. Reîncărcați pagina.');
      return;
    }

    const raw = this.setMenuForm.getRawValue();
    const title = (raw.title ?? '').trim();
    const priceAmount = Number(raw.priceAmount);
    const lines = (raw.lines as Array<{ text?: string; vatPercent?: number }>)
      .map(line => ({
        text: (line.text ?? '').trim(),
        vatPercent: Number(line.vatPercent),
      }))
      .filter(line => line.text.length > 0);

    if (!title) {
      this.setMenuForm.get('title')?.markAsTouched();
      this.appToast.error('Introduceți titlul meniului zilei.');
      return;
    }
    if (!Number.isFinite(priceAmount) || priceAmount < 0.01) {
      this.setMenuForm.get('priceAmount')?.markAsTouched();
      this.appToast.error('Introduceți un preț valid (minim 0,01).');
      return;
    }
    if (!lines.length) {
      this.setMenuForm.markAllAsTouched();
      this.appToast.error('Adăugați cel puțin o linie în meniu.');
      return;
    }
    if (lines.some(line => !Number.isFinite(line.vatPercent) || line.vatPercent < 0 || line.vatPercent > 100)) {
      this.setMenuForm.markAllAsTouched();
      this.appToast.error(this.transloco.translate('menu.manageMenu.formInvalid'));
      return;
    }

    this.menuItemService.upsertSetMenu(this.restaurantId, this.selectedSetMenuWeekday, {
      title,
      priceAmount,
      lines,
      isAvailable: !!raw.isAvailable,
      sourceLocale: this.transloco.getActiveLang() || 'ro',
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.appToast.success('Meniul zilei a fost salvat.');
        this.loadWeeklySetMenus();
      },
      error: () => {
        this.appToast.error('Eroare la salvarea meniului.');
      },
    });
  }

  private rebuildGroupedMenuItems(): void {
    this.groupedMenuItems = this.menuItems.reduce((acc, item) => {
      const cat = canonicalMenuItemCategory(item.category);
      if (cat.toLowerCase() === 'setmenu') {
        return acc;
      }
      if (!acc[cat]) {
        acc[cat] = [];
      }
      acc[cat].push(item);
      return acc;
    }, {} as { [category: string]: MenuItem[] });
  }

  weekdayLabel(d: number | string | null | undefined): string {
    const n = this.normalizeWeekday(d);
    return this.transloco.translate(`menu.manageMenu.weekdays.${n ?? 0}`);
  }

  normalizeWeekday(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    };
    const key = String(value).toLowerCase();
    if (key in dayMap) return dayMap[key];
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** Local calendar date as `yyyy-MM-dd` (browser timezone). */
  localTodayIso(): string {
    return new Date().toLocaleDateString('en-CA');
  }

  loadMenuItems(): void {
    if (this.selectedPresentationMode === 'setmenu') {
      this.loadWeeklySetMenus();
      return;
    }
    const clientDate = this.localTodayIso();
    this.menuItemService.getManagementMenu(this.restaurantId, clientDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: MenuManagementResponse) => {
          this.categories = mergeManagementCategories(response?.categories);
          if (!this.presentationModeInitialized) {
            const savedMode = (response.menuPresentationMode ?? 'Fixed').toLowerCase();
            const editorMode = savedMode === 'weekly' || savedMode === 'daily' ? 'setmenu' : 'fixed';
            this.presentationForm.patchValue(
              { menuPresentationMode: editorMode },
              { emitEvent: false }
            );
            this.presentationModeInitialized = true;
          }
          this.menuItems = (response?.menu?.menuItems ?? []).map((item) => ({
            ...item,
            category: canonicalMenuItemCategory(item.category),
          }));
          if (this.menuItems[0]?.menuItemPriceCurrency) {
            this.restaurantCurrency = this.menuItems[0].menuItemPriceCurrency!;
          }
          this.rebuildGroupedMenuItems();
          this.loadPortionsRemaining();
        },
        error: err => console.error('[ManageMenuComponent] Error loading menu items', err)
      });
  }

  loadPortionsRemaining(): void {
    if (!this.restaurantId || this.menuItems.length === 0) {
      this.portionsByMenuItemId = {};
      return;
    }
    const ids = this.menuItems.map((m) => m.menuItemId).filter(Boolean);
    this.recipeInventory
      .getPortionsRemaining(this.restaurantId, ids)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          const map: Record<string, number | null | undefined> = {};
          for (const row of rows) {
            map[row.menuItemId] = row.portionsRemaining;
          }
          this.portionsByMenuItemId = map;
        },
        error: () => {
          this.portionsByMenuItemId = {};
        },
      });
  }


  get selectedPresentationMode(): string {
    return (this.presentationForm.value.menuPresentationMode as string) ?? 'fixed';
  }

  get savedSetMenus(): SetMenuDTO[] {
    return [...this.weeklySetMenus]
      .filter(m => (m.lines?.length ?? 0) > 0)
      .sort((a, b) => Number(a.weekday) - Number(b.weekday));
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetForm();
    }
  }



  /**
   * Title-cases words whose letter count is greater than 3; shorter words stay as typed.
   * Uses Romanian locale for upper/lower casing (ă, î, ș, ț, etc.).
   */
  formatMenuItemName(): void {
    const control = this.menuItemsForm.get('menuItemName');
    if (!control || typeof control.value !== 'string') return;
    const raw = control.value;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const formatted = trimmed
      .split(/\s+/)
      .map((word) => {
        const letterCount = [...word].filter((ch) => /\p{L}/u.test(ch)).length;
        if (letterCount <= 3) return word;
        let seenLetter = false;
        return [...word]
          .map((ch) => {
            if (!/\p{L}/u.test(ch)) {
              seenLetter = false;
              return ch;
            }
            if (!seenLetter) {
              seenLetter = true;
              return ch.toLocaleUpperCase('ro-RO');
            }
            return ch.toLocaleLowerCase('ro-RO');
          })
          .join('');
      })
      .join(' ');

    if (formatted !== raw) {
      control.setValue(formatted, { emitEvent: false });
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      // optional: preview
      const previewUrl = URL.createObjectURL(this.selectedFile);
      this.menuItemsForm.patchValue({ menuItemIcon: this.selectedFile });
    }
  }

  onEdit(item: MenuItem): void {
    this.selectedItem = item;
    this.selectedFile = null;
    const iconControl = this.menuItemsForm.get('menuItemIcon');
    iconControl?.clearValidators();
    iconControl?.updateValueAndValidity({ emitEvent: false });
    this.menuItemsForm.patchValue({
      menuItemName: item.menuItemName,
      menuItemDescription: item.menuItemDescription,
      menuItemPriceAmount: item.menuItemPriceAmount,
      menuItemVatPercent: item.menuItemVatPercent ?? 19,
      salesTaxCategory: item.salesTaxCategory ?? UsSalesTaxCategory.PreparedFood,
      menuItemCategory: canonicalMenuItemCategory(item.category),
      menuItemIcon: null,
    });
    this.editModalVisible = true;
  }

  closeEditModal() {
    this.editModalVisible = false;
    this.selectedItem = null;
  }

  onDelete(item: MenuItem): void {
    if (confirm(`Delete "${item.menuItemName}"?`)) {
      this.menuItemService.delete(this.restaurantId, item.menuItemId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.loadMenuItems());
    }
  }

  toggleAvailability(item: MenuItem): void {
    const next = !(item.isAvailable ?? true);
    this.menuItemService.setAvailability(this.restaurantId, item.menuItemId, next)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          item.isAvailable = next;
          this.appToast.success(
            next
              ? this.transloco.translate('menu.availability.manager.toastAvailable')
              : this.transloco.translate('menu.availability.manager.toastUnavailable')
          );
        },
        error: (error) => {
          this.appToast.error(this.transloco.translate('menu.availability.manager.toastError'));
        }
      });
  }

  onSubmit(): void {
    this.formatMenuItemName();

    const iconFile = this.selectedFile ?? this.menuItemsForm.value.menuItemIcon;
    if (!(iconFile instanceof File) && !this.selectedItem) {
      this.menuItemsForm.get('menuItemIcon')?.markAsTouched();
    }

    if (!this.menuItemsForm.valid) {
      this.menuItemsForm.markAllAsTouched();
      if (!(iconFile instanceof File) && !this.selectedItem) {
        this.appToast.error(this.transloco.translate('menu.manageMenu.iconRequired'));
      } else {
        this.appToast.error(this.transloco.translate('menu.manageMenu.formInvalid'));
      }
      return;
    }

    const formData = new FormData();
    formData.append('menuItemName', this.menuItemsForm.value.menuItemName);
    formData.append('menuItemDescription', this.menuItemsForm.value.menuItemDescription);
    formData.append('menuItemPriceAmount', this.menuItemsForm.value.menuItemPriceAmount);
    formData.append('menuItemVatPercent', this.menuItemsForm.value.menuItemVatPercent);
    if (this.isUsMarket && this.menuItemsForm.value.salesTaxCategory) {
      formData.append('salesTaxCategory', this.menuItemsForm.value.salesTaxCategory);
    }
    formData.append('menuItemCategory', canonicalMenuItemCategory(this.menuItemsForm.value.menuItemCategory));
    formData.append('sourceLocale', this.transloco.getActiveLang() || 'ro');
    if (iconFile instanceof File) {
      formData.append('menuItemIcon', iconFile);
    }

    if (this.selectedItem) {
      formData.append('menuItemPriceCurrency', this.selectedItem.menuItemPriceCurrency ?? 'RON');
      this.menuItemService.update(this.restaurantId, this.selectedItem.menuItemId, formData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.appToast.success(`Menu Item Updated: ${this.menuItemsForm.get('menuItemName')?.value ?? ''}`);
            this.resetForm();
            this.loadMenuItems();
            this.closeEditModal();
          },
          error: (error) => {
            this.appToast.error(`Error updating Menu Item: ${error?.Message}`);
            this.resetForm();
            this.closeEditModal();
            this.loadMenuItems();
          }
        })
    } else {
      this.menuItemService.create(this.restaurantId, formData)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.appToast.success(`Menu Item Created: ${this.menuItemsForm.get('menuItemName')?.value ?? ''}`);
            this.resetForm();
            this.showAddForm = false;
            this.loadMenuItems();
          },
          error: (error) => {
            this.appToast.error(`Error creating Menu Item: ${error?.Message}`);
            this.resetForm();
            this.loadMenuItems();
          }
        });
    }
  }

  onUpdate() {
    this.formatMenuItemName();
    if (this.menuItemsForm.valid && this.selectedItem) {
      const updated = { ...this.selectedItem, ...this.menuItemsForm.value, menuItemPriceCurrency: this.selectedItem.menuItemPriceCurrency };
      this.menuItemService.update(this.restaurantId, this.selectedItem.menuItemId, updated)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.loadMenuItems();
            this.closeEditModal();
            this.resetForm();
            this.appToast.success(`Menu Item Updated: ${updated.menuItemName}`);
          },
          error: (error) => {

            this.closeEditModal();
            this.loadMenuItems();
            this.resetForm();
            this.appToast.error(`Error updating Menu Item: ${error?.Message}`);
          }
        });
      // .subscribe(() => {
      //   this.addToast('Menu Item Updated:', 'Success', 3000, 'success');
      //   this.closeEditModal();
      //   this.loadMenuItems();
      // },
      //   error => {
      //     this.closeEditModal();
      //     this.loadMenuItems();
      //     this.addToast('Error:', error.Message, 5000, 'danger');
      //   });
    }
  }

  ngOnInit(): void {
    this.presentationForm.get('menuPresentationMode')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((mode: string) => {
        if (mode === 'setmenu') {
          this.showAddForm = false;
          this.loadWeeklySetMenus();
        } else {
          this.loadMenuItems();
        }
      });

    this.authService.getUserContext()
      .pipe(
        takeUntil(this.destroy$),
        filter((user): user is UserContextModel => !!user && !!user.restaurantId),
        take(1)
      )
      .subscribe({
        next: (user) => {
          this.restaurantId = user?.restaurantId ?? '';
          this.loadMenuItems();
          this.loadWeeklySetMenus();
        },
        error: (err) => {
          this.appToast.error(`Error fetching menu items: ${err?.Message}`);
        }
      });
  }

  resetForm(): void {
    this.selectedItem = null;
    this.selectedFile = null;
    this.menuItemsForm.reset({
      menuItemPriceAmount: 0,
      menuItemVatPercent: 19,
    });
    const iconControl = this.menuItemsForm.get('menuItemIcon');
    iconControl?.setValidators(Validators.required);
    iconControl?.updateValueAndValidity({ emitEvent: false });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

}
