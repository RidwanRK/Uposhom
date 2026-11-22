import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  doseEvents,
  doseLogs,
  familyCircles,
  links,
  prescriptionItems,
  prescriptions,
  profiles,
  type Db,
} from '@uposhom/db';
import type {
  DomainStore,
  DoseRecord,
  DoseView,
  PrescriptionRecord,
  ProfileRecord,
} from './types.js';

type ProfileRow = typeof profiles.$inferSelect;
type DoseRow = typeof doseEvents.$inferSelect;

const toProfile = (r: ProfileRow): ProfileRecord => ({
  id: r.id,
  circleId: r.circleId,
  userId: r.userId,
  name: r.name,
  relationship: r.relationship,
  age: r.age,
  allergies: r.allergies,
  mealTimes: {
    morning: r.mealMorning,
    noon: r.mealNoon,
    evening: r.mealEvening,
    night: r.mealNight,
  },
  quietHours: r.quietStart && r.quietEnd ? { start: r.quietStart, end: r.quietEnd } : null,
  subscriberId: r.subscriberId,
  smsTag: r.smsTag,
  createdAt: r.createdAt,
});

const profileRow = (p: ProfileRecord) => ({
  id: p.id,
  circleId: p.circleId,
  userId: p.userId,
  name: p.name,
  relationship: p.relationship,
  age: p.age,
  allergies: p.allergies,
  mealMorning: p.mealTimes.morning,
  mealNoon: p.mealTimes.noon,
  mealEvening: p.mealTimes.evening,
  mealNight: p.mealTimes.night,
  quietStart: p.quietHours?.start ?? null,
  quietEnd: p.quietHours?.end ?? null,
  subscriberId: p.subscriberId,
  smsTag: p.smsTag,
  createdAt: p.createdAt,
});

const toDose = (r: DoseRow): DoseRecord => ({
  id: r.id,
  profileId: r.profileId,
  prescriptionItemId: r.prescriptionItemId,
  idempotencyKey: r.idempotencyKey,
  courseDate: r.courseDate,
  slot: r.slot,
  quantity: Number(r.quantity),
  mealRelation: r.mealRelation,
  dueAt: r.dueAt,
  isCritical: r.isCritical,
  status: r.status,
  stage: r.stage,
  snoozedUntil: r.snoozedUntil,
  actedAt: r.actedAt,
});

const toPrescription = (r: typeof prescriptions.$inferSelect): PrescriptionRecord => ({
  id: r.id,
  profileId: r.profileId,
  status: r.status,
  startDate: r.startDate,
  createdBy: r.createdBy,
  confirmedBy: r.confirmedBy,
  confirmedAt: r.confirmedAt,
  createdAt: r.createdAt,
});

