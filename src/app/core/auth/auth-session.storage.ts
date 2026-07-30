import { UserContextModel } from '../models/userContextModel';

const USER_CTX_KEY = 'UserCtx';
const RESTAURANT_CTX_KEY = 'RestaurantCtx';

function authStorage(): Storage | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
}

function readJson<T>(key: string): T | null {
  const store = authStorage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = authStorage();
  if (!store) {
    return;
  }
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

function removeKey(key: string): void {
  const store = authStorage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * One-time: move UserCtx / RestaurantCtx from sessionStorage (tab-scoped era)
 * into localStorage (cookie-backed web session).
 */
export function migrateAuthCtxFromSessionStorage(): void {
  if (typeof sessionStorage === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    for (const key of [USER_CTX_KEY, RESTAURANT_CTX_KEY]) {
      if (localStorage.getItem(key)) {
        sessionStorage.removeItem(key);
        continue;
      }
      const raw = sessionStorage.getItem(key);
      if (raw) {
        localStorage.setItem(key, raw);
        sessionStorage.removeItem(key);
      }
    }
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
