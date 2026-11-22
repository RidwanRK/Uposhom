import { SLOTS_FOR_COUNT, resolveAnchors, resolveConfig, slotMinutes } from './anchors.js';
import { addDays, dhakaMidnight, parseInstant, toDhakaDate, toDhakaIso } from './dhaka.js';
import { parsePattern } from './parser.js';
import {
  ScheduleInputError,
  type DoseEvent,
  type EngineConfig,
  type ItemSchedule,
  type ManualReason,
  type MealRelation,
  type PrescribedItem,
  type ScheduleInput,
  type ScheduleResult,
  type Slot,
} from './types.js';

const MINUTE_MS = 60_000;

interface Context {
  anchors: ReturnType<typeof resolveAnchors>;
  config: EngineConfig;
  startMs: number;
  nowMs: number;
}

/**
 * Turns confirmed prescription items into dose events in Asia/Dhaka time.
 *
 * Items the engine cannot schedule exactly come back as NEEDS_MANUAL_INPUT with the reasons, and
 * `needsManualInput` is true: the caller must send them back to the confirm screen rather than
 * save a partial schedule. Input that is wrong in a way the API should have caught (meal times,
 * dates, item keys) throws a ScheduleInputError.
 */
export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const config = resolveConfig(input.config);
  const anchors = resolveAnchors(input.anchors);
  const startMs = dhakaMidnight(input.startDate);
  if (startMs === null) {
    throw new ScheduleInputError(
      'BAD_START_DATE',
      `startDate must be YYYY-MM-DD, got "${input.startDate}"`,
    );
  }
  const nowMs = parseInstant(input.now);
  if (nowMs === null) {
    throw new ScheduleInputError(
      'BAD_NOW',
      'now must be epoch milliseconds or an ISO time with an offset',
    );
  }

  const seen = new Set<string>();
  for (const item of input.items) {
    if (item.key === '') throw new ScheduleInputError('EMPTY_ITEM_KEY', 'every item needs a key');
    if (seen.has(item.key)) {
      throw new ScheduleInputError('DUPLICATE_ITEM_KEY', `item key "${item.key}" is used twice`);
    }
    seen.add(item.key);
  }

  const ctx: Context = { anchors, config, startMs, nowMs };
  const events: Array<DoseEvent & { order: number }> = [];
  const items = input.items.map((item, index) => {
    const { schedule, itemEvents } = scheduleItem(item, ctx);
    for (const e of itemEvents) events.push({ ...e, order: index });
    return schedule;
  });

  events.sort((a, b) => a.dueAtMs - b.dueAtMs || a.order - b.order);
  return {
    events: events.map(({ order: _order, ...e }) => e),
    items,
    needsManualInput: items.some((i) => i.status === 'NEEDS_MANUAL_INPUT'),
  };
}

