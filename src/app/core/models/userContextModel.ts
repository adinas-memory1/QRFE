export interface UserContextModel {
  id: string;
  role: string;
  restaurantId?: string | null;
  restaurantName?: string | null;
  restaurantType?: string | null;
  /** Preformatted or derived from name + surname for header display. */
  displayName?: string | null;
  name?: string | null;
  surname?: string | null;
  email?: string | null;
  isOfflinePrimaryDevice?: boolean;
  isOfflinePrimaryStaffDesignee?: boolean;
  /** Restaurant has Gestiune (recipes / stock) module enabled. */
  inventoryManagementEnabled?: boolean;
}
