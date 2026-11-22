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
  });
}
