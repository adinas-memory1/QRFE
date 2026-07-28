import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ContainerComponent,
  ButtonDirective,
  ColComponent,
  FormCheckComponent,
  FormCheckInputDirective,
  FormCheckLabelDirective,
  FormControlDirective,
  FormDirective,
  FormLabelDirective,
  FormSelectDirective
} from '@coreui/angular';
import { SubscriptionService } from '../../../core/services/subscription-service/subscription.service';
import { Router } from '@angular/router';
import { SubscriptionPayloadModel } from '../../../core/models/subscriptionPayloadModel';
import { AuthService } from '../../../core/auth/auth.service';
import { UserContextModel } from '../../../core/models/userContextModel';
import { RouterLink } from '@angular/router';
import { CardBodyComponent, CardComponent, RowComponent } from '@coreui/angular';
import { Currency } from '../../../core/models/restaurantTablesModel';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';
import { US_STATE_OPTIONS, isUnitedStatesCountry } from '../../../core/constants/us-states';

/** Fallback if GET /api/restaurants/currencies fails (same set as backend Currency enum). */
const FALLBACK_OPERATING_CURRENCIES = Object.values(Currency) as string[];

@Component({
  selector: 'app-restaurant-setup',
  imports: [
    ReactiveFormsModule,
    ContainerComponent,
    ButtonDirective,
    CardComponent,
    CardBodyComponent,
    RowComponent,
    ColComponent,
    FormCheckComponent,
    FormCheckInputDirective,
    FormCheckLabelDirective,
    FormControlDirective,
    FormDirective,
    FormLabelDirective,
    FormSelectDirective,
    RouterLink],
  standalone: true,
  templateUrl: './restaurant-setup.component.html',
  styleUrl: './restaurant-setup.component.scss'
})
export class RestaurantSetupComponent implements OnInit {

  restaurantSetupForm: FormGroup<{
    restaurantName: FormControl<string>;
    /** Display/pricing currency for the venue (applied after Stripe checkout; billing stays on subscription price). */
    restaurantCurrency: FormControl<string>;
    address: FormControl<string>;
    city: FormControl<string>;
    country: FormControl<string>;
    state: FormControl<string>;
    zip: FormControl<string>;
    registrationNumber: FormControl<string>;
    checkAddress: FormControl<boolean>;
    billingAddress: FormControl<string>;
  }>;

  operatingCurrencyOptions: string[] = [...FALLBACK_OPERATING_CURRENCIES];
  readonly usStateOptions = US_STATE_OPTIONS;

  get isUsSelected(): boolean {
    return isUnitedStatesCountry(this.restaurantSetupForm.get('country')?.value);
  }

  private user: UserContextModel | null = null;
  private role: string | null = null;

  constructor(private fb: FormBuilder,
    private router: Router,
    private authService: AuthService,
    private subscriptionService: SubscriptionService,
    private miscellaneousService: MiscellaneousService
  ) {
    this.restaurantSetupForm = this.fb.group({
      restaurantName: this.fb.control('', { nonNullable: true }),
      restaurantCurrency: this.fb.control('RON', { nonNullable: true }),
      address: this.fb.control('', { nonNullable: true }),
      city: this.fb.control('', { nonNullable: true }),
      country: this.fb.control('', { nonNullable: true }),
      state: this.fb.control('', { nonNullable: true }),
      zip: this.fb.control('', { nonNullable: true }),
      registrationNumber: this.fb.control('', { nonNullable: true }),
      checkAddress: this.fb.control(false, { nonNullable: true }),
      billingAddress: this.fb.control('', { nonNullable: true })
    });

    this.user = {} as UserContextModel;
  }

  onSubmit() {
    const pending = this.subscriptionService.getPendingPlan();
    if (!pending) return;

    if (this.restaurantSetupForm.invalid) {
      this.restaurantSetupForm.markAllAsTouched();
      return;
    }

    if (!this.user) {
      this.router.navigate(['/login']);
    }
    else if (this.user && this.role === 'default') {
      const formValue = this.restaurantSetupForm.getRawValue(); // includes disabled fields

      const payload: SubscriptionPayloadModel = {
        priceId: pending.priceId,
        restaurantType: pending.restaurantType,
        restaurantName: formValue.restaurantName,
        restaurantCurrency: formValue.restaurantCurrency,
        address: formValue.address,
        city: formValue.city,
        country: formValue.country,
        state: formValue.state,
        zip: formValue.zip,
        registrationNumber: formValue?.registrationNumber ?? '',
        sameAddressForBilling: formValue?.checkAddress,
        billingAddress: formValue?.checkAddress ? formValue.address : formValue.billingAddress
      };

      this.subscriptionService.subscribeToPlan(payload).subscribe({
        next: (response: { checkoutUrl: string }) => {
          // Also stored client-side so payment-success can PATCH if webhook timing fails
          this.subscriptionService.setPendingRestaurantCurrency(formValue.restaurantCurrency);
          this.subscriptionService.clearPendingPlan();
          // Redirect the browser to Stripe Checkout
          window.location.href = response.checkoutUrl;
        },
        error: err => console.error('Subscription failed', err)

      });
    } else {
      this.router.navigate(['/404']);
    }
  }

  ngOnInit(): void {
    this.authService.user$.subscribe((user: UserContextModel | null) => {
      this.user = user;
      console.warn('User authenticated in LandingComponent:', this.user);
    }, (error: unknown) => {
      console.error('Error fetching user data in LandingComponent:', error);
    });

    this.role = this.authService.getUserRole();

    this.miscellaneousService.getCurrencies().subscribe({
      next: list => {
        if (list?.length) {
          this.operatingCurrencyOptions = list;
          const current = this.restaurantSetupForm.get('restaurantCurrency')?.value;
          if (current && !list.includes(current)) {
            this.restaurantSetupForm.patchValue({ restaurantCurrency: list[0] });
          }
        }
      },
      error: err => console.warn('Using fallback currency list; GET /api/restaurants/currencies failed', err)
    });

    this.restaurantSetupForm.get('checkAddress')?.valueChanges.subscribe(checked => {
      if (checked) {
        const address = this.restaurantSetupForm.get('address')!.value as string;
        this.restaurantSetupForm.get('billingAddress')?.setValue(address);
        this.restaurantSetupForm.get('billingAddress')?.disable(); // optional: lock field
      } else {
        this.restaurantSetupForm.get('billingAddress')?.enable(); // allow manual entry
      }
    });

    this.restaurantSetupForm.get('country')?.valueChanges.subscribe(country => {
      this.applyStateValidators(country);
    });
    this.applyStateValidators(this.restaurantSetupForm.get('country')?.value ?? '');
  }

  private applyStateValidators(country: string): void {
    const stateControl = this.restaurantSetupForm.get('state');
    if (!stateControl) return;

    if (isUnitedStatesCountry(country)) {
      stateControl.setValidators([Validators.required]);
    } else {
      stateControl.clearValidators();
      stateControl.setValue('', { emitEvent: false });
    }
    stateControl.updateValueAndValidity({ emitEvent: false });
  }

}
