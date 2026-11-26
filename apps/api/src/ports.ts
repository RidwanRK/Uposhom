/**
 * Seams to the domain layer (workstream B). Platform code (A) calls these; B supplies real
 * implementations when the dose and appointment tables exist. The defaults keep every channel
 * working and honest in the meantime: they change no state and say so.
 */

export type DoseReplyCode = 'TAKEN' | 'SNOOZE' | 'SKIP';

export interface DomainPorts {
  /**
   * A subscriber replied to a reminder (SMS). `profileTag` is the short tag when one number
   * serves several profiles. Return the text to SMS back, or null to stay silent. An MO SMS is not
   * authenticated beyond its source address: this may mark a dose taken, snoozed or skipped, and
   * must never do anything destructive or involving money.
   */
  doseReply(input: {
    subscriberId: string;
    code: DoseReplyCode;
    profileTag: string | null;
  }): Promise<{ replyText: string | null }>;

  /**
   * Delete everything the DOMAIN layer holds about this person (profiles, prescriptions, doses,
   * reports...). Called first when an account is erased, because domain rows refer to the user.
   * The default does nothing until the domain tables exist.
   */
  eraseDomainData(userId: string): Promise<void>;

  /**
   * True when this subscriber id is a dependent's own phone, bound to a profile by Family Link.
   * Such a sender has no account, but their replies and STOP still count (Master Plan section 8).
   */
  isProfileSubscriber(subscriberId: string): Promise<boolean>;

  /**
   * A free-text SMS from a known subscriber ("what is my next medicine?"). Read-only: the answer
   * comes from the AI router over that person's own doses. `replyText` null means "send the usage
   * line instead"; `silent` means send nothing (for example the daily question cap is used up).
   */
  smsQuestion(input: {
    subscriberId: string;
    text: string;
  }): Promise<{ replyText: string | null; silent?: boolean }>;

  /** A STOP came from a dependent's own phone: record the opt-out against their profile. */
  onProfileOptOut(input: { subscriberId: string; source: 'SMS' }): Promise<void>;

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
  async eraseDomainData() {
    // Nothing to delete until the domain tables exist.
  },
  async onSmsDeliveryFailure() {
    // Nothing to escalate until B's reminder state machine exists.
  },
  async isProfileSubscriber() {
    return false;
  },
  async smsQuestion() {
    return { replyText: null };
  },
  async onProfileOptOut() {
    // Nothing to record until the domain tables exist.
  },
};
