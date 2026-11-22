import { maskAddress } from '@uposhom/applink-client';
import type { ServiceDeps } from '../services/deps.js';
import type { DeliveryStatus } from '../stores/types.js';

/** After this many UNDELIVERABLE reports in a row the number is treated as dead. */
export const DEAD_NUMBER_THRESHOLD = 3;

const ALIASES: Record<string, DeliveryStatus> = {
  DELIVERED: 'DELIVERED',
  DELIVRD: 'DELIVERED',
  EXPIRED: 'EXPIRED',
  DELETED: 'DELETED',
  UNDELIVERABLE: 'UNDELIVERABLE',
  UNDELIV: 'UNDELIVERABLE',
  ACCEPTED: 'ACCEPTED',
  ACCEPTD: 'ACCEPTED',
  UNKNOWN: 'UNKNOWN',
  REJECTED: 'REJECTED',
  REJECTD: 'REJECTED',
};

/** SMPP spellings are normalised on the way in. Anything unrecognised is UNKNOWN. */
export function normaliseDeliveryStatus(raw: string): DeliveryStatus {
  return ALIASES[raw.trim().toUpperCase()] ?? 'UNKNOWN';
}

const FAILURES = new Set<DeliveryStatus>(['UNDELIVERABLE', 'EXPIRED', 'REJECTED']);

/** Reports arrive late, twice, out of order or never. A later, "better" state wins. */
const RANK: Record<DeliveryStatus, number> = {
  UNKNOWN: 0,
  ACCEPTED: 1,
  DELETED: 2,
  EXPIRED: 2,
  REJECTED: 2,
  UNDELIVERABLE: 2,
  DELIVERED: 3,
};

export interface ReportPayload {
  requestId: string;
  deliveryStatus: string;
  destinationAddress: string;
}

export function createReportHandler(deps: ServiceDeps) {
  return async function handleReport(data: ReportPayload): Promise<void> {
    const status = normaliseDeliveryStatus(data.deliveryStatus);
    const row = await deps.stores.smsLog.findByRequestId(data.requestId);
    if (!row) {
      // Not a message we sent: acknowledge and discard.
      deps.log.info({ requestId: data.requestId }, 'delivery report matches no sms_log row');
      return;
    }

    // ACCEPTED is not DELIVERED, and a late ACCEPTED must not undo DELIVERED.
    const current = row.deliveryStatus;
    if (current && RANK[status] < RANK[current]) return;
    if (current === status) return; // repeated report

    await deps.stores.smsLog.update(row.id, { deliveryStatus: status }, deps.now());
    deps.log.info(
      {
        requestId: data.requestId,
        subscriber: maskAddress(row.subscriberId),
        deliveryStatus: status,
      },
      'delivery report applied',
    );

    if (!FAILURES.has(status)) return;

    await deps.ports.onSmsDeliveryFailure({
      subscriberId: row.subscriberId,
      purpose: row.purpose,
      critical: row.critical,
      requestId: data.requestId,
    });

    if (status === 'UNDELIVERABLE') {
      const recent = await deps.stores.smsLog.recentForSubscriber(
        row.subscriberId,
        DEAD_NUMBER_THRESHOLD,
      );
      const allDead =
        recent.length >= DEAD_NUMBER_THRESHOLD &&
        recent.every((r) => r.deliveryStatus === 'UNDELIVERABLE');
      if (allDead) {
        await deps.stores.optOuts.suppress(
          { subscriberId: row.subscriberId, reason: 'DEAD_NUMBER', source: 'SYSTEM' },
          deps.now(),
        );
        deps.log.warn(
          { subscriber: maskAddress(row.subscriberId) },
          'number marked dead after repeated UNDELIVERABLE',
        );
      }
    }
  };
}
