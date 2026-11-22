import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import {
  agentTraces,
  appointments,
  auditLog,
  deviceTokens,
  doseEvents,
  doseLogs,
  escalations,
  familyCircles,
  invites,
  links,
  notices,
  prescriptionItems,
  prescriptions,
  profiles,
  type Db,
} from '@uposhom/db';
import type {
  DomainStore,
  EscalationRecord,
  LinkRecord,
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

const toLink = (r: typeof links.$inferSelect): LinkRecord => ({
  id: r.id,
  userId: r.userId,
  profileId: r.profileId,
  role: r.role,
  isSecondaryCaregiver: r.isSecondaryCaregiver,
  createdAt: r.createdAt,
});

const toEscalation = (r: typeof escalations.$inferSelect): EscalationRecord => ({
  doseEventId: r.doseEventId,
  level: r.level,
  notifiedUserId: r.notifiedUserId,
  idempotencyKey: r.idempotencyKey,
  sentAt: r.sentAt,
  acknowledgedAt: r.acknowledgedAt,
  acknowledgedVia: r.acknowledgedVia,
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
      async findById(id) {
        const [r] = await db.select().from(familyCircles).where(eq(familyCircles.id, id));
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
      async addLink(link) {
        await db.insert(links).values(link);
      },
      async linksOf(profileId) {
        const rows = await db
          .select()
          .from(links)
          .where(eq(links.profileId, profileId))
          .orderBy(asc(links.createdAt), asc(links.id));
        return rows.map(toLink);
      },
    },
    links: {
      async findById(id) {
        const [r] = await db.select().from(links).where(eq(links.id, id));
        return r ? toLink(r) : null;
      },
      async setRole(id, role) {
        const [r] = await db.update(links).set({ role }).where(eq(links.id, id)).returning();
        return r ? toLink(r) : null;
      },
      async setSecondary(profileId, linkId) {
        await db
          .update(links)
          .set({ isSecondaryCaregiver: sql`${links.id} = ${linkId}` })
          .where(eq(links.profileId, profileId));
      },
      async remove(id) {
        const rows = await db.delete(links).where(eq(links.id, id)).returning({ id: links.id });
        return rows.length > 0;
      },
    },
    invites: {
      async create(invite) {
        const rows = await db
          .insert(invites)
          .values(invite)
          .onConflictDoNothing({
            target: [invites.profileId, invites.phoneKey],
            where: sql`accepted_at IS NULL`,
          })
          .returning({ id: invites.id });
        return rows.length > 0;
      },
      async openForPhone(phoneKey, now) {
        const rows = await db
          .select()
          .from(invites)
          .where(
            and(
              eq(invites.phoneKey, phoneKey),
              isNull(invites.acceptedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .orderBy(asc(invites.createdAt), asc(invites.id));
        return rows;
      },
      async openForProfile(profileId, now) {
        const rows = await db
          .select()
          .from(invites)
          .where(
            and(
              eq(invites.profileId, profileId),
              isNull(invites.acceptedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .orderBy(asc(invites.createdAt), asc(invites.id));
        return rows;
      },
      async accept(inviteId, link, at) {
        return db.transaction(async (tx) => {
          const [claimed] = await tx
            .update(invites)
            .set({ acceptedAt: at, acceptedBy: link.userId })
            .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt)))
            .returning({ id: invites.id });
          if (!claimed) return false;
          const added = await tx
            .insert(links)
            .values({ ...link, otpVerifiedAt: at })
            .onConflictDoNothing({ target: [links.userId, links.profileId] })
            .returning({ id: links.id });
          return added.length > 0;
        });
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
      async profilesWithDoses(from, to) {
        const rows = await db
          .selectDistinct({ profileId: doseEvents.profileId })
          .from(doseEvents)
          .where(and(gte(doseEvents.dueAt, from), lt(doseEvents.dueAt, to)))
          .orderBy(asc(doseEvents.profileId));
        return rows.map((r) => r.profileId);
      },
      async listOpen(now, limit) {
        const base = sql`CASE WHEN ${doseEvents.status} = 'SNOOZED' AND ${doseEvents.snoozedUntil} IS NOT NULL THEN ${doseEvents.snoozedUntil} ELSE ${doseEvents.dueAt} END`;
        const rows = await db
          .select()
          .from(doseEvents)
          .where(and(ne(doseEvents.stage, 'CLOSED'), lte(base, now)))
          .orderBy(asc(base), asc(doseEvents.id))
          .limit(limit);
        return rows.map(toDose);
      },
      async advance(id, from, patch, log) {
        return db.transaction(async (tx) => {
          const [r] = await tx
            .update(doseEvents)
            .set({ ...patch, updatedAt: log?.at ?? new Date() })
            .where(
              and(
                eq(doseEvents.id, id),
                eq(doseEvents.stage, from.stage),
                eq(doseEvents.status, from.status),
              ),
            )
            .returning();
          if (!r) return null;
          if (log) await tx.insert(doseLogs).values(log);
          return toDose(r);
        });
      },
    },
    devices: {
      async upsert(device) {
        await db
          .insert(deviceTokens)
          .values(device)
          .onConflictDoUpdate({
            target: deviceTokens.expoToken,
            set: {
              userId: device.userId,
              platform: device.platform,
              lastSeenAt: device.lastSeenAt,
            },
          });
      },
      async listForUser(userId) {
        return db
          .select()
          .from(deviceTokens)
          .where(eq(deviceTokens.userId, userId))
          .orderBy(asc(deviceTokens.createdAt), asc(deviceTokens.id));
      },
      async removeToken(expoToken) {
        await db.delete(deviceTokens).where(eq(deviceTokens.expoToken, expoToken));
      },
    },
    escalations: {
      async record(row) {
        const inserted = await db
          .insert(escalations)
          .values({ ...row, acknowledgedAt: null, acknowledgedVia: null })
          .onConflictDoNothing({ target: escalations.idempotencyKey })
          .returning({ id: escalations.id });
        return inserted.length > 0;
      },
      async forDose(doseEventId) {
        const rows = await db
          .select()
          .from(escalations)
          .where(eq(escalations.doseEventId, doseEventId))
          .orderBy(asc(escalations.sentAt), asc(escalations.id));
        return rows.map(toEscalation);
      },
      async acknowledge(doseEventId, at, via) {
        const rows = await db
          .update(escalations)
          .set({ acknowledgedAt: at, acknowledgedVia: via })
          .where(and(eq(escalations.doseEventId, doseEventId), isNull(escalations.acknowledgedAt)))
          .returning({ id: escalations.id });
        return rows.length;
      },
      async listForUser(userId, since) {
        const rows = await db
          .select()
          .from(escalations)
          .where(and(eq(escalations.notifiedUserId, userId), gte(escalations.sentAt, since)))
          .orderBy(desc(escalations.sentAt), desc(escalations.id));
        return rows.map(toEscalation);
      },
    },
    notices: {
      async record(row) {
        const rows = await db
          .insert(notices)
          .values(row)
          .onConflictDoNothing({ target: notices.ref })
          .returning({ id: notices.id });
        return rows.length > 0;
      },
      async listForUser(userId, since) {
        return db
          .select()
          .from(notices)
          .where(and(eq(notices.userId, userId), gte(notices.createdAt, since)))
          .orderBy(desc(notices.createdAt), desc(notices.id));
      },
    },
    traces: {
      async record(row) {
        await db.insert(agentTraces).values({
          id: row.id,
          userId: row.userId,
          profileId: row.profileId,
          channel: row.channel,
          rootAgent: row.rootAgent,
          steps: {
            inputPreview: row.inputPreview,
            handoffs: row.handoffs,
            toolCalls: row.toolCalls,
          },
          durationMs: row.durationMs,
          createdAt: row.createdAt,
        });
      },
      async list(limit) {
        const rows = await db
          .select()
          .from(agentTraces)
          .orderBy(desc(agentTraces.createdAt), desc(agentTraces.id))
          .limit(limit);
        return rows.map((r) => {
          const steps = (r.steps ?? {}) as {
            inputPreview?: string | null;
            handoffs?: Array<{ from: string; to: string }>;
            toolCalls?: Array<{ name: string; durationMs: number }>;
          };
          return {
            id: r.id,
            userId: r.userId,
            profileId: r.profileId,
            channel: r.channel,
            rootAgent: r.rootAgent,
            inputPreview: steps.inputPreview ?? null,
            handoffs: steps.handoffs ?? [],
            toolCalls: steps.toolCalls ?? [],
            durationMs: r.durationMs ?? 0,
            createdAt: r.createdAt,
          };
        });
      },
    },
    audit: {
      async record(row) {
        await db.insert(auditLog).values(row);
      },
      async listForActor(actorUserId) {
        const rows = await db
          .select()
          .from(auditLog)
          .where(eq(auditLog.actorUserId, actorUserId))
          .orderBy(desc(auditLog.at), desc(auditLog.id));
        return rows.map((r) => ({
          actorUserId: r.actorUserId,
          action: r.action,
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          profileId: r.profileId,
          detail: (r.detail ?? null) as Record<string, unknown> | null,
          at: r.at,
        }));
      },
    },
    appointments: {
      async create(row) {
        await db.insert(appointments).values(row);
      },
      async listForProfile(profileId, from) {
        return db
          .select()
          .from(appointments)
          .where(and(eq(appointments.profileId, profileId), gte(appointments.dueAt, from)))
          .orderBy(asc(appointments.dueAt), asc(appointments.id));
      },
      async listPendingDue(from, to) {
        return db
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.reminderState, 'PENDING'),
              gte(appointments.dueAt, from),
              lt(appointments.dueAt, to),
            ),
          )
          .orderBy(asc(appointments.dueAt), asc(appointments.id));
      },
      async markReminded(id) {
        const rows = await db
          .update(appointments)
          .set({ reminderState: 'REMINDED' })
          .where(and(eq(appointments.id, id), eq(appointments.reminderState, 'PENDING')))
          .returning({ id: appointments.id });
        return rows.length > 0;
      },
    },
    items: {
      async refillDueBetween(fromDate, toDate) {
        const rows = await db
          .select({ item: prescriptionItems, profileId: prescriptions.profileId })
          .from(prescriptionItems)
          .innerJoin(prescriptions, eq(prescriptions.id, prescriptionItems.prescriptionId))
          .where(
            and(
              eq(prescriptions.status, 'CONFIRMED'),
              gte(prescriptionItems.refillDueOn, fromDate),
              lte(prescriptionItems.refillDueOn, toDate),
            ),
          )
          .orderBy(asc(prescriptionItems.id));
        return rows.map((r) => ({
          profileId: r.profileId,
          item: {
            id: r.item.id,
            prescriptionId: r.item.prescriptionId,
            position: r.item.position,
            brandName: r.item.brandName,
            strength: r.item.strength,
            form: r.item.form,
            parsedPattern: r.item.parsedPattern,
            mealRelation: r.item.mealRelation,
            durationDays: r.item.durationDays,
            pillCount: r.item.pillCount === null ? null : Number(r.item.pillCount),
            asNeeded: r.item.asNeeded,
            isCritical: r.item.isCritical,
            courseEndsOn: r.item.courseEndsOn,
            refillDueOn: r.item.refillDueOn,
          },
        }));
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
        await tx.delete(deviceTokens).where(eq(deviceTokens.userId, userId));
      });
    },
  };
}
