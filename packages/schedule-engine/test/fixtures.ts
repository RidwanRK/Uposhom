import type { PrescribedItem } from '../src/index.js';

/**
 * 30 synthetic prescriptions, written the way Bangladeshi prescriptions read (printed and
 * handwritten styles, Latin and Bangla digits). No real patient data. Each case states what the
 * engine must produce per item: the slots and doses per day, or that the item is as-needed or must
 * go back to a person.
 *
 * When workstream C's image set lands in data/synthetic-prescriptions/, its transcriptions should
 * agree with these.
 */
export interface Expected {
  status: 'SCHEDULED' | 'AS_NEEDED' | 'NEEDS_MANUAL_INPUT';
  slots?: string[];
  dosesPerDay?: number;
  reasons?: string[];
}

export interface Case {
  id: string;
  title: string;
  items: Array<PrescribedItem & { expect: Expected }>;
}

const S = (slots: string[]): Expected => ({
  status: 'SCHEDULED',
  slots,
  dosesPerDay: slots.length,
});
const M_N = S(['MORNING', 'NIGHT']);
const M = S(['MORNING']);
const N = S(['NIGHT']);
const MNN = S(['MORNING', 'NOON', 'NIGHT']);
const ALL4 = S(['MORNING', 'NOON', 'EVENING', 'NIGHT']);
const PRN: Expected = { status: 'AS_NEEDED' };
const manual = (...reasons: string[]): Expected => ({ status: 'NEEDS_MANUAL_INPUT', reasons });

