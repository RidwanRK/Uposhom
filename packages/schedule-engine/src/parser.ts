import type { ParsedPattern } from './types.js';

/**
 * Dosage pattern grammar (Master Plan section 6).
 *
 *   pattern   := [quantities] tokens*
 *   quantities:= qty ( ('+' | '-') qty ){2,3}      three or four slots
 *              | qty                                 a single quantity, only before a frequency
 *   qty       := digits | digits '.5' | digits? '½'  in Latin or Bangla digits
 *   tokens    := OD | BD | BID | TDS | TID | QID | QDS | HS | SOS | PRN | STAT | AC | PC
 *
 * Tokens may be run together ('BDPC') or separated by spaces and dots ('b.d. p.c.'). The common
 * Bangla phrases for before and after meals, and প্রয়োজনে (as needed), are understood too.
 *
 * Anything the grammar does not cover, or that contradicts itself ('1+1+1 BD'), is INVALID with a
 * reason. The parser never guesses: a person fixes the pattern on the confirm screen.
 */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bangla phrases mapped to tokens before tokenising. Longest first so 'খাবারের পরে' wins. */
const BN_PHRASES: ReadonlyArray<readonly [string, string]> = (
  [
    ['খাবারের পরে', ' PC '],
    ['খাবারের আগে', ' AC '],
    ['খাবার পরে', ' PC '],
    ['খাবার আগে', ' AC '],
    ['খাবারের পর', ' PC '],
    ['খাবার পর', ' PC '],
    ['প্রয়োজনে', ' SOS '],
  ] as const
).map(([bn, token]) => [bn.normalize('NFC'), token] as const);

/** Longest first, so 'BID' is read before 'BD' could match a prefix of something else. */
const TOKENS = [
  'STAT',
  'QID',
  'QDS',
  'TDS',
  'TID',
  'BID',
  'PRN',
  'SOS',
  'OD',
  'BD',
  'HS',
  'AC',
  'PC',
];

type Frequency = 'OD' | 'BD' | 'TDS' | 'QID' | 'HS';

const FREQUENCY_OF: Record<string, Frequency> = {
  OD: 'OD',
  BD: 'BD',
  BID: 'BD',
  TDS: 'TDS',
  TID: 'TDS',
  QID: 'QID',
  QDS: 'QID',
  HS: 'HS',
};

/** The slots each frequency means when no numeric pattern is given. */
const TEMPLATE: Record<Exclude<Frequency, 'HS'>, number[]> = {
  OD: [1, 0, 0],
  BD: [1, 0, 1],
  TDS: [1, 1, 1],
  QID: [1, 1, 1, 1],
};

const DOSES_PER_DAY: Record<Exclude<Frequency, 'HS'>, number> = { OD: 1, BD: 2, TDS: 3, QID: 4 };

const QTY = String.raw`(?:\d{1,2}\.5|\d{0,2}½|\d{1,2})`;
const MULTI_RE = new RegExp(String.raw`^\s*(${QTY}(?:\s*[+-]\s*${QTY})+)`);
const SINGLE_RE = new RegExp(String.raw`^\s*(${QTY})(?![\d.½])`);

/** Bangla digits to Latin, dashes to '-', Bangla phrases to tokens, upper case. */
export function normalizePatternText(input: string): string {
  let s = input.normalize('NFC');
  for (const [bn, token] of BN_PHRASES) s = s.split(bn).join(token);
  s = s.replace(/[০-৯]/g, (ch) => String(BN_DIGITS.indexOf(ch)));
  s = s.replace(/[–—−]/g, '-');
  return s.toUpperCase();
}

/** '1' -> 1, '1.5' -> 1.5, '½' -> 0.5, '1½' -> 1.5. Only ever called on text QTY matched. */
export function parseQuantity(text: string): number {
  if (text.endsWith('½')) {
    const whole = text.slice(0, -1);
    return (whole === '' ? 0 : Number(whole)) + 0.5;
  }
  return Number(text);
}

