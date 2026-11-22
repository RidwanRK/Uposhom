import type {
  CircleRecord,
  DomainStore,
  DoseLogRecord,
  DoseRecord,
  DoseView,
  EscalationRecord,
  LinkRecord,
  PrescriptionItemRecord,
  PrescriptionRecord,
  ProfileRecord,
} from './types.js';

/** In-memory domain store for development (`pnpm dev:local`) and tests. Forgets on restart. */
export function createMemoryDomainStore(): DomainStore & { logs: DoseLogRecord[] } {
  const circles = new Map<string, CircleRecord>();
  const profiles = new Map<string, ProfileRecord>();
  const links = new Map<string, LinkRecord>();
  const prescriptions = new Map<string, PrescriptionRecord>();
  const items = new Map<string, PrescriptionItemRecord>();
  const doses = new Map<string, DoseRecord>();
  const doseKeys = new Set<string>();
  const logs: DoseLogRecord[] = [];
  const escalations = new Map<string, EscalationRecord>(); // by idempotency key

  const copy = <T>(v: T): T => structuredClone(v);

  const view = (d: DoseRecord): DoseView => {
    const item = items.get(d.prescriptionItemId)!;
    return { ...copy(d), brandName: item.brandName, strength: item.strength, form: item.form };
  };

  const removeProfile = (profileId: string) => {
    for (const [id, l] of links) if (l.profileId === profileId) links.delete(id);
    for (const [id, p] of prescriptions) {
      if (p.profileId !== profileId) continue;
      prescriptions.delete(id);
      for (const [iid, it] of items) if (it.prescriptionId === id) items.delete(iid);
    }
    for (const [id, d] of doses) {
      if (d.profileId !== profileId) continue;
      doses.delete(id);
      doseKeys.delete(d.idempotencyKey);
      for (const [k, e] of escalations) if (e.doseEventId === id) escalations.delete(k);
    }
    profiles.delete(profileId);
  };

  return {
    logs,
    circles: {
      async findByOwner(userId) {
        for (const c of circles.values()) if (c.ownerUserId === userId) return copy(c);
        return null;
      },
      async findById(id) {
        const c = circles.get(id);
        return c ? copy(c) : null;
      },
      async createWithSelf({ circle, self, link }) {
        for (const c of circles.values()) {
          if (c.ownerUserId === circle.ownerUserId) throw new Error('circle exists for owner');
        }
        circles.set(circle.id, copy(circle));
        profiles.set(self.id, copy(self));
        links.set(link.id, copy(link));
      },
    },
    profiles: {
      async findById(id) {
        const p = profiles.get(id);
        return p ? copy(p) : null;
      },
      async listForUser(userId) {
        return [...links.values()]
          .filter((l) => l.userId === userId && profiles.has(l.profileId))
          .map((l) => ({ profile: copy(profiles.get(l.profileId)!), role: l.role }))
          .sort((a, b) => a.profile.createdAt.getTime() - b.profile.createdAt.getTime());
      },
      async countInCircle(circleId) {
        return [...profiles.values()].filter((p) => p.circleId === circleId).length;
      },
      async create(profile, link) {
        profiles.set(profile.id, copy(profile));
        links.set(link.id, copy(link));
      },
      async update(id, patch) {
        const p = profiles.get(id);
        if (!p) return null;
        const next = { ...p, ...copy(patch) };
        profiles.set(id, next);
        return copy(next);
      },
      async roleOf(userId, profileId) {
        for (const l of links.values()) {
          if (l.userId === userId && l.profileId === profileId) return l.role;
        }
        return null;
      },
      async findBySubscriberId(subscriberId) {
        return [...profiles.values()].filter((p) => p.subscriberId === subscriberId).map(copy);
      },
      async addLink(link) {
        for (const l of links.values()) {
          if (l.userId === link.userId && l.profileId === link.profileId)
            throw new Error('link exists');
        }
        if (!profiles.has(link.profileId)) throw new Error('no such profile');
        links.set(link.id, copy(link));
      },
      async linksOf(profileId) {
        return [...links.values()]
          .filter((l) => l.profileId === profileId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
    },
    prescriptions: {
      async findById(id) {
        const p = prescriptions.get(id);
        return p ? copy(p) : null;
      },
      async saveConfirmed({ prescription, items: newItems, doses: newDoses }) {
        // Only a draft's items are replaced; a confirmed prescription only ever gains rows.
        if (prescriptions.get(prescription.id)?.status === 'DRAFT') {
          for (const [iid, it] of items) {
            if (it.prescriptionId === prescription.id) items.delete(iid);
          }
        }
        prescriptions.set(prescription.id, copy(prescription));
        for (const it of newItems) if (!items.has(it.id)) items.set(it.id, copy(it));
        for (const d of newDoses) {
          if (doseKeys.has(d.idempotencyKey)) continue;
          doseKeys.add(d.idempotencyKey);
          doses.set(d.id, copy(d));
        }
      },
    },
    doses: {
      async findById(id) {
        const d = doses.get(id);
        return d ? view(d) : null;
      },
      async listForProfile(profileId, from, to) {
        return [...doses.values()]
          .filter((d) => d.profileId === profileId && d.dueAt >= from && d.dueAt < to)
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id))
          .map(view);
      },
      async applyAction(id, patch, log) {
        const d = doses.get(id);
        if (!d) return null;
        const next = { ...d, ...copy(patch) };
        doses.set(id, next);
        logs.push(copy(log));
        return copy(next);
      },
      async listOpen(now, limit) {
        const base = (d: DoseRecord) => (d.status === 'SNOOZED' && d.snoozedUntil) || d.dueAt;
        return [...doses.values()]
          .filter((d) => d.stage !== 'CLOSED' && base(d) <= now)
          .sort((a, b) => base(a).getTime() - base(b).getTime() || a.id.localeCompare(b.id))
          .slice(0, limit)
          .map(copy);
      },
      async advance(id, from, patch, log) {
        const d = doses.get(id);
        if (!d || d.stage !== from.stage || d.status !== from.status) return null;
        const next = { ...d, ...copy(patch) };
        doses.set(id, next);
        if (log) logs.push(copy(log));
        return copy(next);
      },
    },
    escalations: {
      async record(row) {
        if (escalations.has(row.idempotencyKey) || !doses.has(row.doseEventId)) {
          return false;
        }
        escalations.set(row.idempotencyKey, {
          ...copy(row),
          acknowledgedAt: null,
          acknowledgedVia: null,
        });
        return true;
      },
      async forDose(doseEventId) {
        return [...escalations.values()]
          .filter((e) => e.doseEventId === doseEventId)
          .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
          .map(copy);
      },
      async acknowledge(doseEventId, at, via) {
        let n = 0;
        for (const e of escalations.values()) {
          if (e.doseEventId !== doseEventId || e.acknowledgedAt) continue;
          e.acknowledgedAt = at;
          e.acknowledgedVia = via;
          n++;
        }
        return n;
      },
      async listForUser(userId, since) {
        return [...escalations.values()]
          .filter((e) => e.notifiedUserId === userId && e.sentAt >= since)
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
          .map(copy);
      },
    },
    async eraseUser(userId) {
      for (const [id, c] of circles) {
        if (c.ownerUserId !== userId) continue;
        for (const p of [...profiles.values()]) if (p.circleId === id) removeProfile(p.id);
        circles.delete(id);
      }
      for (const [id, l] of links) if (l.userId === userId) links.delete(id);
      for (const e of escalations.values())
        if (e.notifiedUserId === userId) e.notifiedUserId = null;
      for (const p of profiles.values()) if (p.userId === userId) p.userId = null;
    },
  };
}
