import type {
  CircleRecord,
  DomainStore,
  DoseLogRecord,
  DoseRecord,
  DoseView,
  AppointmentRecord,
  AuditRecord,
  DeviceRecord,
  NoticeRecord,
  PharmacyRecord,
  ReportRecord,
  ReportValueRecord,
  SettingsRecord,
  StockRecord,
  SymptomLogRecord,
  TraceRecord,
  EscalationRecord,
  InviteRecord,
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
  const invites = new Map<string, InviteRecord>();
  const devices = new Map<string, DeviceRecord>(); // by Expo token
  const notices = new Map<string, NoticeRecord>(); // by ref
  const traces: TraceRecord[] = [];
  const audit: AuditRecord[] = [];
  const appointments = new Map<string, AppointmentRecord>();
  const reports = new Map<string, { report: ReportRecord; values: ReportValueRecord[] }>();
  const symptoms = new Map<string, SymptomLogRecord>();
  const pharmacies = new Map<string, PharmacyRecord>();
  const stock = new Map<string, StockRecord>(); // pharmacyId|drugBrandId
  const settings = new Map<string, SettingsRecord>();
  const phoneEncs = new Map<string, string>(); // profile id -> the dependent's encrypted number

  const copy = <T>(v: T): T => structuredClone(v);

  const view = (d: DoseRecord): DoseView => {
    const item = items.get(d.prescriptionItemId)!;
    return { ...copy(d), brandName: item.brandName, strength: item.strength, form: item.form };
  };

  const removeProfile = (profileId: string) => {
    for (const [id, l] of links) if (l.profileId === profileId) links.delete(id);
    for (const [id, i] of invites) if (i.profileId === profileId) invites.delete(id);
    for (const [k, n] of notices) if (n.profileId === profileId) notices.delete(k);
    for (const [id, a] of appointments) if (a.profileId === profileId) appointments.delete(id);
    for (const [id, r] of reports) if (r.report.profileId === profileId) reports.delete(id);
    for (const [id, l] of symptoms) if (l.profileId === profileId) symptoms.delete(id);
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
    phoneEncs.delete(profileId);
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
      async setOwnPhone(id, phone) {
        const p = profiles.get(id);
        if (!p) return false;
        // Same rule as the partial unique index in Postgres: one number, one profile.
        if (
          phone &&
          [...profiles.values()].some((o) => o.id !== id && o.subscriberId === phone.subscriberId)
        ) {
          throw new Error('subscriber id already on another profile');
        }
        p.subscriberId = phone?.subscriberId ?? null;
        if (phone) phoneEncs.set(id, phone.phoneEnc);
        else phoneEncs.delete(id);
        return true;
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
    links: {
      async findById(id) {
        const l = links.get(id);
        return l ? copy(l) : null;
      },
      async setRole(id, role) {
        const l = links.get(id);
        if (!l) return null;
        l.role = role;
        return copy(l);
      },
      async setSecondary(profileId, linkId) {
        for (const l of links.values()) {
          if (l.profileId === profileId) l.isSecondaryCaregiver = l.id === linkId;
        }
      },
      async remove(id) {
        return links.delete(id);
      },
    },
    invites: {
      async create(invite) {
        for (const i of invites.values()) {
          if (i.profileId === invite.profileId && i.phoneKey === invite.phoneKey && !i.acceptedAt) {
            return false;
          }
        }
        if (!profiles.has(invite.profileId)) throw new Error('no such profile');
        invites.set(invite.id, copy(invite));
        return true;
      },
      async openForPhone(phoneKey, now) {
        return [...invites.values()]
          .filter((i) => i.phoneKey === phoneKey && !i.acceptedAt && i.expiresAt > now)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
      async openForProfile(profileId, now) {
        return [...invites.values()]
          .filter((i) => i.profileId === profileId && !i.acceptedAt && i.expiresAt > now)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
      async accept(inviteId, link, at) {
        const i = invites.get(inviteId);
        if (!i || i.acceptedAt) return false;
        i.acceptedAt = at;
        i.acceptedBy = link.userId;
        for (const l of links.values()) {
          if (l.userId === link.userId && l.profileId === link.profileId) return false;
        }
        links.set(link.id, copy(link));
        return true;
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
      async profilesWithDoses(from, to) {
        const ids = new Set<string>();
        for (const d of doses.values()) if (d.dueAt >= from && d.dueAt < to) ids.add(d.profileId);
        return [...ids].sort();
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
    devices: {
      async upsert(device) {
        const known = devices.get(device.expoToken);
        devices.set(
          device.expoToken,
          known
            ? {
                ...known,
                userId: device.userId,
                platform: device.platform,
                lastSeenAt: device.lastSeenAt,
              }
            : copy(device),
        );
      },
      async listForUser(userId) {
        return [...devices.values()]
          .filter((d) => d.userId === userId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
      async removeToken(expoToken) {
        devices.delete(expoToken);
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
    notices: {
      async record(row) {
        if (notices.has(row.ref)) return false;
        notices.set(row.ref, copy(row));
        return true;
      },
      async listForUser(userId, since) {
        return [...notices.values()]
          .filter((n) => n.userId === userId && n.createdAt >= since)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(copy);
      },
    },
    traces: {
      async record(row) {
        traces.push(copy(row));
      },
      async list(limit) {
        return [...traces]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit)
          .map(copy);
      },
      async purgeBefore(cutoff) {
        const before = traces.length;
        const kept = traces.filter((t) => t.createdAt >= cutoff);
        traces.splice(0, traces.length, ...kept);
        return before - kept.length;
      },
    },
    audit: {
      async record(row) {
        audit.push(copy(row));
      },
      async listForActor(actorUserId) {
        return audit
          .filter((a) => a.actorUserId === actorUserId)
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .map(copy);
      },
      async listForProfile(profileId) {
        return audit
          .filter((a) => a.profileId === profileId)
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .map(copy);
      },
      async purgeBefore(cutoff) {
        const before = audit.length;
        const kept = audit.filter((a) => a.at >= cutoff);
        audit.splice(0, audit.length, ...kept);
        return before - kept.length;
      },
    },
    appointments: {
      async create(row) {
        if (!profiles.has(row.profileId)) throw new Error('no such profile');
        appointments.set(row.id, copy(row));
      },
      async listForProfile(profileId, from) {
        return [...appointments.values()]
          .filter((a) => a.profileId === profileId && a.dueAt >= from)
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
          .map(copy);
      },
      async listPendingDue(from, to) {
        return [...appointments.values()]
          .filter((a) => a.reminderState === 'PENDING' && a.dueAt >= from && a.dueAt < to)
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
          .map(copy);
      },
      async markReminded(id) {
        const a = appointments.get(id);
        if (!a || a.reminderState !== 'PENDING') return false;
        a.reminderState = 'REMINDED';
        return true;
      },
    },
    items: {
      async confirmedForProfile(profileId, since) {
        const out: Array<{ item: PrescriptionItemRecord; confirmedAt: Date }> = [];
        for (const it of items.values()) {
          const pre = prescriptions.get(it.prescriptionId);
          if (!pre || pre.profileId !== profileId || pre.status !== 'CONFIRMED') continue;
          if (!pre.confirmedAt || pre.confirmedAt < since) continue;
          out.push({ item: copy(it), confirmedAt: pre.confirmedAt });
        }
        return out.sort(
          (a, b) =>
            b.confirmedAt.getTime() - a.confirmedAt.getTime() || a.item.position - b.item.position,
        );
      },
      async refillDueBetween(fromDate, toDate) {
        const out: Array<{ item: PrescriptionItemRecord; profileId: string }> = [];
        for (const it of items.values()) {
          const pre = prescriptions.get(it.prescriptionId);
          if (!pre || pre.status !== 'CONFIRMED' || !it.refillDueOn) continue;
          if (it.refillDueOn < fromDate || it.refillDueOn > toDate) continue;
          out.push({ item: copy(it), profileId: pre.profileId });
        }
        return out.sort((a, b) => a.item.id.localeCompare(b.item.id));
      },
    },
    reports: {
      async create(report, values) {
        if (!profiles.has(report.profileId)) throw new Error('no such profile');
        reports.set(report.id, { report: copy(report), values: copy(values) });
      },
      async findById(id) {
        const r = reports.get(id);
        return r ? copy(r) : null;
      },
      async listForProfiles(profileIds) {
        const ids = new Set(profileIds);
        return [...reports.values()]
          .map((r) => r.report)
          .filter((r) => ids.has(r.profileId))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
          .map(copy);
      },
    },
    symptoms: {
      async record(log) {
        if (!profiles.has(log.profileId)) throw new Error('no such profile');
        symptoms.set(log.id, copy(log));
      },
      async findById(id) {
        const s = symptoms.get(id);
        return s ? copy(s) : null;
      },
      async listForProfile(profileId, limit) {
        return [...symptoms.values()]
          .filter((s) => s.profileId === profileId)
          .sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime() || b.id.localeCompare(a.id))
          .slice(0, limit)
          .map(copy);
      },
    },
    pharmacies: {
      async findByOwner(userId) {
        for (const p of pharmacies.values()) if (p.ownerUserId === userId) return copy(p);
        return null;
      },
      async save(pharmacy) {
        for (const p of pharmacies.values()) {
          if (
            p.id !== pharmacy.id &&
            pharmacy.ownerUserId &&
            p.ownerUserId === pharmacy.ownerUserId
          ) {
            throw new Error('owner has a pharmacy');
          }
        }
        pharmacies.set(pharmacy.id, copy(pharmacy));
      },
      async list() {
        return [...pharmacies.values()]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
          .map(copy);
      },
      async setStock(row) {
        if (!pharmacies.has(row.pharmacyId)) throw new Error('no such pharmacy');
        stock.set(`${row.pharmacyId}|${row.drugBrandId}`, copy(row));
      },
      async stockOf(pharmacyId) {
        return [...stock.values()]
          .filter((s) => s.pharmacyId === pharmacyId)
          .sort((a, b) => a.drugBrandId.localeCompare(b.drugBrandId))
          .map(copy);
      },
      async stockForDrug(drugBrandId) {
        return [...stock.values()]
          .filter((s) => s.drugBrandId === drugBrandId)
          .sort((a, b) => a.pharmacyId.localeCompare(b.pharmacyId))
          .map(copy);
      },
    },
    settings: {
      async get(userId) {
        const s = settings.get(userId);
        return s ? copy(s) : null;
      },
      async put(row) {
        settings.set(row.userId, copy(row));
      },
    },
    async eraseUser(userId) {
      for (const [id, c] of circles) {
        if (c.ownerUserId !== userId) continue;
        for (const p of [...profiles.values()]) if (p.circleId === id) removeProfile(p.id);
        circles.delete(id);
      }
      for (const [id, l] of links) if (l.userId === userId) links.delete(id);
      for (const [token, d] of devices) if (d.userId === userId) devices.delete(token);
      for (const [k, n] of notices) if (n.userId === userId) notices.delete(k);
      settings.delete(userId);
      for (const p of pharmacies.values()) if (p.ownerUserId === userId) p.ownerUserId = null;
      for (const e of escalations.values())
        if (e.notifiedUserId === userId) e.notifiedUserId = null;
      for (const p of profiles.values()) if (p.userId === userId) p.userId = null;
    },
  };
}