/** Splits the letters after the quantities into known tokens, or returns the first unknown part. */
function tokenize(rest: string): { tokens: string[] } | { unknown: string } {
  const compact = rest.replace(/[\s.,/()]+/g, '');
  const tokens: string[] = [];
  let i = 0;
  while (i < compact.length) {
    const hit = TOKENS.find((t) => compact.startsWith(t, i));
    if (!hit) return { unknown: compact.slice(i) };
    tokens.push(hit);
    i += hit.length;
  }
  return { tokens };
}

export function parsePattern(input: string): ParsedPattern {
  const text = normalizePatternText(input);
  if (text.trim() === '') return { kind: 'INVALID', problem: 'EMPTY' };

  let quantities: number[] | null = null;
  let single: number | null = null;
  let rest = text;

  const multi = MULTI_RE.exec(text);
  if (multi) {
    quantities = multi[1]!.split(/[+-]/).map((q) => parseQuantity(q.trim()));
    rest = text.slice(multi[0].length);
  } else {
    const one = SINGLE_RE.exec(text);
    if (one) {
      single = parseQuantity(one[1]!);
      rest = text.slice(one[0].length);
    }
  }

  const tokenized = tokenize(rest);
  if ('unknown' in tokenized) {
    return { kind: 'INVALID', problem: 'UNKNOWN_TOKEN', detail: tokenized.unknown };
  }
  const { tokens } = tokenized;

  const frequencies = [
    ...new Set(tokens.filter((t) => t in FREQUENCY_OF).map((t) => FREQUENCY_OF[t]!)),
  ];
  if (frequencies.length > 1) return { kind: 'INVALID', problem: 'FREQUENCY_CONFLICT' };
  const frequency = frequencies[0] ?? null;

  const hasAc = tokens.includes('AC');
  const hasPc = tokens.includes('PC');
  if (hasAc && hasPc) return { kind: 'INVALID', problem: 'MEAL_CONFLICT' };
  const mealRelation = hasAc ? 'AC' : hasPc ? 'PC' : null;

  const asNeeded = tokens.includes('SOS') || tokens.includes('PRN');
  const stat = tokens.includes('STAT');

  if (asNeeded) {
    if (quantities || frequency || stat) return { kind: 'INVALID', problem: 'AS_NEEDED_CONFLICT' };
    return { kind: 'AS_NEEDED' };
  }

  if (stat) {
    if (quantities || frequency) return { kind: 'INVALID', problem: 'STAT_CONFLICT' };
    const quantity = single ?? 1;
    if (quantity === 0) return { kind: 'INVALID', problem: 'NO_DOSE' };
    return { kind: 'STAT', quantity };
  }

  if (quantities) {
    if (quantities.length !== 3 && quantities.length !== 4) {
      return { kind: 'INVALID', problem: 'BAD_SLOT_COUNT' };
    }
    if (quantities.every((q) => q === 0)) return { kind: 'INVALID', problem: 'NO_DOSE' };
    if (frequency === 'HS') {
      const last = quantities[quantities.length - 1]!;
      const onlyLast = quantities.slice(0, -1).every((q) => q === 0);
      if (!onlyLast || last === 0) return { kind: 'INVALID', problem: 'BEDTIME_CONFLICT' };
      return { kind: 'BEDTIME', quantity: last, mealRelation };
    }
    if (frequency) {
      const given = quantities.filter((q) => q > 0).length;
      if (given !== DOSES_PER_DAY[frequency]) {
        return { kind: 'INVALID', problem: 'FREQUENCY_CONFLICT' };
      }
    }
    return { kind: 'SLOTS', quantities, mealRelation };
  }

  if (frequency) {
    const quantity = single ?? 1;
    if (quantity === 0) return { kind: 'INVALID', problem: 'NO_DOSE' };
    if (frequency === 'HS') return { kind: 'BEDTIME', quantity, mealRelation };
    return {
      kind: 'SLOTS',
      quantities: TEMPLATE[frequency].map((q) => q * quantity),
      mealRelation,
    };
  }

  // A lone number ('1') or only a meal word ('PC'): not enough to schedule anything.
  return { kind: 'INVALID', problem: single === null ? 'EMPTY' : 'BAD_SLOT_COUNT' };
}
