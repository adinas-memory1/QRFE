import { isDevMode } from '@angular/core';

export const APP_LANGS = ['en', 'it', 'fr', 'es', 'de', 'sv', 'ro'] as const;
export type AppLang = (typeof APP_LANGS)[number];

export const DEFAULT_LANG: AppLang = 'en';
export const LANG_STORAGE_KEY = 'appLanguage';

export const translocoConfig = {
  availableLangs: [...APP_LANGS],
  defaultLang: DEFAULT_LANG,
  fallbackLang: 'en',
  reRenderOnLangChange: true,
  prodMode: !isDevMode()
};

