import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { MenuItem, MenuManagementResponse, MenuResponse } from '../../models/menu/menuItem';
import { SetMenuDTO, SetMenuLineInput, WeeklySetMenuResponse } from '../../models/menu/setMenu';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MenuItemEntity, OfflineDbService } from '../../offline/offline-db';
import { menuItemWithNormalizedCategory } from '../../models/menu/cart-item-category';


@Injectable({
  providedIn: 'root'
})
export class MenuItemServiceService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient, private offlineDB: OfflineDbService) { }

  getAll(restaurantId: string): Observable<MenuResponse> {
    return this.http.get<MenuResponse>(`${this.apiUrl}/api/restaurants/${restaurantId}/staff/menu`, { withCredentials: true });
  }

  /** Filtered menu for manager UI + saved presentation mode from DB. */
  getManagementMenu(restaurantId: string, clientDate: string): Observable<MenuManagementResponse> {
    const params = new HttpParams().set('clientDate', clientDate);
    return this.http.get<MenuManagementResponse>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu/management`,
      { params, withCredentials: true }
    );
  }

  updateMenuPresentation(
    restaurantId: string,
    body: { menuPresentationMode: string }
  ): Observable<{ menuPresentationMode: string }> {
    return this.http.patch<{ menuPresentationMode: string }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu-presentation`,
      body,
      { withCredentials: true }
    );
  }

  create(restaurantId: string, formData: FormData): Observable<MenuItem> {
    return this.http.post<MenuItem>(`${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu`, formData, { withCredentials: true });
  }

  update(restaurantId: string, menuItemId: string, formData: FormData): Observable<MenuItem> {
    return this.http.put<MenuItem>(`${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu/${menuItemId}`, formData, { withCredentials: true });
  }

  updatePriceAmount(
    restaurantId: string,
    menuItemId: string,
    menuItemPriceAmount: number,
  ): Observable<{ menuId: string; menuItem: MenuItem }> {
    return this.http.patch<{ menuId: string; menuItem: MenuItem }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu/${menuItemId}/price`,
      { menuItemPriceAmount },
      { withCredentials: true },
    );
  }

  delete(restaurantId: string, menuItemId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu/${menuItemId}`, { withCredentials: true });
  }

  setAvailability(restaurantId: string, menuItemId: string, isAvailable: boolean): Observable<{ menuId: string; menuItem: MenuItem }> {
    return this.http.patch<{ menuId: string; menuItem: MenuItem }>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/menu/${menuItemId}/availability`,
      { isAvailable },
      { withCredentials: true }
    );
  }

  // async getAllWithFallback(restaurantId: string): Promise<{ menuItems: MenuItem[], categories: string[] }> {
  //   if (navigator.onLine) {
  //     try {
  //       const response = await firstValueFrom(this.getAll(restaurantId));

  //       // Backend returns an array of menus → extract all menuItems
  //       const allItems: MenuItem[] = response.flatMap(m => m.menu.menuItems);

  //       // Save to Dexie
  //       await this.offlineDB.transaction('rw', this.offlineDB.menuItems, async () => {
  //         await this.offlineDB.menuItems.clear();
  //         await this.offlineDB.menuItems.bulkAdd(allItems);
  //       });

  //       const categories = [...new Set(allItems.map(i => i.category))];

  //       return { menuItems: allItems, categories };

  //     } catch (err) {
  //       console.warn('[MenuService] Online fetch failed, using Dexie fallback');
  //       return this.loadFromDexie();
  //     }
  //   }

  //   // Offline → Dexie fallback
  //   return this.loadFromDexie();
  // }

async getAllWithFallback(
  restaurantId: string
): Promise<{ menuItems: MenuItem[], categories: string[], todaySetMenu?: SetMenuDTO | null }> {

  let todaySetMenu: SetMenuDTO | null | undefined;

  try {
    const response = await firstValueFrom(this.getAll(restaurantId));

    const menuItems = (response.menu.menuItems ?? []).map(menuItemWithNormalizedCategory);
    todaySetMenu = response.todaySetMenu ?? null;

    await this.offlineDB.cacheMenu(menuItems);

  } catch (err) {
    console.warn('[MenuItemService] Backend unavailable, using Dexie fallback');
  }

  const loaded = await this.offlineDB.loadMenu();
  return { ...loaded, todaySetMenu };
}

  /** Force network fetch and Dexie refresh (e.g. after currency mismatch). */
  async forceRefreshFromServer(restaurantId: string): Promise<void> {
    const response = await firstValueFrom(this.getAll(restaurantId));
    const menuItems = (response.menu.menuItems ?? []).map(menuItemWithNormalizedCategory);
    await this.offlineDB.cacheMenu(menuItems);
  }

  getWeeklySetMenu(restaurantId: string): Observable<WeeklySetMenuResponse> {
    return this.http.get<WeeklySetMenuResponse>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/set-menu/weekly`,
      { withCredentials: true }
    );
  }

  upsertSetMenu(
    restaurantId: string,
    weekday: number,
    body: { title: string; priceAmount: number; lines: SetMenuLineInput[]; isAvailable: boolean; sourceLocale?: string }
  ): Observable<SetMenuDTO> {
    return this.http.put<SetMenuDTO>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/admin/set-menu/${weekday}`,
      body,
      { withCredentials: true }
    );
  }

  getTodaySetMenu(restaurantId: string): Observable<SetMenuDTO> {
    return this.http.get<SetMenuDTO>(
      `${this.apiUrl}/api/restaurants/${restaurantId}/staff/set-menu/today`,
      { withCredentials: true }
    );
  }




  // private async loadFromDexie(): Promise<{ menuItems: MenuItem[], categories: string[] }> {
  //   const menuItems = await this.offlineDB.menuItems.toArray() as MenuItemEntity[];

  //   const categories: string[] = [...new Set(menuItems.map((i: MenuItemEntity) => i.category))];

  //   return { menuItems, categories };
  // }

}
