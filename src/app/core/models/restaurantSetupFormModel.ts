export interface RestaurantSetupFormModel {
  priceId: string;
  restaurantName: string;
  /** Operating currency for menu/orders; sent to API → Stripe metadata → webhook. */
  restaurantCurrency: string;
  address: string;
  city: string;
  country: string;
  state: string;
  zip: string;
  registrationNumber: string;
  sameAddressForBilling: boolean;
  billingAddress: string;
}
