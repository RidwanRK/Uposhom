import { describe, expect, it } from 'vitest';
import type {
  DomainStore,
  DoseRecord,
  PrescriptionItemRecord,
  ProfileRecord,
} from '../src/domain/types.js';

export interface DomainUnderTest {
  store: DomainStore;
  /** Makes a users row exist (Postgres needs it for foreign keys; memory needs nothing). */
  addUser(id: string): Promise<void>;
  cleanup(): Promise<void>;
}

let n = 0;
const uid = (p: string) => `${p}_${++n}_${Math.random().toString(36).slice(2, 7)}`;
const T0 = new Date('2026-11-22T10:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const profileOf = (circleId: string, over: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id: uid('prf'),
  circleId,
  userId: null,
  name: 'Rahim',
  relationship: 'SELF',
  age: null,
  allergies: null,
  mealTimes: { morning: '08:00', noon: '13:30', evening: '18:00', night: '21:00' },
  quietHours: null,
  subscriberId: null,
  smsTag: null,
  createdAt: T0,
  ...over,
});

const itemOf = (prescriptionId: string, over: Partial<PrescriptionItemRecord> = {}) => ({
  id: uid('itm'),
  prescriptionId,
  position: 0,
  brandName: 'Napa',
  strength: '500mg',
  form: 'Tablet',
  parsedPattern: '1+0+1',
  mealRelation: 'PC' as const,
  durationDays: 5,
  pillCount: 10.5,
  asNeeded: false,
  isCritical: true,
  courseEndsOn: '2026-11-26',
  refillDueOn: null,
  ...over,
});

const doseOf = (
  profileId: string,
  itemId: string,
  min: number,
  over: Partial<DoseRecord> = {},
) => ({
  id: uid('dose'),
  profileId,
  prescriptionItemId: itemId,
  idempotencyKey: `${itemId}:${min}`,
  courseDate: '2026-11-22',
  slot: 'NIGHT' as const,
  quantity: 1.5,
  mealRelation: 'PC' as const,
  dueAt: at(min),
  isCritical: true,
  status: 'SCHEDULED' as const,
  stage: 'PENDING' as const,
  snoozedUntil: null,
  actedAt: null,
  ...over,
});

const logOf = (doseEventId: string) => ({
  doseEventId,
  action: 'TAKEN' as const,
  channel: 'APP' as const,
  actorUserId: null,
  reason: null,
  at: at(1),
});

