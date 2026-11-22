/**
 * Seams to the domain layer (workstream B). Platform code (A) calls these; B supplies real
 * implementations when the dose and appointment tables exist. The defaults keep every channel
 * working and honest in the meantime: they change no state and say so.
 */

export type DoseReplyCode = 'TAKEN' | 'SNOOZE' | 'SKIP';

export type UssdAction = 'TODAY' | 'MARK_TAKEN' | 'NEXT_APPOINTMENT' | 'ALERT_CAREGIVER';

export interface DomainPorts {
  /**
   * A subscriber replied to a reminder (SMS or USSD). `profileTag` is the short tag when one number
   * serves several profiles. Return the text to SMS back, or null to stay silent. An MO SMS is not
   * authenticated beyond its source address: this may mark a dose taken, snoozed or skipped, and
   * must never do anything destructive or involving money.
   */
  doseReply(input: {
    subscriberId: string;
    code: DoseReplyCode;
    profileTag: string | null;
  }): Promise<{ replyText: string | null }>;

  /** Text for a USSD menu item. Plain ASCII; anything longer than 160 characters is cut. */
  ussdAction(input: { subscriberId: string; action: UssdAction }): Promise<string>;

  /** A reminder SMS could not be delivered (UNDELIVERABLE, EXPIRED or REJECTED). */
  onSmsDeliveryFailure(input: {
    subscriberId: string;
    purpose: string;
    critical: boolean;
    requestId: string;
  }): Promise<void>;
}

export const defaultDomainPorts: DomainPorts = {
  async doseReply() {
    return { replyText: null };
  },
  async ussdAction() {
    return 'This feature is coming soon. We will send you an SMS.';
  },
  async onSmsDeliveryFailure() {
    // Nothing to escalate until B's reminder state machine exists.
  },
};
