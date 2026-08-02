import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ListRestaurantsResponse,
  ProvisionRestaurantResponse,
  ProvisionRestaurantWithManagerRequest,
  RestaurantDetailDTO
} from '../../models/global-admin-restaurant.model';

@Injectable({ providedIn: 'root' })
export class ResellerService {
  private readonly apiUrl = environment.apiUrl;
  private readonly base = `${this.apiUrl}/api/reseller`;
  private readonly creds = { withCredentials: true };

  constructor(private http: HttpClient) {}

  listRestaurants(pageNumber: number, pageSize: number): Observable<ListRestaurantsResponse> {
    return this.http.get<ListRestaurantsResponse>(
      `${this.base}/restaurants/${pageNumber}/${pageSize}`,
      this.creds
    );
  }

  provisionRestaurantWithManager(
    payload: ProvisionRestaurantWithManagerRequest
  ): Observable<ProvisionRestaurantResponse> {
    return this.http.post<ProvisionRestaurantResponse>(
      `${this.base}/restaurants/provision`,
      payload,
      this.creds
    );
  }

  getRestaurant(restaurantId: string): Observable<{ restaurant: RestaurantDetailDTO }> {
    return this.http.get<{ restaurant: RestaurantDetailDTO }>(
      `${this.base}/restaurants/${restaurantId}`,
      this.creds
    );
  }

  setInventoryManagement(
    restaurantId: string,
    enabled: boolean,
  ): Observable<{ restaurantId: string; inventoryManagementEnabled: boolean }> {
    return this.http.put<{ restaurantId: string; inventoryManagementEnabled: boolean }>(
      `${this.base}/restaurants/${restaurantId}/inventory-management`,
      { enabled },
      this.creds,
    );
  }
}
