import { describe, expect, it } from 'vitest';
import { normalizePatternText, parsePattern, parseQuantity } from '../src/index.js';

const slots = (quantities: number[], mealRelation: 'AC' | 'PC' | null = null) => ({
  kind: 'SLOTS',
  quantities,
  mealRelation,
});
const invalid = (problem: string) => expect.objectContaining({ kind: 'INVALID', problem });

describe('parsePattern: numeric patterns', () => {
  it.each([
    ['1+0+1', [1, 0, 1]],
    ['1-0-1', [1, 0, 1]],
    ['1 + 1 + 1', [1, 1, 1]],
    ['0+0+1', [0, 0, 1]],
    ['1+1+1+1', [1, 1, 1, 1]],
    ['2+0+2', [2, 0, 2]],
    ['½+0+½', [0.5, 0, 0.5]],
    ['1½+0+1', [1.5, 0, 1]],
    ['0.5+0+0.5', [0.5, 0, 0.5]],
    ['১+০+১', [1, 0, 1]],
    ['১-১-১', [1, 1, 1]],
    ['০+০+১', [0, 0, 1]],
    ['1–0–1', [1, 0, 1]],
  ])('%s', (input, quantities) => {
    expect(parsePattern(input)).toEqual(slots(quantities));
  });

  it('reads a meal relation inside the pattern', () => {
    expect(parsePattern('1+0+1 BDPC')).toEqual(slots([1, 0, 1], 'PC'));
    expect(parsePattern('1+0+1 b.d. p.c.')).toEqual(slots([1, 0, 1], 'PC'));
    expect(parsePattern('1+0+0 AC')).toEqual(slots([1, 0, 0], 'AC'));
    expect(parsePattern('১+০+১ খাবারের পরে')).toEqual(slots([1, 0, 1], 'PC'));
    expect(parsePattern('১+০+০ খাবার আগে')).toEqual(slots([1, 0, 0], 'AC'));
    expect(parsePattern('1+1+1 TDS')).toEqual(slots([1, 1, 1]));
    expect(parsePattern('1+1+1+1 QID')).toEqual(slots([1, 1, 1, 1]));
    expect(parsePattern('1+0+0 OD')).toEqual(slots([1, 0, 0]));
    expect(parsePattern('0+1+1 BD')).toEqual(slots([0, 1, 1]));
  });

  it('rejects patterns that are not three or four slots', () => {
    expect(parsePattern('1+1')).toEqual(invalid('BAD_SLOT_COUNT'));
    expect(parsePattern('1+1+1+1+1')).toEqual(invalid('BAD_SLOT_COUNT'));
  });

  it('rejects a pattern with no dose at all', () => {
    expect(parsePattern('0+0+0')).toEqual(invalid('NO_DOSE'));
  });

  it('rejects a frequency that disagrees with the numbers', () => {
    expect(parsePattern('1+1+1 BD')).toEqual(invalid('FREQUENCY_CONFLICT'));
    expect(parsePattern('1+0+1 OD')).toEqual(invalid('FREQUENCY_CONFLICT'));
    expect(parsePattern('BD TDS')).toEqual(invalid('FREQUENCY_CONFLICT'));
  });
});