export const PRESCRIPTIONS: Case[] = [
  {
    id: 'rx01',
    title: 'Fever, adult',
    items: [
      { key: 'napa', pattern: '1+1+1', mealRelation: 'PC', durationDays: 5, expect: MNN },
      { key: 'fexo', pattern: '0+0+1', mealRelation: 'NONE', durationDays: 7, expect: N },
    ],
  },
  {
    id: 'rx02',
    title: 'Gastric, the classic BDPC line',
    items: [
      { key: 'seclo', pattern: '1+0+1 BDAC', durationDays: 14, expect: M_N },
      { key: 'motigut', pattern: '1+1+1 TDS AC', durationDays: 7, expect: MNN },
    ],
  },
  {
    id: 'rx03',
    title: 'Hypertension, long course',
    items: [
      {
        key: 'amlo',
        pattern: '1+0+0',
        mealRelation: 'PC',
        durationDays: 30,
        isCritical: true,
        expect: M,
      },
      {
        key: 'losar',
        pattern: 'OD',
        mealRelation: 'PC',
        durationDays: 30,
        isCritical: true,
        expect: M,
      },
    ],
  },
  {
    id: 'rx04',
    title: 'Type 2 diabetes',
    items: [
      {
        key: 'metf',
        pattern: '1+0+1',
        mealRelation: 'PC',
        durationDays: 30,
        isCritical: true,
        expect: M_N,
      },
      { key: 'glic', pattern: '1+0+0 AC', durationDays: 30, isCritical: true, expect: M },
    ],
  },
  {
    id: 'rx05',
    title: 'Bangla digits throughout',
    items: [
      { key: 'a', pattern: '১+০+১', mealRelation: 'PC', durationDays: 7, expect: M_N },
      { key: 'b', pattern: '০+০+১', durationDays: 10, expect: N },
    ],
  },
  {
    id: 'rx06',
    title: 'Respiratory infection, antibiotic TDS',
    items: [
      {
        key: 'amox',
        pattern: 'TDS',
        mealRelation: 'PC',
        durationDays: 7,
        isCritical: true,
        expect: MNN,
      },
      { key: 'monte', pattern: '0+0+1', durationDays: 14, expect: N },
      { key: 'napa', pattern: 'SOS', expect: PRN },
    ],
  },
  {
    id: 'rx07',
    title: 'Four times a day',
    items: [
      { key: 'fluclox', pattern: '1+1+1+1', mealRelation: 'AC', durationDays: 7, expect: ALL4 },
    ],
  },
  {
    id: 'rx08',
    title: 'QID abbreviation',
    items: [{ key: 'qid', pattern: 'QID', durationDays: 5, expect: ALL4 }],
  },
  {
    id: 'rx09',
    title: 'Half tablets',
    items: [
      { key: 'half', pattern: '½+0+½', mealRelation: 'PC', durationDays: 10, expect: M_N },
      { key: 'onehalf', pattern: '1½+0+0', durationDays: 10, expect: M },
    ],
  },
  {
    id: 'rx10',
    title: 'Bedtime dose',
    items: [{ key: 'sleep', pattern: 'HS', durationDays: 14, expect: S(['BEDTIME']) }],
  },
  {
    id: 'rx11',
    title: 'Night-only written as 0+0+1 HS',
    items: [{ key: 'statin', pattern: '0+0+1 HS', durationDays: 30, expect: S(['BEDTIME']) }],
  },
  {
    id: 'rx12',
    title: 'Hyphen separators, handwritten style',
    items: [
      { key: 'a', pattern: '1-0-1', mealRelation: 'PC', durationDays: 7, expect: M_N },
      { key: 'b', pattern: '1 - 1 - 1', durationDays: 3, expect: MNN },
    ],
  },
  {
    id: 'rx13',
    title: 'Dotted Latin abbreviations',
    items: [{ key: 'a', pattern: 'b.i.d. p.c.', durationDays: 5, expect: M_N }],
  },
  {
    id: 'rx14',
    title: 'Stat dose then a course',
    items: [
      { key: 'stat', pattern: '2 STAT', expect: S(['STAT']) },
      { key: 'course', pattern: 'BD', mealRelation: 'PC', durationDays: 5, expect: M_N },
    ],
  },
  {
    id: 'rx15',
    title: 'Two tablets twice a day',
    items: [{ key: 'a', pattern: '2+0+2', mealRelation: 'PC', durationDays: 5, expect: M_N }],
  },
  {
    id: 'rx16',
    title: 'Noon and night only',
    items: [
      {
        key: 'a',
        pattern: '0+1+1',
        mealRelation: 'PC',
        durationDays: 7,
        expect: S(['NOON', 'NIGHT']),
      },
    ],
  },
  {
    id: 'rx17',
    title: 'Evening slot in a four-slot pattern',
    items: [{ key: 'a', pattern: '0+0+1+0', durationDays: 7, expect: S(['EVENING']) }],
  },
  {
    id: 'rx18',
    title: 'Bangla meal phrase',
    items: [{ key: 'a', pattern: '১+০+১ খাবারের পরে', durationDays: 7, expect: M_N }],
  },
  {
    id: 'rx19',
    title: 'With meals',
    items: [
      { key: 'enzyme', pattern: '1+1+1', mealRelation: 'WITH_MEAL', durationDays: 30, expect: MNN },
    ],
  },
  {
    id: 'rx20',
    title: 'Pain relief as needed only',
    items: [
      { key: 'a', pattern: 'PRN', expect: PRN },
      { key: 'b', pattern: 'প্রয়োজনে', expect: PRN },
    ],
  },
  {
    id: 'rx21',
    title: 'Conflicting frequency goes back to a person',
    items: [
      { key: 'a', pattern: '1+1+1 BD', durationDays: 5, expect: manual('FREQUENCY_CONFLICT') },
    ],
  },
  {
    id: 'rx22',
    title: 'Unreadable pattern',
    items: [{ key: 'a', pattern: '1+?+1', durationDays: 5, expect: manual('UNKNOWN_TOKEN') }],
  },
  {
    id: 'rx23',
    title: 'Duration missing',
    items: [{ key: 'a', pattern: '1+0+1', expect: manual('MISSING_DURATION') }],
  },
  {
    id: 'rx24',
    title: 'Pattern says PC, confirm screen says AC',
    items: [
      {
        key: 'a',
        pattern: '1+0+1 PC',
        mealRelation: 'AC',
        durationDays: 5,
        expect: manual('MEAL_RELATION_CONFLICT'),
      },
    ],
  },
  {
    id: 'rx25',
    title: 'Low-confidence OCR item',
    items: [
      {
        key: 'a',
        pattern: '1+0+1',
        durationDays: 5,
        confidence: 0.4,
        expect: manual('LOW_CONFIDENCE'),
      },
    ],
  },
  {
    id: 'rx26',
    title: 'Implausible quantity',
    items: [{ key: 'a', pattern: '10+0+10', durationDays: 5, expect: manual('BAD_QUANTITY') }],
  },
  {
    id: 'rx27',
    title: 'Zero pattern',
    items: [{ key: 'a', pattern: '0+0+0', durationDays: 5, expect: manual('NO_DOSE') }],
  },
  {
    id: 'rx28',
    title: 'Mixed: as-needed beside a critical course',
    items: [
      { key: 'insulin', pattern: '1+0+1 AC', durationDays: 30, isCritical: true, expect: M_N },
      { key: 'antacid', pattern: 'SOS', expect: PRN },
      { key: 'vitd', pattern: '0+1+0', mealRelation: 'PC', durationDays: 60, expect: S(['NOON']) },
    ],
  },
  {
    id: 'rx29',
    title: 'Long course with a pill count',
    items: [
      {
        key: 'a',
        pattern: '1+0+1',
        mealRelation: 'PC',
        durationDays: 90,
        pillCount: 60,
        expect: M_N,
      },
    ],
  },
  {
    id: 'rx30',
    title: 'Elderly patient, five medicines',
    items: [
      {
        key: 'aspirin',
        pattern: '0+1+0',
        mealRelation: 'PC',
        durationDays: 30,
        isCritical: true,
        expect: S(['NOON']),
      },
      { key: 'atorva', pattern: 'HS', durationDays: 30, expect: S(['BEDTIME']) },
      { key: 'bisoprolol', pattern: '1+0+0', durationDays: 30, isCritical: true, expect: M },
      { key: 'omep', pattern: '1+0+1 BDAC', durationDays: 30, expect: M_N },
      {
        key: 'calcium',
        pattern: '0+1+1',
        mealRelation: 'PC',
        durationDays: 30,
        expect: S(['NOON', 'NIGHT']),
      },
    ],
  },
];