function scheduleItem(
  item: PrescribedItem,
  ctx: Context,
): { schedule: ItemSchedule; itemEvents: DoseEvent[] } {
  const reasons: ManualReason[] = [];
  const manual = (): { schedule: ItemSchedule; itemEvents: DoseEvent[] } => ({
    schedule: { key: item.key, status: 'NEEDS_MANUAL_INPUT', reasons },
    itemEvents: [],
  });

  if (item.confidence !== undefined && !(item.confidence >= ctx.config.minConfidence)) {
    reasons.push('LOW_CONFIDENCE');
  }

  const parsed = parsePattern(item.pattern);
  if (parsed.kind === 'INVALID') {
    reasons.push(parsed.problem);
    return manual();
  }

  if (parsed.kind === 'AS_NEEDED') {
    if (reasons.length) return manual();
    return { schedule: { key: item.key, status: 'AS_NEEDED' }, itemEvents: [] };
  }

  const isCritical = item.isCritical === true;

  if (parsed.kind === 'STAT') {
    if (parsed.quantity > ctx.config.maxQuantityPerSlot) reasons.push('BAD_QUANTITY');
    if (reasons.length) return manual();
    const event: DoseEvent = {
      key: `${item.key}:STAT`,
      itemKey: item.key,
      courseDate: toDhakaDate(ctx.nowMs),
      slot: 'STAT',
      quantity: parsed.quantity,
      mealRelation: 'NONE',
      dueAt: toDhakaIso(ctx.nowMs),
      dueAtMs: ctx.nowMs,
      isCritical,
    };
    return {
      schedule: {
        key: item.key,
        status: 'SCHEDULED',
        slots: ['STAT'],
        dosesPerDay: 1,
        unitsPerDay: parsed.quantity,
        courseEndsOn: null,
        refillDueOn: null,
        skippedPastDoses: 0,
        eventCount: 1,
      },
      itemEvents: [event],
    };
  }

  // SLOTS or BEDTIME from here on.
  const chosen: MealRelation = item.mealRelation ?? 'NONE';
  if (parsed.mealRelation && chosen !== 'NONE' && chosen !== parsed.mealRelation) {
    reasons.push('MEAL_RELATION_CONFLICT');
  }
  const meal: MealRelation = chosen !== 'NONE' ? chosen : (parsed.mealRelation ?? 'NONE');

  const plan: Array<{ slot: Exclude<Slot, 'STAT'>; quantity: number }> =
    parsed.kind === 'BEDTIME'
      ? [{ slot: 'BEDTIME', quantity: parsed.quantity }]
      : parsed.quantities
          .map((quantity, i) => ({
            slot: SLOTS_FOR_COUNT[parsed.quantities.length as 3 | 4][i] as Exclude<Slot, 'STAT'>,
            quantity,
          }))
          .filter((s) => s.quantity > 0);

  if (plan.some((s) => s.quantity > ctx.config.maxQuantityPerSlot)) reasons.push('BAD_QUANTITY');

  const days = item.durationDays;
  if (days === undefined) {
    reasons.push('MISSING_DURATION');
  } else if (!Number.isInteger(days) || days < 1 || days > ctx.config.maxDurationDays) {
    reasons.push('BAD_DURATION');
  }

  const pills = item.pillCount;
  if (pills !== undefined && !(Number.isFinite(pills) && pills >= 0))
    reasons.push('BAD_PILL_COUNT');

  if (reasons.length) return manual();
  const courseDays = days as number;

  const itemEvents: DoseEvent[] = [];
  let skipped = 0;
  for (let d = 0; d < courseDays; d++) {
    const dayMs = addDays(ctx.startMs, d);
    const courseDate = toDhakaDate(dayMs);
    for (const { slot, quantity } of plan) {
      const dueAtMs = dayMs + slotMinutes(slot, meal, ctx.anchors, ctx.config.offsets) * MINUTE_MS;
      if (dueAtMs < ctx.nowMs) {
        skipped++;
        continue;
      }
      itemEvents.push({
        key: `${item.key}:${courseDate}:${slot}`,
        itemKey: item.key,
        courseDate,
        slot,
        quantity,
        mealRelation: meal,
        dueAt: toDhakaIso(dueAtMs),
        dueAtMs,
        isCritical,
      });
    }
  }

  const unitsPerDay = plan.reduce((sum, s) => sum + s.quantity, 0);
  let refillDueOn: string | null = null;
  if (pills !== undefined) {
    const coveredDays = Math.floor(pills / unitsPerDay);
    if (coveredDays < courseDays) refillDueOn = toDhakaDate(addDays(ctx.startMs, coveredDays));
  }

  return {
    schedule: {
      key: item.key,
      status: 'SCHEDULED',
      slots: plan.map((s) => s.slot),
      dosesPerDay: plan.length,
      unitsPerDay,
      courseEndsOn: toDhakaDate(addDays(ctx.startMs, courseDays - 1)),
      refillDueOn,
      skippedPastDoses: skipped,
      eventCount: itemEvents.length,
    },
    itemEvents,
  };
}