/** Behaviour every DomainStore must share. */
export function domainContract(label: string, make: () => Promise<DomainUnderTest>): void {
  describe(`${label} domain store contract`, { timeout: 30_000 }, () => {
    const withStore = async (fn: (t: DomainUnderTest) => Promise<void>) => {
      const t = await make();
      try {
        await fn(t);
      } finally {
        await t.cleanup();
      }
    };

    /** A user with a circle and own profile. */
    const owner = async (t: DomainUnderTest) => {
      const userId = uid('usr');
      await t.addUser(userId);
      const circle = { id: uid('cir'), ownerUserId: userId, createdAt: T0 };
      const self = profileOf(circle.id, { userId });
      await t.store.circles.createWithSelf({
        circle,
        self,
        link: {
          id: uid('lnk'),
          userId,
          profileId: self.id,
          role: 'ADMIN',
          isSecondaryCaregiver: false,
          createdAt: T0,
        },
      });
      return { userId, circle, self };
    };

    /** A confirmed prescription with one item and the given dose times (minutes after T0). */
    const prescribe = async (t: DomainUnderTest, profileId: string, minutes: number[]) => {
      const id = uid('pre');
      const item = itemOf(id);
      const doses = minutes.map((m) => doseOf(profileId, item.id, m));
      await t.store.prescriptions.saveConfirmed({
        prescription: {
          id,
          profileId,
          status: 'CONFIRMED',
          startDate: '2026-11-22',
          createdBy: null,
          confirmedBy: null,
          confirmedAt: T0,
          createdAt: T0,
        },
        items: [item],
        doses,
      });
      return { id, item, doses };
    };

    it('creates a circle with the owner’s profile and link', () =>
      withStore(async (t) => {
        const { userId, circle, self } = await owner(t);
        expect(await t.store.circles.findByOwner(userId)).toEqual(circle);
        expect(await t.store.circles.findByOwner('usr_none')).toBeNull();
        expect(await t.store.profiles.listForUser(userId)).toEqual([
          { profile: self, role: 'ADMIN' },
        ]);
        expect(await t.store.profiles.countInCircle(circle.id)).toBe(1);
        expect(await t.store.profiles.roleOf(userId, self.id)).toBe('ADMIN');
        expect(await t.store.profiles.roleOf('usr_none', self.id)).toBeNull();
        await expect(
          t.store.circles.createWithSelf({
            circle: { ...circle, id: uid('cir') },
            self: profileOf(circle.id),
            link: {
              id: uid('lnk'),
              userId,
              profileId: 'x',
              role: 'ADMIN',
              isSecondaryCaregiver: false,
              createdAt: T0,
            },
          }),
        ).rejects.toThrow();
      }));

    it('adds and updates profiles, round-tripping every field', () =>
      withStore(async (t) => {
        const { userId, circle } = await owner(t);
        const dep = profileOf(circle.id, {
          name: 'Abba',
          relationship: 'FATHER',
          age: 72,
          createdAt: at(1),
        });
        await t.store.profiles.create(dep, {
          id: uid('lnk'),
          userId,
          profileId: dep.id,
          role: 'CAREGIVER',
          isSecondaryCaregiver: false,
          createdAt: at(1),
        });
        expect(await t.store.profiles.findById(dep.id)).toEqual(dep);
        expect((await t.store.profiles.listForUser(userId)).map((l) => l.role)).toEqual([
          'ADMIN',
          'CAREGIVER',
        ]);

        const meals = { morning: '07:00', noon: '12:00', evening: '17:00', night: '22:30' };
        const updated = await t.store.profiles.update(dep.id, {
          mealTimes: meals,
          quietHours: { start: '22:00', end: '07:00' },
          allergies: 'Penicillin',
          name: 'Abbu',
        });
        expect(updated).toEqual({
          ...dep,
          mealTimes: meals,
          quietHours: { start: '22:00', end: '07:00' },
          allergies: 'Penicillin',
          name: 'Abbu',
        });
        expect(await t.store.profiles.update(dep.id, {})).toEqual(updated);
        expect(await t.store.profiles.update('prf_none', { name: 'x' })).toBeNull();
        expect(await t.store.profiles.findById('prf_none')).toBeNull();
      }));

    it('finds dependents by their own subscriber id', () =>
      withStore(async (t) => {
        const { userId, circle } = await owner(t);
        const sub = uid('tel:880');
        const dep = profileOf(circle.id, { subscriberId: sub, smsTag: 'A' });
        await t.store.profiles.create(dep, {
          id: uid('lnk'),
          userId,
          profileId: dep.id,
          role: 'ADMIN',
          isSecondaryCaregiver: false,
          createdAt: T0,
        });
        expect((await t.store.profiles.findBySubscriberId(sub)).map((p) => p.id)).toEqual([dep.id]);
        expect(await t.store.profiles.findBySubscriberId('tel:none')).toEqual([]);
      }));

    it('saves a confirmed prescription with doses, and never duplicates a dose key', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const { id, item, doses } = await prescribe(t, self.id, [0, 60, 120]);
        expect(await t.store.prescriptions.findById(id)).toMatchObject({
          status: 'CONFIRMED',
          profileId: self.id,
        });
        expect(await t.store.prescriptions.findById('pre_none')).toBeNull();

        // Same keys again (a retried save): nothing new.
        await t.store.prescriptions.saveConfirmed({
          prescription: (await t.store.prescriptions.findById(id))!,
          items: [item],
          doses: doses.map((d) => ({ ...d, id: uid('dose') })),
        });
        const listed = await t.store.doses.listForProfile(self.id, at(-1), at(1000));
        expect(listed.map((d) => d.id)).toEqual(doses.map((d) => d.id));
        expect(listed[0]).toEqual({
          ...doses[0],
          brandName: 'Napa',
          strength: '500mg',
          form: 'Tablet',
        });
      }));

    it('lists doses in [from, to), oldest first', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const { doses } = await prescribe(t, self.id, [120, 0, 60]);
        const mid = await t.store.doses.listForProfile(self.id, at(0), at(120));
        expect(mid.map((d) => d.dueAt)).toEqual([at(0), at(60)]);
        expect((await t.store.doses.findById(doses[0]!.id))?.brandName).toBe('Napa');
        expect(await t.store.doses.findById('dose_none')).toBeNull();
      }));

    it('confirming a draft replaces its draft items', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const id = uid('pre');
        const base = {
          id,
          profileId: self.id,
          startDate: null,
          createdBy: null,
          confirmedBy: null,
          confirmedAt: null,
          createdAt: T0,
        };
        await t.store.prescriptions.saveConfirmed({
          prescription: { ...base, status: 'DRAFT' },
          items: [itemOf(id, { brandName: 'Draft' })],
          doses: [],
        });
        const item = itemOf(id, { brandName: 'Final' });
        await t.store.prescriptions.saveConfirmed({
          prescription: { ...base, status: 'CONFIRMED', confirmedAt: at(5) },
          items: [item],
          doses: [doseOf(self.id, item.id, 30)],
        });
        expect(await t.store.prescriptions.findById(id)).toMatchObject({
          status: 'CONFIRMED',
          confirmedAt: at(5),
        });
        const [dose] = await t.store.doses.listForProfile(self.id, at(0), at(60));
        expect(dose?.brandName).toBe('Final');
      }));

    it('applies a dose action and returns the new state', () =>
      withStore(async (t) => {
        const { userId, self } = await owner(t);
        const { doses } = await prescribe(t, self.id, [0]);
        const updated = await t.store.doses.applyAction(
          doses[0]!.id,
          { status: 'TAKEN', stage: 'CLOSED', actedAt: at(3), snoozedUntil: null },
          {
            doseEventId: doses[0]!.id,
            action: 'TAKEN',
            channel: 'APP',
            actorUserId: userId,
            reason: null,
            at: at(3),
          },
        );
        expect(updated).toEqual({ ...doses[0], status: 'TAKEN', stage: 'CLOSED', actedAt: at(3) });
        expect(await t.store.doses.findById(doses[0]!.id)).toMatchObject({
          status: 'TAKEN',
          actedAt: at(3),
        });
        const missing = await t.store.doses.applyAction(
          'dose_none',
          { status: 'SKIPPED' },
          {
            doseEventId: 'dose_none',
            action: 'SKIP',
            channel: 'APP',
            actorUserId: null,
            reason: null,
            at: at(3),
          },
        );
        expect(missing).toBeNull();
      }));

    it('erasing a user removes their circle, profiles and doses, and their links elsewhere', () =>
      withStore(async (t) => {
        const a = await owner(t);
        const b = await owner(t);
        await prescribe(t, a.self.id, [0, 60]);
        // a is also a caregiver on one of b's profiles.
        const shared = profileOf(b.circle.id);
        await t.store.profiles.create(shared, {
          id: uid('lnk'),
          userId: a.userId,
          profileId: shared.id,
          role: 'CAREGIVER',
          isSecondaryCaregiver: false,
          createdAt: T0,
        });

        await t.store.eraseUser(a.userId);
        expect(await t.store.circles.findByOwner(a.userId)).toBeNull();
        expect(await t.store.profiles.findById(a.self.id)).toBeNull();
        expect(await t.store.doses.listForProfile(a.self.id, at(-10), at(100))).toEqual([]);
        expect(await t.store.profiles.listForUser(a.userId)).toEqual([]);
        // b's own data is untouched.
        expect(await t.store.profiles.findById(shared.id)).not.toBeNull();
        expect(await t.store.circles.findByOwner(b.userId)).not.toBeNull();
      }));

    it('lists open doses due by now (snooze end counts), oldest first, closed ones never', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const { doses } = await prescribe(t, self.id, [0, 10, 20, 30]);
        const [d0, d10, d20, d30] = doses;
        // d0 closed; d10 snoozed until 40; d20 open; d30 not due yet at 25.
        await t.store.doses.applyAction(
          d0!.id,
          { status: 'TAKEN', stage: 'CLOSED' },
          logOf(d0!.id),
        );
        await t.store.doses.applyAction(
          d10!.id,
          { status: 'SNOOZED', stage: 'PENDING', snoozedUntil: at(40) },
          logOf(d10!.id),
        );
        expect((await t.store.doses.listOpen(at(25), 10)).map((d) => d.id)).toEqual([d20!.id]);
        expect((await t.store.doses.listOpen(at(45), 10)).map((d) => d.id)).toEqual([
          d20!.id,
          d30!.id,
          d10!.id,
        ]);
        expect(await t.store.doses.listOpen(at(45), 1)).toHaveLength(1);
      }));

    it('advance is a compare-and-set on stage and status', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const { doses } = await prescribe(t, self.id, [0]);
        const d = doses[0]!;
        const moved = await t.store.doses.advance(
          d.id,
          { stage: 'PENDING', status: 'SCHEDULED' },
          { status: 'SCHEDULED', stage: 'REMINDED' },
          null,
        );
        expect(moved).toMatchObject({ stage: 'REMINDED', status: 'SCHEDULED' });
        // A second worker still thinks it is PENDING: refused.
        expect(
          await t.store.doses.advance(
            d.id,
            { stage: 'PENDING', status: 'SCHEDULED' },
            { status: 'SCHEDULED', stage: 'REMINDED' },
            null,
          ),
        ).toBeNull();
        const missed = await t.store.doses.advance(
          d.id,
          { stage: 'REMINDED', status: 'SCHEDULED' },
          { status: 'MISSED', stage: 'CLOSED' },
          { ...logOf(d.id), action: 'MISSED', channel: 'SYSTEM' },
        );
        expect(missed).toMatchObject({ status: 'MISSED', stage: 'CLOSED' });
      }));

    it('records each alert once, acknowledges them, and lists them per caregiver', () =>
      withStore(async (t) => {
        const { userId, self, circle } = await owner(t);
        expect(await t.store.circles.findById(circle.id)).toEqual(circle);
        expect(await t.store.circles.findById('cir_none')).toBeNull();
        const carer = uid('usr');
        await t.addUser(carer);
        await t.store.profiles.addLink({
          id: uid('lnk'),
          userId: carer,
          profileId: self.id,
          role: 'CAREGIVER',
          isSecondaryCaregiver: true,
          createdAt: at(1),
        });
        expect(
          (await t.store.profiles.linksOf(self.id)).map((l) => [l.userId, l.isSecondaryCaregiver]),
        ).toEqual([
          [userId, false],
          [carer, true],
        ]);
        await expect(
          t.store.profiles.addLink({
            id: uid('lnk'),
            userId: carer,
            profileId: self.id,
            role: 'VIEWER',
            isSecondaryCaregiver: false,
            createdAt: at(2),
          }),
        ).rejects.toThrow();

        const { doses } = await prescribe(t, self.id, [0]);
        const row = {
          doseEventId: doses[0]!.id,
          level: 'PRIMARY' as const,
          notifiedUserId: carer,
          idempotencyKey: `${doses[0]!.id}:PRIMARY:${carer}`,
          sentAt: at(30),
        };
        expect(await t.store.escalations.record(row)).toBe(true);
        expect(await t.store.escalations.record({ ...row, sentAt: at(31) })).toBe(false);
        expect(await t.store.escalations.forDose(doses[0]!.id)).toEqual([
          { ...row, acknowledgedAt: null, acknowledgedVia: null },
        ]);
        expect(await t.store.escalations.listForUser(carer, at(0))).toHaveLength(1);
        expect(await t.store.escalations.listForUser(carer, at(31))).toHaveLength(0);
        expect(await t.store.escalations.acknowledge(doses[0]!.id, at(35), 'APP')).toBe(1);
        expect(await t.store.escalations.acknowledge(doses[0]!.id, at(36), 'APP')).toBe(0);
        expect((await t.store.escalations.forDose(doses[0]!.id))[0]).toMatchObject({
          acknowledgedAt: at(35),
          acknowledgedVia: 'APP',
        });
      }));

    it('changes roles, sets the secondary caregiver, and removes links', () =>
      withStore(async (t) => {
        const { userId, self } = await owner(t);
        const other = uid('usr');
        await t.addUser(other);
        const link = {
          id: uid('lnk'),
          userId: other,
          profileId: self.id,
          role: 'CAREGIVER' as const,
          isSecondaryCaregiver: false,
          createdAt: at(1),
        };
        await t.store.profiles.addLink(link);
        expect(await t.store.links.findById(link.id)).toEqual(link);
        expect(await t.store.links.setRole(link.id, 'VIEWER')).toEqual({ ...link, role: 'VIEWER' });
        expect(await t.store.links.setRole('lnk_none', 'VIEWER')).toBeNull();

        await t.store.links.setSecondary(self.id, link.id);
        const flags = async () =>
          (await t.store.profiles.linksOf(self.id)).map((l) => [l.userId, l.isSecondaryCaregiver]);
        expect(await flags()).toEqual([
          [userId, false],
          [other, true],
        ]);
        await t.store.links.setSecondary(self.id, '');
        expect(await flags()).toEqual([
          [userId, false],
          [other, false],
        ]);

        expect(await t.store.links.remove(link.id)).toBe(true);
        expect(await t.store.links.remove(link.id)).toBe(false);
        expect(await t.store.links.findById(link.id)).toBeNull();
      }));

    it('keeps one open invite per number and profile, and accepts it once', () =>
      withStore(async (t) => {
        const { userId, self } = await owner(t);
        const invitee = uid('usr');
        await t.addUser(invitee);
        const base = {
          profileId: self.id,
          invitedBy: userId,
          phoneKey: uid('key'),
          role: 'CAREGIVER' as const,
          createdAt: at(0),
          expiresAt: at(60),
          acceptedAt: null,
          acceptedBy: null,
        };
        const first = { ...base, id: uid('inv') };
        expect(await t.store.invites.create(first)).toBe(true);
        expect(await t.store.invites.create({ ...base, id: uid('inv') })).toBe(false);
        expect(await t.store.invites.openForPhone(base.phoneKey, at(1))).toEqual([first]);
        expect(await t.store.invites.openForProfile(self.id, at(1))).toEqual([first]);
        expect(await t.store.invites.openForPhone(base.phoneKey, at(60))).toEqual([]);

        const link = {
          id: uid('lnk'),
          userId: invitee,
          profileId: self.id,
          role: 'CAREGIVER' as const,
          isSecondaryCaregiver: false,
          createdAt: at(2),
        };
        expect(await t.store.invites.accept(first.id, link, at(2))).toBe(true);
        expect(await t.store.invites.accept(first.id, { ...link, id: uid('lnk') }, at(3))).toBe(
          false,
        );
        expect(await t.store.profiles.roleOf(invitee, self.id)).toBe('CAREGIVER');
        expect(await t.store.invites.openForPhone(base.phoneKey, at(2))).toEqual([]);

        // Accepted: the same number may be invited again, and accepting it adds no second link.
        const second = { ...base, id: uid('inv'), role: 'VIEWER' as const };
        expect(await t.store.invites.create(second)).toBe(true);
        expect(await t.store.invites.accept(second.id, { ...link, id: uid('lnk') }, at(4))).toBe(
          false,
        );
        expect(await t.store.profiles.linksOf(self.id)).toHaveLength(2);
        expect(await t.store.invites.openForPhone(base.phoneKey, at(5))).toEqual([]);
      }));

    it('keeps one notice per ref and lists a user’s newest first', () =>
      withStore(async (t) => {
        const { userId, self } = await owner(t);
        const row = {
          id: uid('ntc'),
          userId,
          profileId: self.id,
          type: 'REFILL_DUE' as const,
          title: 't',
          body: 'b',
          ref: uid('ref'),
          createdAt: at(1),
          acknowledgedAt: null,
        };
        expect(await t.store.notices.record(row)).toBe(true);
        expect(await t.store.notices.record({ ...row, id: uid('ntc') })).toBe(false);
        const later = {
          ...row,
          id: uid('ntc'),
          ref: uid('ref'),
          type: 'WEEKLY_DIGEST' as const,
          createdAt: at(5),
        };
        await t.store.notices.record(later);
        expect(await t.store.notices.listForUser(userId, at(0))).toEqual([later, row]);
        expect(await t.store.notices.listForUser(userId, at(2))).toEqual([later]);
      }));

    it('stores traces and audit rows', () =>
      withStore(async (t) => {
        const { userId, self } = await owner(t);
        const trace = {
          id: uid('trc'),
          userId,
          profileId: self.id,
          channel: 'SMS',
          rootAgent: 'TriageAgent',
          inputPreview: 'next dose?',
          handoffs: [{ from: 'TriageAgent', to: 'ScheduleQueryAgent' }],
          toolCalls: [{ name: 'getNextDose', durationMs: 9 }],
          durationMs: 400,
          createdAt: at(1),
        };
        await t.store.traces.record(trace);
        await t.store.traces.record({
          ...trace,
          id: uid('trc'),
          inputPreview: null,
          createdAt: at(2),
        });
        const listed = await t.store.traces.list(10);
        expect(listed.map((x) => x.createdAt)).toEqual([at(2), at(1)]);
        expect(listed[1]).toEqual(trace);
        expect(await t.store.traces.list(1)).toHaveLength(1);

        const row = {
          actorUserId: userId,
          action: 'READ_AGENT_TRACES',
          subjectType: 'agent_traces',
          subjectId: 'list',
          profileId: null,
          detail: { count: 2 },
          at: at(3),
        };
        await t.store.audit.record(row);
        expect(await t.store.audit.listForActor(userId)).toEqual([row]);
      }));

    it('lists appointments and moves a pending one to reminded exactly once', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const a = {
          id: uid('apt'),
          profileId: self.id,
          title: 'Doctor',
          dueAt: at(600),
          reminderState: 'PENDING' as const,
          createdAt: at(0),
        };
        await t.store.appointments.create(a);
        await t.store.appointments.create({ ...a, id: uid('apt'), dueAt: at(60) });
        expect(
          (await t.store.appointments.listForProfile(self.id, at(0))).map((x) => x.dueAt),
        ).toEqual([at(60), at(600)]);
        expect(await t.store.appointments.listPendingDue(at(100), at(700))).toEqual([a]);
        expect(await t.store.appointments.markReminded(a.id)).toBe(true);
        expect(await t.store.appointments.markReminded(a.id)).toBe(false);
        expect(await t.store.appointments.listPendingDue(at(100), at(700))).toEqual([]);
      }));

    it('finds refill dates in a range on confirmed prescriptions, and profiles with doses', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const { item } = await prescribe(t, self.id, [0, 60]);
        // prescribe() saves refillDueOn: null; save another confirmed one with a refill date.
        const id = uid('pre');
        const withRefill = itemOf(id, { refillDueOn: '2026-11-27' });
        await t.store.prescriptions.saveConfirmed({
          prescription: {
            id,
            profileId: self.id,
            status: 'CONFIRMED',
            startDate: '2026-11-22',
            createdBy: null,
            confirmedBy: null,
            confirmedAt: T0,
            createdAt: T0,
          },
          items: [withRefill],
          doses: [],
        });
        const found = await t.store.items.refillDueBetween('2026-11-25', '2026-11-27');
        expect(found).toEqual([{ item: withRefill, profileId: self.id }]);
        expect(await t.store.items.refillDueBetween('2026-11-28', '2026-11-30')).toEqual([]);
        expect(item.refillDueOn).toBeNull();

        expect(await t.store.doses.profilesWithDoses(at(0), at(61))).toEqual([self.id]);
        expect(await t.store.doses.profilesWithDoses(at(61), at(100))).toEqual([]);
      }));

    it('stores reports with their values and lists them newest first', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const report = {
          id: uid('rep'),
          profileId: self.id,
          title: 'Diabetic Profile',
          reportDate: '2026-11-20',
          center: 'Popular Diagnostic',
          testType: 'Diabetic Profile',
          createdBy: null,
          createdAt: at(1),
        };
        const values = [
          {
            testName: 'FBS',
            value: '9.2',
            unit: 'mmol/L',
            printedRange: '3.9 - 6.1',
            flag: 'HIGH' as const,
            explanationBn: 'রক্তে শর্করা বেশি',
          },
          {
            testName: 'HbA1c',
            value: '8.4',
            unit: null,
            printedRange: null,
            flag: 'UNKNOWN' as const,
            explanationBn: null,
          },
        ];
        await t.store.reports.create(report, values);
        await t.store.reports.create({ ...report, id: uid('rep'), createdAt: at(5) }, []);
        expect(await t.store.reports.findById(report.id)).toEqual({ report, values });
        expect(await t.store.reports.findById('rep_none')).toBeNull();
        const listed = await t.store.reports.listForProfiles([self.id]);
        expect(listed.map((r) => r.createdAt)).toEqual([at(5), at(1)]);
        expect(await t.store.reports.listForProfiles([])).toEqual([]);
      }));

    it('stores symptom logs and lists them newest first', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const log = {
          id: uid('sym'),
          profileId: self.id,
          source: 'TEXT' as const,
          data: { kind: 'SUMMARY', summary: { symptoms: 'জ্বর' } },
          redFlag: false,
          loggedAt: at(1),
        };
        await t.store.symptoms.record(log);
        await t.store.symptoms.record({ ...log, id: uid('sym'), redFlag: true, loggedAt: at(3) });
        expect(await t.store.symptoms.findById(log.id)).toEqual(log);
        expect(await t.store.symptoms.findById('sym_none')).toBeNull();
        expect((await t.store.symptoms.listForProfile(self.id, 10)).map((l) => l.redFlag)).toEqual([
          true,
          false,
        ]);
        expect(await t.store.symptoms.listForProfile(self.id, 1)).toHaveLength(1);
      }));

    it('saves a pharmacy, updates it in place, and keeps stock per drug', () =>
      withStore(async (t) => {
        const ownerId = uid('usr');
        await t.addUser(ownerId);
        const p = {
          id: uid('phm'),
          ownerUserId: ownerId,
          name: '',
          address: null,
          lat: null,
          lng: null,
          phone: null,
          openingHours: null,
          isPartner: false,
          priorityListing: false,
          createdAt: at(0),
        };
        await t.store.pharmacies.save(p);
        const filled = {
          ...p,
          name: 'Shanti',
          address: 'Mirpur',
          lat: 23.8,
          lng: 90.36,
          phone: '017',
          openingHours: '9-11',
        };
        await t.store.pharmacies.save(filled);
        expect(await t.store.pharmacies.findByOwner(ownerId)).toEqual(filled);
        expect(await t.store.pharmacies.findByOwner('usr_none')).toBeNull();
        expect(await t.store.pharmacies.list()).toEqual([filled]);

        await t.store.pharmacies.setStock({
          pharmacyId: p.id,
          drugBrandId: 'dgda-a',
          inStock: true,
          updatedAt: at(1),
        });
        await t.store.pharmacies.setStock({
          pharmacyId: p.id,
          drugBrandId: 'dgda-a',
          inStock: false,
          updatedAt: at(2),
        });
        await t.store.pharmacies.setStock({
          pharmacyId: p.id,
          drugBrandId: 'dgda-b',
          inStock: true,
          updatedAt: at(2),
        });
        expect(await t.store.pharmacies.stockOf(p.id)).toEqual([
          { pharmacyId: p.id, drugBrandId: 'dgda-a', inStock: false, updatedAt: at(2) },
          { pharmacyId: p.id, drugBrandId: 'dgda-b', inStock: true, updatedAt: at(2) },
        ]);
        expect((await t.store.pharmacies.stockForDrug('dgda-b')).map((s) => s.pharmacyId)).toEqual([
          p.id,
        ]);
      }));

    it('keeps account settings per user', () =>
      withStore(async (t) => {
        const { userId } = await owner(t);
        expect(await t.store.settings.get(userId)).toBeNull();
        await t.store.settings.put({
          userId,
          discreetSms: true,
          smsReminders: true,
          updatedAt: at(1),
        });
        await t.store.settings.put({
          userId,
          discreetSms: true,
          smsReminders: false,
          updatedAt: at(2),
        });
        expect(await t.store.settings.get(userId)).toEqual({
          userId,
          discreetSms: true,
          smsReminders: false,
          updatedAt: at(2),
        });
      }));

    it('lists the items of confirmed prescriptions since a date, newest first', () =>
      withStore(async (t) => {
        const { self } = await owner(t);
        const { item } = await prescribe(t, self.id, [0]);
        const rows = await t.store.items.confirmedForProfile(self.id, at(-60));
        expect(rows).toEqual([{ item, confirmedAt: T0 }]);
        expect(await t.store.items.confirmedForProfile(self.id, at(1))).toEqual([]);
      }));
  });
}
