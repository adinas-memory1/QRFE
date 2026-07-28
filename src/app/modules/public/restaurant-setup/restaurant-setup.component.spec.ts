import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RestaurantSetupComponent } from './restaurant-setup.component';
import { COMMON_TEST_PROVIDERS } from '../../../testing/common-test-providers';

describe('RestaurantSetupComponent', () => {
  let component: RestaurantSetupComponent;
  let fixture: ComponentFixture<RestaurantSetupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RestaurantSetupComponent],
      providers: [...COMMON_TEST_PROVIDERS],
    })
    .compileComponents();

    fixture = TestBed.createComponent(RestaurantSetupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows US state dropdown when United States is selected', () => {
    expect(component.isUsSelected).toBeFalse();
    component.restaurantSetupForm.patchValue({ country: 'United States' });
    fixture.detectChanges();
    expect(component.isUsSelected).toBeTrue();
    const stateSelect = fixture.nativeElement.querySelector('#state') as HTMLSelectElement | null;
    expect(stateSelect?.tagName).toBe('SELECT');
    expect(stateSelect?.options.length).toBeGreaterThan(50);
  });

  it('requires state when United States is selected', () => {
    component.restaurantSetupForm.patchValue({ country: 'United States', state: '' });
    expect(component.restaurantSetupForm.invalid).toBeTrue();
    component.restaurantSetupForm.patchValue({ state: 'CA' });
    expect(component.restaurantSetupForm.get('state')?.valid).toBeTrue();
  });
});
