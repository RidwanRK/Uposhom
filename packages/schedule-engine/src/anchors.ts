import { parseClock } from './dhaka.js';
import {
  ScheduleInputError,
  type AnchorTimes,
  type EngineConfig,
  type MealOffsets,
  type MealRelation,
  type Slot,
} from './types.js';

/**
 * Defaults. These are clinical choices, not code choices: the table goes to the named pharmacist or
 * doctor for review (Master Plan section 6) and every value can be overridden per call.
 */
export const DEFAULT_OFFSETS: MealOffsets = {
  AC: -30, // before meals: half an hour before
  PC: 30, // after meals: half an hour after
  WITH_MEAL: 0,
  NONE: 0,
  bedtimeAfterNight: 60, // HS: an hour after the night meal
};

export const DEFAULT_CONFIG: EngineConfig = {
  offsets: DEFAULT_OFFSETS,
  maxDurationDays: 365,
  maxQuantityPerSlot: 4,
  minConfidence: 0.8,
};

/** Suggested meal times for a new profile, 'HH:mm' Asia/Dhaka. */
export const DEFAULT_ANCHORS: AnchorTimes = {
  morning: '08:00',
  noon: '13:30',
  evening: '18:00',
  night: '21:00',
};

/** Which anchor each slot uses, for three-slot and four-slot patterns. */
export const SLOTS_FOR_COUNT: Record<3 | 4, Slot[]> = {
  3: ['MORNING', 'NOON', 'NIGHT'],
  4: ['MORNING', 'NOON', 'EVENING', 'NIGHT'],
};

export function resolveConfig(
  config: (Partial<Omit<EngineConfig, 'offsets'>> & { offsets?: Partial<MealOffsets> }) | undefined,
): EngineConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    offsets: { ...DEFAULT_OFFSETS, ...config?.offsets },
  };
}

/** Anchor minutes after midnight per slot. Throws when a time is malformed or out of order. */
export function resolveAnchors(
  anchors: AnchorTimes,
): Record<'MORNING' | 'NOON' | 'EVENING' | 'NIGHT', number> {
  const order = ['morning', 'noon', 'evening', 'night'] as const;
  const minutes = order.map((name) => {
    const value = parseClock(anchors[name]);
    if (value === null) {
      throw new ScheduleInputError(
        'BAD_ANCHOR',
        `${name} meal time must be HH:mm, got "${anchors[name]}"`,
      );
    }
    return value;
  });
  for (let i = 1; i < minutes.length; i++) {
    if (minutes[i]! <= minutes[i - 1]!) {
      throw new ScheduleInputError(
        'ANCHORS_OUT_OF_ORDER',
        'meal times must run morning, noon, evening, night, each later than the one before',
      );
    }
  }
  const [morning, noon, evening, night] = minutes as [number, number, number, number];
  return { MORNING: morning, NOON: noon, EVENING: evening, NIGHT: night };
}

/** Minutes after the course day's midnight a slot's dose is due. May fall outside 0..1439. */
export function slotMinutes(
  slot: Exclude<Slot, 'STAT'>,
  meal: MealRelation,
  anchors: Record<'MORNING' | 'NOON' | 'EVENING' | 'NIGHT', number>,
  offsets: MealOffsets,
): number {
  if (slot === 'BEDTIME') return anchors.NIGHT + offsets.bedtimeAfterNight;
  return anchors[slot] + offsets[meal];
}
