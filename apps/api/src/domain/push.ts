/**
 * Expo push for caregiver alerts (Master Plan section 6: "caregiver alert via Expo Push and SMS").
 * Push is best effort: SMS carries every alert too, so a phone without push still hears about it.
 *
 * Expo answers each message with a ticket. A ticket saying DeviceNotRegistered means the app was
 * uninstalled or the token rotated, so that token is deleted. Anything else that fails is
 * reported to the caller, which retries through the queue. Message text is never logged.
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo takes at most 100 messages per request. */
const EXPO_BATCH = 100;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushTicket = { ok: true } | { ok: false; unregistered: boolean; error: string };

export interface PushSender {
  /** One ticket per message, in order. Throws when Expo cannot be reached (the queue retries). */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

/** For tests and for when push is switched off: every message "succeeds" and goes nowhere. */
export const noopPushSender: PushSender = {
  async send(messages) {
    return messages.map(() => ({ ok: true }) as const);
  },
};

const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;
export const isExpoPushToken = (token: string): boolean => TOKEN_RE.test(token);

export function createExpoPushSender(opts: {
  accessToken?: string | undefined;
  url?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): PushSender {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += EXPO_BATCH) {
        const batch = messages.slice(i, i + EXPO_BATCH);
        const res = await doFetch(opts.url ?? EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((m) => ({ ...m, priority: 'high', sound: 'default', ttl: 3600 })),
          ),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
        });
        if (!res.ok) throw new Error(`expo push http ${res.status}`);
        const json = (await res.json()) as {
          data?: Array<{ status?: string; message?: string; details?: { error?: string } }>;
        };
        const data = json.data ?? [];
        batch.forEach((_, k) => {
          const t = data[k];
          if (t?.status === 'ok') {
            tickets.push({ ok: true });
          } else {
            const error = t?.details?.error ?? 'UNKNOWN';
            tickets.push({ ok: false, unregistered: error === 'DeviceNotRegistered', error });
          }
        });
      }
      return tickets;
    },
  };
}

export const PUSH_QUEUE = 'push.send';
export const PUSH_RETRY_LIMIT = 3;

export interface PushJobPayload {
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /** One push per logical alert, even if the job is enqueued again. */
  idempotencyKey: string;
}

/**
 * The queue handler for `push.send`: sends to every phone the user has registered. A transport
 * failure throws, so the queue retries with backoff; per-message errors are final.
 */
export function createPushHandler(deps: {
  listTokens: (userId: string) => Promise<string[]>;
  removeToken: (token: string) => Promise<void>;
  sender: PushSender;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}) {
  return async function handle(job: { data: PushJobPayload }): Promise<void> {
    const p = job.data;
    const tokens = await deps.listTokens(p.userId);
    if (tokens.length === 0) return;
    const tickets = await deps.sender.send(
      tokens.map((to) => ({ to, title: p.title, body: p.body, data: p.data })),
    );
    let sent = 0;
    for (const [i, t] of tickets.entries()) {
      if (t.ok) {
        sent++;
      } else if (t.unregistered) {
        await deps.removeToken(tokens[i]!);
      } else {
        deps.log.warn({ error: t.error, key: p.idempotencyKey }, 'push rejected');
      }
    }
    deps.log.info({ key: p.idempotencyKey, sent, devices: tokens.length }, 'push sent');
  };
}
