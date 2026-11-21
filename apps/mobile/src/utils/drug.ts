import { toBn } from './bangla';

const FORM_BN: Record<string, string> = {
  tablet: 'ট্যাবলেট',
  capsule: 'ক্যাপসুল',
  syrup: 'সিরাপ',
  suspension: 'সাসপেনশন',
  injection: 'ইনজেকশন',
  drops: 'ড্রপ',
  cream: 'ক্রিম',
  ointment: 'মলম',
  inhaler: 'ইনহেলার',
  sachet: 'স্যাশে',
};

/** 'Tablet' to 'ট্যাবলেট'. Unknown forms pass through. */
export function formStrengthFormBn(form: string | undefined): string {
  if (!form) return '';
  return FORM_BN[form.toLowerCase().trim()] ?? form;
}

/** '500mg+65mg' to '৫০০+৬৫ মি.গ্রা.', '20mg' to '২০ মি.গ্রা.', '5ml' to '৫ মি.লি.' */
export function strengthBn(strength: string | undefined): string {
  if (!strength) return '';
  const units = [...new Set(strength.toLowerCase().match(/mg|mcg|ml|g|iu/g) ?? [])];
  const numbers = strength.replace(/(mg|mcg|ml|iu|g)/gi, '').replace(/\s+/g, '');
  const unit =
    units.length === 0
      ? ''
      : units
          .map(
            (u) =>
              ({ mg: 'মি.গ্রা.', mcg: 'মাইক্রোগ্রাম', ml: 'মি.লি.', g: 'গ্রাম', iu: 'আইইউ' })[u] ?? u,
          )
          .join(' ');
  return `${toBn(numbers)}${unit ? ` ${unit}` : ''}`;
}

/** 'ট্যাবলেট • ৫০০+৬৫ মি.গ্রা.' (design.md 6.1 form and strength badge). */
export function formAndStrengthBn(form: string | undefined, strength: string | undefined): string {
  return [formStrengthFormBn(form), strengthBn(strength)].filter(Boolean).join(' • ');
}

/** Savings between two indicative prices, rounded; null if not cheaper. Never claims bioequivalence. */
export function savingPercent(original: number, alt: number): number | null {
  if (!(original > 0) || alt >= original) return null;
  return Math.round(((original - alt) / original) * 100);
}