describe('parsePattern: abbreviations', () => {
  it.each([
    ['OD', [1, 0, 0]],
    ['BD', [1, 0, 1]],
    ['BID', [1, 0, 1]],
    ['TDS', [1, 1, 1]],
    ['TID', [1, 1, 1]],
    ['QID', [1, 1, 1, 1]],
    ['QDS', [1, 1, 1, 1]],
    ['bd', [1, 0, 1]],
    ['2 BD', [2, 0, 2]],
    ['½ OD', [0.5, 0, 0]],
  ])('%s', (input, quantities) => {
    expect(parsePattern(input)).toEqual(slots(quantities));
  });

  it('keeps BD and BID the same frequency', () => {
    expect(parsePattern('BD BID')).toEqual(slots([1, 0, 1]));
  });

  it('reads TDS PC and similar', () => {
    expect(parsePattern('TDS PC')).toEqual(slots([1, 1, 1], 'PC'));
    expect(parsePattern('ODAC')).toEqual(slots([1, 0, 0], 'AC'));
  });

  it('reads HS as one bedtime dose', () => {
    expect(parsePattern('HS')).toEqual({ kind: 'BEDTIME', quantity: 1, mealRelation: null });
    expect(parsePattern('2 HS')).toEqual({ kind: 'BEDTIME', quantity: 2, mealRelation: null });
    expect(parsePattern('0+0+1 HS')).toEqual({ kind: 'BEDTIME', quantity: 1, mealRelation: null });
    expect(parsePattern('0+0+0+½ HS PC')).toEqual({
      kind: 'BEDTIME',
      quantity: 0.5,
      mealRelation: 'PC',
    });
  });

  it('rejects HS on a pattern with doses before night', () => {
    expect(parsePattern('1+0+1 HS')).toEqual(invalid('BEDTIME_CONFLICT'));
    expect(parsePattern('1+0+0 HS')).toEqual(invalid('BEDTIME_CONFLICT'));
  });

  it('reads SOS and PRN as as-needed, with nothing scheduled', () => {
    expect(parsePattern('SOS')).toEqual({ kind: 'AS_NEEDED' });
    expect(parsePattern('prn')).toEqual({ kind: 'AS_NEEDED' });
    expect(parsePattern('1 SOS')).toEqual({ kind: 'AS_NEEDED' });
    expect(parsePattern('প্রয়োজনে')).toEqual({ kind: 'AS_NEEDED' });
  });

  it('rejects SOS mixed with a schedule', () => {
    expect(parsePattern('1+0+1 SOS')).toEqual(invalid('AS_NEEDED_CONFLICT'));
    expect(parsePattern('BD SOS')).toEqual(invalid('AS_NEEDED_CONFLICT'));
    expect(parsePattern('STAT SOS')).toEqual(invalid('AS_NEEDED_CONFLICT'));
  });

  it('reads STAT as one immediate dose', () => {
    expect(parsePattern('STAT')).toEqual({ kind: 'STAT', quantity: 1 });
    expect(parsePattern('2 STAT')).toEqual({ kind: 'STAT', quantity: 2 });
    expect(parsePattern('0 STAT')).toEqual(invalid('NO_DOSE'));
  });

  it('rejects STAT mixed with a schedule', () => {
    expect(parsePattern('1+0+1 STAT')).toEqual(invalid('STAT_CONFLICT'));
    expect(parsePattern('BD STAT')).toEqual(invalid('STAT_CONFLICT'));
  });

  it('rejects before and after meals together', () => {
    expect(parsePattern('1+0+1 AC PC')).toEqual(invalid('MEAL_CONFLICT'));
  });

  it('rejects a zero quantity before a frequency', () => {
    expect(parsePattern('0 BD')).toEqual(invalid('NO_DOSE'));
  });
});

describe('parsePattern: never guesses', () => {
  it.each(['', '   '])('empty input %j', (input) => {
    expect(parsePattern(input)).toEqual(invalid('EMPTY'));
  });

  it('a meal word alone is not a schedule', () => {
    expect(parsePattern('PC')).toEqual(invalid('EMPTY'));
  });

  it('a lone number is not a schedule', () => {
    expect(parsePattern('1')).toEqual(invalid('BAD_SLOT_COUNT'));
  });

  it.each(['1+0+1 for 5 days', 'twice daily', '1+0+1 X', 'Q8H', '1x3'])(
    'unknown words: %s',
    (input) => {
      expect(parsePattern(input)).toEqual(invalid('UNKNOWN_TOKEN'));
    },
  );

  it('reports the unknown part', () => {
    expect(parsePattern('1+0+1 BD XYZ')).toEqual({
      kind: 'INVALID',
      problem: 'UNKNOWN_TOKEN',
      detail: 'XYZ',
    });
  });
});

describe('helpers', () => {
  it('normalizePatternText converts Bangla digits and dashes', () => {
    expect(normalizePatternText('১+০—১ bd')).toBe('1+0-1 BD');
  });

  it('parseQuantity', () => {
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('2½')).toBe(2.5);
    expect(parseQuantity('1.5')).toBe(1.5);
    expect(parseQuantity('3')).toBe(3);
  });
});
