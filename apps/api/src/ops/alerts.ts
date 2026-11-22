/**
 * Operational alerts (Master Plan section 8): a Slack or Discord webhook fires on configuration-
 * class Applink errors, because they mean the integration is down, and on charges that need a
 * human. Alerts carry identifiers and codes only: no phone numbers, message bodies, OTPs or
 * amounts tied to a person.
 */
export type AlertDetails = Record<string, string | number | boolean>;

export interface Alerter {
  alert(kind: string, details?: AlertDetails): void;
}

export const noopAlerter: Alerter = { alert: () => undefined };

export interface WebhookAlerterOptions {
  url: string;
  /** The same kind of alert is sent at most once per window, so an outage does not flood a channel. */
  dedupeWindowMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Where to say that sending failed. Never throws into the caller. */
  onFailure?: (kind: string) => void;
}

/**
 * Posts `{ text, content }` so the same URL works for Slack (text) and Discord (content).
 * Fire-and-forget: an alert that cannot be delivered is logged by the caller, never thrown.
 */
export function createWebhookAlerter(opts: WebhookAlerterOptions): Alerter {
  const send = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const window = opts.dedupeWindowMs ?? 15 * 60 * 1000;
  const lastSent = new Map<string, number>();

  return {
    alert(kind, details = {}) {
      const t = now();
      const prev = lastSent.get(kind);
      if (prev !== undefined && t - prev < window) return;
      lastSent.set(kind, t);

      const detail = Object.entries(details)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      const text = `[uposhom] ${kind}${detail ? ` ${detail}` : ''}`;
      void send(opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => opts.onFailure?.(kind));
    },
  };
}
