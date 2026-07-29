import { UserContextModel } from '../models/userContextModel';

const USER_CTX_KEY = 'UserCtx';
const RESTAURANT_CTX_KEY = 'RestaurantCtx';

function readJson<T>(key: string): T | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

function removeKey(key: string): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Drop legacy shared localStorage auth keys (one browser profile = one cookie jar). */
export function clearLegacyAuthLocalStorage(): void {
  try {
    localStorage.removeItem(USER_CTX_KEY);
    localStorage.removeItem(RESTAURANT_CTX_KEY);
  } catch {
    // ignore
  }
}

export function readAuthUserCtx(): UserContextModel | null {
  return readJson<UserContextModel>(USER_CTX_KEY);
}

export function writeAuthUserCtx(user: UserContextModel): void {
  writeJson(USER_CTX_KEY, user);
}

export function clearAuthUserCtx(): void {
  removeKey(USER_CTX_KEY);
}

export function readAuthRestaurantCtx(): { name: string; type: string } | null {
  return readJson<{ name: string; type: string }>(RESTAURANT_CTX_KEY);
}

export function writeAuthRestaurantCtx(ctx: { name: string; type: string }): void {
  writeJson(RESTAURANT_CTX_KEY, ctx);
}

export function clearAuthRestaurantCtx(): void {
  removeKey(RESTAURANT_CTX_KEY);
}

export function clearAuthSessionStorageForTests(): void {
  clearAuthUserCtx();
  clearAuthRestaurantCtx();
}
