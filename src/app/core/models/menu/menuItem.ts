import { SetMenuDTO } from './setMenu';

export interface MenuItem {
  menuItemId: string;
  menuItemName: string;
  menuItemDescription?: string;
  menuItemPriceAmount: number;
  category: string;
  menuItemPriceCurrency?: string;
  menuItemIconUrl?: string;
  menuItemVatPercent?: number;
  salesTaxCategory?: string;
  isAvailable?: boolean;
}

export interface MenuResponse {
  menu: {
    menuId: string;
    menuItems: MenuItem[];
  };
  waiterCallCount: number;
  categories: string[];
  restaurantName?: string;
  menuPresentationMode?: string;
  emptyReason?: string | null;
  todaySetMenu?: SetMenuDTO | null;
}

export interface MenuManagementResponse {
  menu: {
    menuId: string;
    menuItems: MenuItem[];
  };
  categories: string[];
  menuPresentationMode: string;
}

export interface WaiterCallResponse {
  restaurantId: string;
  tableId: string;
  counterCalls: number;
  message: string;
}

export enum MenuItemCategory {
  Appetizer = 'Appetizer',
  Starter = 'Starter',
  FirstCourse = 'FirstCourse',
  SecondCourse = 'SecondCourse',
  Pizza = 'Pizza',
  Dessert = 'Dessert',
  RedWine = 'RedWine',
  WhiteWine = 'WhiteWine',
  RoseWine = 'RoseWine',
  Beer = 'Beer',
  Beverage = 'Beverage',
  Cocktail = 'Cocktail',
  Coffee = 'Coffee',
  Tea = 'Tea',
  Pasta = 'Pasta',
  Salad = 'Salad',
  SetMenu = 'SetMenu',
}
