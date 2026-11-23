import { ApiError } from '../api/client';
import { bn, type TFn } from '../i18n';

type ErrKey = keyof typeof bn.errors;
type ReasonKey = keyof typeof bn.manualReasons;

/**
 * Plain-Bangla message for any error, never a raw code. The server sends a stable `code`, and
 * sometimes a `message` that refines it (INVALID_INPUT + MEAL_TIME_ORDER). A network failure is its own case.
 */
export function errorMessage(e: unknown, t: TFn, fallback: ErrKey = 'SERVICE_TROUBLE'): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return t('errors.NETWORK');
    if (e.message in bn.errors) return t(`errors.${e.message as ErrKey}`);
    if (e.code in bn.errors) return t(`errors.${e.code as ErrKey}`);
  }
  return t(`errors.${fallback}`);
}

export interface ManualInputProblem {
  index: number;
  reasons: string[];
}

/** NEEDS_MANUAL_INPUT carries [{ index, reasons }]: which items the schedule engine would not guess. */
export function manualInputProblems(e: unknown): ManualInputProblem[] | null {
  if (!(e instanceof ApiError) || e.code !== 'NEEDS_MANUAL_INPUT' || !Array.isArray(e.details))
    return null;
  return (e.details as unknown[]).flatMap((d) => {
    if (typeof d !== 'object' || d === null) return [];
    const o = d as { index?: unknown; reasons?: unknown };
    if (typeof o.index !== 'number' || !Array.isArray(o.reasons)) return [];
    return [
      { index: o.index, reasons: o.reasons.filter((r): r is string => typeof r === 'string') },
    ];
  });
}

export function reasonText(reason: string, t: TFn): string {
  return reason in bn.manualReasons
    ? t(`manualReasons.${reason as ReasonKey}`)
    : t('errors.INVALID_INPUT');
}
