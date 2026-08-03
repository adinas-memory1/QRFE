import { RestaurantType } from './subscription-product';

export interface RestaurantStatisticDTO {
  restaurantId: string;
  restaurantName: string;
  numberOfTables: number;
  numberOfBars: number;
  restaurantType: string;
  baseRestaurantName?: string;
  hasManager?: boolean;
  hasRestaurantKey?: boolean;
  subscriptionStatus?: string | null;
  isManuallyProvisioned?: boolean;
  nextInvoiceOnUtc?: string | null;
  createdByUserId?: string | null;
  createdByRole?: string | null;
  createdByLabel?: string | null;
  inventoryManagementEnabled?: boolean;
}

export interface ListRestaurantsResponse {
  result: RestaurantStatisticDTO[] | null;
  totalCount: number;
}

export interface RestaurantDetailDTO {
  restaurantId: string;
  restaurantName: string;
  restaurantType: string;
  tables?: unknown[] | null;
  bars?: unknown[] | null;
  menu?: unknown | null;
  baseRestaurantName?: string;
}

export interface CreateRestaurantRequest {
  restaurantName: string;
  useCurrency: string;
  restaurantType: RestaurantType | string;
}

export interface ProvisionRestaurantWithManagerRequest {
  name: string;
  surname: string;
  email: string;
  password: string;
  phone: string;
  restaurantName: string;
  useCurrency: string;
  restaurantType: RestaurantType | string;
  city?: string;
  country?: string;
  address?: string;
  registrationNumber: string;
  zip?: string;
}

export interface ProvisionRestaurantResponse {
  isSuccess: boolean;
  message?: string | null;
  restaurantId: string;
  managerUserId: string;
  managerEmail?: string | null;
  keyVersion: number;
}

export interface RepairRestaurantProvisioningRequest {
  name?: string;
  surname?: string;
  email?: string;
  password?: string;
  phone?: string;
  restaurantName?: string;
  restaurantType?: RestaurantType | string;
  useCurrency?: string;
}

export interface RepairRestaurantProvisioningResponse {
  isSuccess: boolean;
  message?: string | null;
  restaurantId: string;
  managerUserId: string;
  managerEmail?: string | null;
  keyVersion: number;
  wasRecreated: boolean;
}

export interface UpdateRestaurantRequest {
  restaurantName: string;
  itHasBar: boolean;
}

export interface DeleteRestaurantResponse {
  restaurantId: string;
  success: boolean;
}
