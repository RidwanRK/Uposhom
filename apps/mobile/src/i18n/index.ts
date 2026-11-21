import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { bn, type TKey } from './bn';

// Bangla is the default and only language. i18next stays so more locales can be added later.
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: 'bn',
    fallbackLng: 'bn',
    resources: { bn: { translation: bn } },
    interpolation: { escapeValue: false },
    returnObjects: true,
  });
}

export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

/** Typed translation hook: a mistyped key is a compile error. */
export function useT(): TFn {
  const { t } = useTranslation();
  return (key, vars) => (t as unknown as (k: string, o?: object) => string)(key, vars);
}

/** Same, outside React (notifications, background handlers). */
export const tr: TFn = (key, vars) =>
  (i18next.t as unknown as (k: string, o?: object) => string)(key, vars);

/** Arrays such as the Premium perk list. */
export function trList(
  key: 'premium.perks' | 'premium.pharmacyPerks' | 'legal.termsBody' | 'legal.privacyBody',
): string[] {
  const v = (i18next.t as unknown as (k: string, o?: object) => unknown)(key, {
    returnObjects: true,
  });
  return Array.isArray(v) ? (v as string[]) : [];
}

export { bn };
export type { TKey };
