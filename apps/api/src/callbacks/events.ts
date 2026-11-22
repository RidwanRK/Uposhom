import { z } from 'zod';

/**
 * Inbound Applink payloads (references/07-callbacks.md). Unknown fields are kept (`loose`): the
 * platform adds fields without notice. Only what a handler needs is required.
 */
const str = z.string().min(1);

export const smsReceive = z.looseObject({
  applicationId: z.string().optional(),
  sourceAddress: str,
  message: z.string(),
  requestId: str,
  encoding: z.string().optional(),
});

export const smsReport = z.looseObject({
  destinationAddress: str,
  requestId: str,
  deliveryStatus: str,
  timeStamp: z.string().optional(),
});

export const ussdReceive = z.looseObject({
  applicationId: z.string().optional(),
  sessionId: str,
  requestId: str,
  ussdOperation: z.enum(['mo-init', 'mo-cont']),
  sourceAddress: str,
  message: z.string(),
});

export const subscriptionNotify = z.looseObject({
  applicationId: z.string().optional(),
  subscriberId: str,
  status: str,
  timeStamp: str,
  frequency: z.string().optional(),
});

export const chargingNotification = z.looseObject({
  externalTrxId: str,
  statusCode: str,
  statusDetail: z.string().optional(),
  internalTrxId: z.string().optional(),
  paidAmount: z.string().optional(),
  balanceDue: z.string().optional(),
  TotalAmount: z.string().optional(),
  currency: z.string().optional(),
});

export type CallbackEvent =
  | { type: 'sms.mo'; data: z.infer<typeof smsReceive> }
  | { type: 'sms.report'; data: z.infer<typeof smsReport> }
  | { type: 'ussd.mo'; data: z.infer<typeof ussdReceive> }
  | { type: 'subscription.notify'; data: z.infer<typeof subscriptionNotify> }
  | { type: 'charging.notification'; data: z.infer<typeof chargingNotification> };

export type CallbackKind = CallbackEvent['type'];

/** Where validated, deduplicated events go. Day 2 swaps the default for a pg-boss enqueue. */
export interface CallbackSink {
  handle(event: CallbackEvent): Promise<void>;
}

/** Dedupe key per callback type (references/07-callbacks.md, rule 2). */
export function dedupeKey(event: CallbackEvent): string {
  switch (event.type) {
    case 'sms.mo':
      return `sms.mo:${event.data.requestId}`;
    case 'sms.report':
      return `sms.report:${event.data.requestId}:${event.data.deliveryStatus}`;
    case 'ussd.mo':
      return `ussd.mo:${event.data.requestId}`;
    case 'subscription.notify':
      return `subscription.notify:${event.data.subscriberId}:${event.data.status}:${event.data.timeStamp}`;
    case 'charging.notification':
      return `charging.notification:${event.data.externalTrxId}:${event.data.statusCode}`;
  }
}