/** Domain store over the Drizzle schema in packages/db. */
export function createPostgresDomainStore(db: Db): DomainStore {
  // A new builder per query: a dynamic builder is changed in place by .where().
  const doseViews = () =>
    db
      .select({
        dose: doseEvents,
        brandName: prescriptionItems.brandName,
        strength: prescriptionItems.strength,
        form: prescriptionItems.form,
      })
      .from(doseEvents)
      .innerJoin(prescriptionItems, eq(prescriptionItems.id, doseEvents.prescriptionItemId))
      .$dynamic();

  const toView = (r: {
    dose: DoseRow;
    brandName: string;
    strength: string | null;
    form: string | null;
  }): DoseView => ({
    ...toDose(r.dose),
    brandName: r.brandName,
    strength: r.strength,
    form: r.form,
  });

  return {
    circles: {
      async findByOwner(userId) {
        const [r] = await db
          .select()
          .from(familyCircles)
          .where(eq(familyCircles.ownerUserId, userId));
        return r ? { id: r.id, ownerUserId: r.ownerUserId, createdAt: r.createdAt } : null;
      },
      async createWithSelf({ circle, self, link }) {
        await db.transaction(async (tx) => {
          await tx.insert(familyCircles).values(circle);
          await tx.insert(profiles).values(profileRow(self));
          await tx.insert(links).values(link);
        });
      },
    },
    profiles: {
      async findById(id) {
        const [r] = await db.select().from(profiles).where(eq(profiles.id, id));
        return r ? toProfile(r) : null;
      },
      async listForUser(userId) {
        const rows = await db
          .select({ profile: profiles, role: links.role })
          .from(links)
          .innerJoin(profiles, eq(profiles.id, links.profileId))
          .where(eq(links.userId, userId))
          .orderBy(asc(profiles.createdAt), asc(profiles.id));
        return rows.map((r) => ({ profile: toProfile(r.profile), role: r.role }));
      },
      async countInCircle(circleId) {
        return db.$count(profiles, eq(profiles.circleId, circleId));
      },
      async create(profile, link) {
        await db.transaction(async (tx) => {
          await tx.insert(profiles).values(profileRow(profile));
          await tx.insert(links).values(link);
        });
      },
      async update(id, patch) {
        const set: Partial<ReturnType<typeof profileRow>> = {};
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.relationship !== undefined) set.relationship = patch.relationship;
        if (patch.age !== undefined) set.age = patch.age;
        if (patch.allergies !== undefined) set.allergies = patch.allergies;
        if (patch.mealTimes) {
          set.mealMorning = patch.mealTimes.morning;
          set.mealNoon = patch.mealTimes.noon;
          set.mealEvening = patch.mealTimes.evening;
          set.mealNight = patch.mealTimes.night;
        }
        if (patch.quietHours !== undefined) {
          set.quietStart = patch.quietHours?.start ?? null;
          set.quietEnd = patch.quietHours?.end ?? null;
        }
        if (Object.keys(set).length === 0) {
          const [same] = await db.select().from(profiles).where(eq(profiles.id, id));
          return same ? toProfile(same) : null;
        }
        const [r] = await db.update(profiles).set(set).where(eq(profiles.id, id)).returning();
        return r ? toProfile(r) : null;
      },
      async roleOf(userId, profileId) {
        const [r] = await db
          .select({ role: links.role })
          .from(links)
          .where(and(eq(links.userId, userId), eq(links.profileId, profileId)));
        return r?.role ?? null;
      },
      async findBySubscriberId(subscriberId) {
        const rows = await db
          .select()
          .from(profiles)
          .where(eq(profiles.subscriberId, subscriberId));
        return rows.map(toProfile);
      },
    },
    prescriptions: {
      async findById(id) {
        const [r] = await db.select().from(prescriptions).where(eq(prescriptions.id, id));
        return r ? toPrescription(r) : null;
      },
      async saveConfirmed({ prescription, items, doses }) {
        await db.transaction(async (tx) => {
          // Only a draft's items are replaced. Deleting a confirmed item would cascade to its
          // doses and their history, so a confirmed prescription only ever gains rows.
          const [current] = await tx
            .select({ status: prescriptions.status })
            .from(prescriptions)
            .where(eq(prescriptions.id, prescription.id))
            .for('update');
          // Everything but the id is updated on conflict.
          const rest: Partial<typeof prescription> = { ...prescription };
          delete rest.id;
          await tx
            .insert(prescriptions)
            .values(prescription)
            .onConflictDoUpdate({ target: prescriptions.id, set: rest });
          if (current?.status === 'DRAFT') {
            await tx
              .delete(prescriptionItems)
              .where(eq(prescriptionItems.prescriptionId, prescription.id));
          }
          if (items.length) {
            await tx
              .insert(prescriptionItems)
              .values(
                items.map((i) => ({
                  ...i,
                  pillCount: i.pillCount === null ? null : String(i.pillCount),
                })),
              )
              .onConflictDoNothing({ target: prescriptionItems.id });
          }
          // Insert in chunks: a 90-day QID course is 360 rows, many items make thousands.
          for (let i = 0; i < doses.length; i += 500) {
            await tx
              .insert(doseEvents)
              .values(doses.slice(i, i + 500).map((d) => ({ ...d, quantity: String(d.quantity) })))
              .onConflictDoNothing({ target: doseEvents.idempotencyKey });
          }
        });
      },
    },
    doses: {
      async findById(id) {
        const [r] = await doseViews().where(eq(doseEvents.id, id));
        return r ? toView(r) : null;
      },
      async listForProfile(profileId, from, to) {
        const rows = await doseViews()
          .where(
            and(
              eq(doseEvents.profileId, profileId),
              gte(doseEvents.dueAt, from),
              lt(doseEvents.dueAt, to),
            ),
          )
          .orderBy(asc(doseEvents.dueAt), asc(doseEvents.id));
        return rows.map(toView);
      },
      async applyAction(id, patch, log) {
        return db.transaction(async (tx) => {
          const [r] = await tx
            .update(doseEvents)
            .set({ ...patch, updatedAt: log.at })
            .where(eq(doseEvents.id, id))
            .returning();
          if (!r) return null;
          await tx.insert(doseLogs).values(log);
          return toDose(r);
        });
      },
    },
    async eraseUser(userId) {
      await db.transaction(async (tx) => {
        const owned = await tx
          .select({ id: familyCircles.id })
          .from(familyCircles)
          .where(eq(familyCircles.ownerUserId, userId));
        // Profiles, prescriptions, doses and links follow by ON DELETE CASCADE.
        if (owned.length) {
          await tx.delete(familyCircles).where(
            inArray(
              familyCircles.id,
              owned.map((c) => c.id),
            ),
          );
        }
        await tx.delete(links).where(eq(links.userId, userId));
      });
    },
  };
}
