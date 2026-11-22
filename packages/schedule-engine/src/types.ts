/**
 * Types for the deterministic schedule engine (Master Plan section 6).
 *
 * The engine is pure: no I/O, no clock, no randomness. Everything it needs arrives in the input,
 * so the same input always gives the same dose events.
 */

/** How a dose relates to the meal at its slot. Same values as `mealRelation` in @uposhom/shared. */
export type MealRelation = 'AC' | 'PC' | 'WITH_MEAL' | 'NONE';

/** A slot in the day a dose can belong to. */
export type Slot = 'MORNING' | 'NOON' | 'EVENING' | 'NIGHT' | 'BEDTIME' | 'STAT';

/** A profile's meal times, 'HH:mm' in Asia/Dhaka. Must be strictly increasing through the day. */
export interface AnchorTimes {
  morning: string;
  noon: string;
  evening: string;
  night: string;
}

/** Minutes added to the meal time for each relation. Negative means before the meal. */
export interface MealOffsets {
  AC: number;
  PC: number;
  WITH_MEAL: number;
  NONE: number;
  /** Minutes after the night meal that count as bedtime (HS). */
  bedtimeAfterNight: number;
}

export interface EngineConfig {
  offsets: MealOffsets;
  /** Longest course the engine accepts, in days. Longer is treated as a typing mistake. */
  maxDurationDays: number;
  /** Largest quantity accepted in one slot (tablets, capsules). */
  maxQuantityPerSlot: number;
  /** Items whose confidence is below this need a person to re-enter them. */
  minConfidence: number;
}

/** One confirmed prescription item, as the API hands it to the engine. */
export interface PrescribedItem {
  /** Stable id of the item (for example the prescription_items row id). Unique within a call. */
  key: string;
  /** The dosage pattern as confirmed, e.g. '1+0+1', '১+০+১', '1+0+1 BDPC', 'TDS', 'SOS'. */
  pattern: string;
  /** Meal relation picked on the confirm screen. Defaults to NONE. */
  mealRelation?: MealRelation;
  /** Course length in days, counted from the start date. Required unless as-needed or STAT. */
  durationDays?: number;
  /** Set by a person, never by the model. Carried onto every dose event. */
  isCritical?: boolean;
  /** Units dispensed; used to work out when the supply runs out. */
  pillCount?: number;
  /** 0 to 1, when the item still carries a model confidence. */
  confidence?: number;
}

export interface ScheduleInput {
  items: PrescribedItem[];
  anchors: AnchorTimes;
  /** First course day, 'YYYY-MM-DD' in Asia/Dhaka. */
  startDate: string;
  /**
   * The moment of confirmation. Doses due before it are left out, and a STAT dose is due at it.
   * ISO string with an offset, or epoch milliseconds.
   */
  now: string | number;
  config?: Partial<Omit<EngineConfig, 'offsets'>> & { offsets?: Partial<MealOffsets> };
}

export type PatternProblem =
  | 'EMPTY'
  | 'UNKNOWN_TOKEN'
  | 'BAD_SLOT_COUNT'
  | 'BAD_QUANTITY'
  | 'NO_DOSE'
  | 'FREQUENCY_CONFLICT'
  | 'MEAL_CONFLICT'
  | 'AS_NEEDED_CONFLICT'
  | 'STAT_CONFLICT'
  | 'BEDTIME_CONFLICT';

/** Result of parsing a dosage pattern on its own. */
export type ParsedPattern =
  | {
      kind: 'SLOTS';
      /** Quantity per slot, 3 slots (morning, noon, night) or 4 (morning, noon, evening, night). */
      quantities: number[];
      /** A meal relation written inside the pattern, such as the PC in '1+0+1 BDPC'. */
      mealRelation: 'AC' | 'PC' | null;
    }
  | { kind: 'BEDTIME'; quantity: number; mealRelation: 'AC' | 'PC' | null }
  | { kind: 'AS_NEEDED' }
  | { kind: 'STAT'; quantity: number }
  | { kind: 'INVALID'; problem: PatternProblem; detail?: string };

export type ManualReason =
  | PatternProblem
  | 'MEAL_RELATION_CONFLICT'
  | 'MISSING_DURATION'
  | 'BAD_DURATION'
  | 'BAD_PILL_COUNT'
  | 'LOW_CONFIDENCE';

/** One scheduled dose. Immutable once generated. */
export interface DoseEvent {
  /** Idempotency key: the same item, day and slot always give the same key. */
  key: string;
  itemKey: string;
  /** The course day this dose belongs to, 'YYYY-MM-DD'. */
  courseDate: string;
  slot: Slot;
  quantity: number;
  mealRelation: MealRelation;
  /** ISO 8601 in Asia/Dhaka, e.g. '2026-11-21T08:30:00+06:00'. */
  dueAt: string;
  dueAtMs: number;
  isCritical: boolean;
}

export type ItemSchedule =
  | {
      key: string;
      status: 'SCHEDULED';
      slots: Slot[];
      dosesPerDay: number;
      unitsPerDay: number;
      /** Last course day, 'YYYY-MM-DD'. Null for a STAT dose. */
      courseEndsOn: string | null;
      /**
       * First course day the pill count no longer covers, so a refill is needed by then. Null when
       * no pill count was given or the supply lasts the whole course.
       */
      refillDueOn: string | null;
      /** Doses of the course that were already in the past at confirmation and were left out. */
      skippedPastDoses: number;
      eventCount: number;
    }
  | { key: string; status: 'AS_NEEDED' }
  | { key: string; status: 'NEEDS_MANUAL_INPUT'; reasons: ManualReason[] };

export interface ScheduleResult {
  /** Every dose of every scheduled item, ordered by time. */
  events: DoseEvent[];
  items: ItemSchedule[];
  /** True when any item needs a person to fix it. The caller must not confirm in that case. */
  needsManualInput: boolean;
}

/** Thrown for input the caller should have rejected: bad anchors, dates or duplicate keys. */
export class ScheduleInputError extends Error {
  constructor(
    readonly code:
      | 'BAD_ANCHOR'
      | 'ANCHORS_OUT_OF_ORDER'
      | 'BAD_START_DATE'
      | 'BAD_NOW'
      | 'DUPLICATE_ITEM_KEY'
      | 'EMPTY_ITEM_KEY',
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}
