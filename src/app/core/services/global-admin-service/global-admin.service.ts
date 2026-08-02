import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CreateRestaurantRequest,
  DeleteRestaurantResponse,
  ListRestaurantsResponse,
  ProvisionRestaurantResponse,
  ProvisionRestaurantWithManagerRequest,
  RepairRestaurantProvisioningRequest,
  RepairRestaurantProvisioningResponse,
  RestaurantDetailDTO,
  UpdateRestaurantRequest
} from '../../models/global-admin-restaurant.model';
import { GlobalAdminPrinterFleetItem } from '../../models/global-admin-printer-fleet.model';

export interface CreateResellerRequest {
  name: string;
  surname: string;
  email: string;
  password: string;
  phone: string;
}

export interface CreateResellerResponse {
  isSuccess: boolean;
  message?: string | null;
  userId: string;
  email?: string | null;
}

export interface ResellerListItem {
  userId: string;
  name: string;
  surname: string;
  email: string;
  phone: string;
  createdAtUtc: string;
}

export interface ListResellersResponse {
  result: ResellerListItem[] | null;
  totalCount: number;
}

@Injectable({ providedIn: 'root' })
export class GlobalAdminService {
  private readonly apiUrl = environment.apiUrl;
  private readonly base = `${this.apiUrl}/api/restaurants`;
  private readonly creds = { withCredentials: true };

  constructor(private http: HttpClient) {}

  listRestaurants(pageNumber: number, pageSize: number): Observable<ListRestaurantsResponse> {
    return this.http.get<ListRestaurantsResponse>(`${this.base}/${pageNumber}/${pageSize}`, this.creds);
  }

  getRestaurant(restaurantId: string): Observable<RestaurantDetailDTO> {
    return this.http.get<RestaurantDetailDTO>(`${this.base}/${restaurantId}`, this.creds);
  }

  createRestaurant(payload: CreateRestaurantRequest): Observable<RestaurantDetailDTO> {
    return this.http.post<RestaurantDetailDTO>(this.base, payload, this.creds);
  }

  provisionRestaurantWithManager(payload: ProvisionRestaurantWithManagerRequest): Observable<ProvisionRestaurantResponse> {
    return this.http.post<ProvisionRestaurantResponse>(`${this.base}/provision`, payload, this.creds);
  }

  repairRestaurantProvisioning(
    restaurantId: string,
    payload: RepairRestaurantProvisioningRequest
  ): Observable<RepairRestaurantProvisioningResponse> {
    return this.http.post<RepairRestaurantProvisioningResponse>(
      `${this.base}/${restaurantId}/repair-provisioning`,
      payload,
      this.creds
    );
  }

  updateRestaurant(id: string, payload: UpdateRestaurantRequest): Observable<RestaurantDetailDTO> {
    return this.http.put<RestaurantDetailDTO>(`${this.base}/${id}`, payload, this.creds);
  }

  deleteRestaurant(id: string): Observable<DeleteRestaurantResponse> {
    return this.http.delete<DeleteRestaurantResponse>(`${this.base}/${id}`, this.creds);
  }

  setInventoryManagement(
    restaurantId: string,
    enabled: boolean,
  ): Observable<{ restaurantId: string; inventoryManagementEnabled: boolean }> {
    return this.http.put<{ restaurantId: string; inventoryManagementEnabled: boolean }>(
      `${this.base}/${restaurantId}/inventory-management`,
      { enabled },
      this.creds,
    );
  }

  listPrinterFleet(): Observable<GlobalAdminPrinterFleetItem[]> {
    return this.http.get<GlobalAdminPrinterFleetItem[]>(`${this.base}/printer-fleet`, this.creds);
  }

  createReseller(payload: CreateResellerRequest): Observable<CreateResellerResponse> {
    return this.http.post<CreateResellerResponse>(`${this.base}/resellers`, payload, this.creds);
  }

  listResellers(pageNumber: number, pageSize: number): Observable<ListResellersResponse> {
    return this.http.get<ListResellersResponse>(
      `${this.base}/resellers/${pageNumber}/${pageSize}`,
      this.creds
    );
  }
}
