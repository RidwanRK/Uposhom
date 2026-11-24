/**
 * The app endpoints that were missing on the server: prescription and report scans, the report
 * vault, the symptom journal and doctor summary, voice, insights, the drug finder, pharmacies, and
 * account settings. The thinking is workstream C's (packages/ai) and is only called from here; the
 * storage is B's (the domain store). Every call is checked against the user's link to the profile,
 * the same way as the rest of B's routes.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  autocompleteBrandNames,
  createDoctorSummary,
  extractReportVision,
  findGenericAlternatives,
  getProfileInsights,
  loadDgdaCatalog,
  processJournalTurn,
  processPrescriptionIntake,
  runTriageRouter,
  transcribeBanglaAudio,
  type DgdaDrugRecord,
  type DoseEventInfo,
} from '@uposhom/ai';
import { addDays, dhakaMidnight, toDhakaDate, toDhakaIso } from '@uposhom/schedule-engine';
import {
  insightsResponse,
  journalResponse,
  reportDetail,
  uploadAndParseResponse,
  type AccountSettings,
  type DoctorSummary,
  type DrugBrand,
  type GenericsResponse,
  type InsightsResponse,
  type JournalBody,
  type JournalResponse,
  type MyPharmacyResponse,
  type NearbyPharmacy,
  type ReportDetail,
  type ReportSummary,
  type StockStatus,
  type StoreProfile,
  type TimelineEntry,
  type UploadAndParseResponse,
} from '@uposhom/shared';
import { bnDate } from './care-jobs.js';
import { DomainError } from './errors.js';
import type { DomainService } from './service.js';
import type { DomainStore, PharmacyRecord, PrescriptionItemRecord } from './types.js';

const DAY = 86_400_000;
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** An uploaded file, already read into memory (the routes cap it at 8 MB). */
export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
}

export interface FeatureDeps {
  store: DomainStore;
  domain: DomainService;
  now: () => Date;
  /** From A's entitlements: spends one scan from the quota, a credit or Premium. */
  useScan: (userId: string) => Promise<{ allowed: boolean }>;
  /** From A's entitlements: a paid-per-use feature, included in Premium. */
  useFeature: (userId: string, feature: 'DOCTOR_SUMMARY') => Promise<{ allowed: boolean }>;
  isPremium: (userId: string) => Promise<boolean>;
  accountType: (userId: string) => Promise<'INDIVIDUAL' | 'PHARMACY' | null>;
  /** From A's user store: the account whose number has this opaque subscriber id. */
  findUserIdBySubscriber: (subscriberId: string) => Promise<string | null>;
  /** From A's entitlements: spends one SMS from the monthly allowance. */
  useSms: (userId: string) => Promise<{ allowed: boolean }>;
}

/** An SMS answer stays within about three Bangla (UCS-2) segments. */
export const SMS_ANSWER_MAX_CHARS = 200;

// ---------------------------------------------------------------- data files

/**
 * Workstream C's seed data (data/*.json) is read from the working directory, as C's own loaders do:
 * the repo root in development, /app in the API image (deploy/Dockerfile.api copies data/ there).
 */
function readDataFile<T>(name: string): T | null {
  for (const p of [
    path.resolve(process.cwd(), 'data', name),
    path.resolve(process.cwd(), '../../data', name),
  ]) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
    } catch {
      return null;
    }
  }
  return null;
}

interface SeedPharmacy {
  id: string;
  name: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  isPartner?: boolean;
  priorityListing?: boolean;
}

let seedPharmacies: SeedPharmacy[] | null = null;
const partnerPharmacies = (): SeedPharmacy[] =>
  (seedPharmacies ??= readDataFile<SeedPharmacy[]>('pharmacies.json') ?? []);

const toDrugBrand = (d: DgdaDrugRecord): DrugBrand => ({
  id: d.id,
  nameEn: d.nameEn,
  nameBn: d.nameBn,
  generic: d.generic,
  strength: d.strength,
  form: d.form,
  manufacturer: d.manufacturer,
  indicativePrice: d.indicativePrice,
});

// ---------------------------------------------------------------- helpers

const DHAKA_CENTER = { lat: 23.8103, lng: 90.4125 };

/** Great-circle distance in km. */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dataUri(file: UploadedFile): string {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

/** C's functions call OpenRouter: any failure there is the AI service, not the request. */
async function callAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('AI_UNAVAILABLE', 503);
  }
}

const medicineLabel = (i: Pick<PrescriptionItemRecord, 'brandName' | 'strength'>) =>
  [i.brandName, i.strength].filter(Boolean).join(' ');

export function createFeatureService(deps: FeatureDeps) {
  const { store, domain } = deps;

  /** The profile to use when the app did not say: the user's own, else the first linked. */
  async function defaultProfileId(userId: string): Promise<string> {
    await domain.getCircle(userId); // makes sure the user's own profile exists
    const linked = await store.profiles.listForUser(userId);
    const id = (linked.find((l) => l.profile.userId === userId) ?? linked[0])?.profile.id;
    if (!id) throw new DomainError('NOT_FOUND', 404);
    return id;
  }

  // ---------------------------------------------------------------- prescription scan

  /**
   * POST /prescriptions/upload-and-parse: C's vision intake reads the photo; B saves a DRAFT that
   * the confirm screen then confirms by id. The photo itself is not kept yet (no object storage).
   */
  async function scanPrescription(
    userId: string,
    file: UploadedFile,
    profileId?: string,
  ): Promise<UploadAndParseResponse> {
    const pid = profileId ?? (await defaultProfileId(userId));
    await domain.access(userId, pid, true);
    if (!file.mimetype.startsWith('image/')) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'FILE_TYPE' });
    }
    if (!(await deps.useScan(userId)).allowed) {
      throw new DomainError('PAYMENT_REQUIRED', 402, { message: 'SCAN' });
    }
    const result = await callAi(() => processPrescriptionIntake(dataUri(file)));
    const now = deps.now();
    const id = newId('pre');
    const items: PrescriptionItemRecord[] = result.extractedItems.map((it, i) => ({
      id: newId('itm'),
      prescriptionId: id,
      position: i,
      brandName: it.brandName.trim() || '?',
      strength: it.strength?.trim() || null,
      form: it.form?.trim() || null,
      parsedPattern: it.pattern ?? '',
      mealRelation: it.mealRelation,
      durationDays:
        Number.isInteger(it.durationDays) && it.durationDays > 0 ? it.durationDays : null,
      pillCount: typeof it.pillCount === 'number' && it.pillCount >= 0 ? it.pillCount : null,
      asNeeded: false,
      isCritical: false, // a person decides this on the confirm screen
      courseEndsOn: null,
      refillDueOn: null,
    }));
    await store.prescriptions.saveConfirmed({
      prescription: {
        id,
        profileId: pid,
        status: 'DRAFT',
        startDate: null,
        createdBy: userId,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: now,
      },
      items,
      doses: [],
    });
    return uploadAndParseResponse.parse({
      draftPrescriptionId: id,
      transcribedText: result.transcribedText,
      extractedItems: result.extractedItems,
    });
  }

  // ---------------------------------------------------------------- reports

  async function scanReport(
    userId: string,
    file: UploadedFile,
    profileId?: string,
  ): Promise<ReportDetail> {
    const pid = profileId ?? (await defaultProfileId(userId));
    await domain.access(userId, pid, true);
    if (!file.mimetype.startsWith('image/')) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'FILE_TYPE' });
    }
    const { detail } = await callAi(() => extractReportVision(dataUri(file), { profileId: pid }));
    const id = newId('rep');
    await store.reports.create(
      {
        id,
        profileId: pid,
        title: detail.testType || null,
        reportDate: ISO_DATE.test(detail.date) ? detail.date : null,
        center: detail.center || null,
        testType: detail.testType || null,
        createdBy: userId,
        createdAt: deps.now(),
      },
      detail.values.map((v) => ({
        testName: v.test,
        value: v.value,
        unit: v.unit || null,
        printedRange: v.printedRange || null,
        flag: v.flag,
        explanationBn: v.explanationBn || null,
      })),
    );
    return reportDetail.parse({ ...detail, id, profileId: pid });
  }

  async function listReports(
    userId: string,
    profileId?: string,
  ): Promise<{ reports: ReportSummary[] }> {
    let ids: string[];
    if (profileId) {
      await domain.access(userId, profileId, false);
      ids = [profileId];
    } else {
      ids = (await store.profiles.listForUser(userId)).map((l) => l.profile.id);
    }
    const rows = await store.reports.listForProfiles(ids);
    return {
      reports: rows.map((r) => ({
        id: r.id,
        date: r.reportDate ?? toDhakaDate(r.createdAt.getTime()),
        center: r.center ?? '',
        testType: r.testType ?? r.title ?? '',
        profileId: r.profileId,
      })),
    };
  }

  /** A report is a medical record: a read by anyone but the patient goes to the audit log. */
  async function getReport(userId: string, id: string): Promise<ReportDetail> {
    const found = await store.reports.findById(id);
    if (!found) throw new DomainError('NOT_FOUND', 404);
    const { profile } = await domain.access(userId, found.report.profileId, false);
    if (profile.userId !== userId) {
      await store.audit.record({
        actorUserId: userId,
        action: 'READ_REPORT',
        subjectType: 'report',
        subjectId: id,
        profileId: profile.id,
        detail: null,
        at: deps.now(),
      });
    }
    const r = found.report;
    return reportDetail.parse({
      id: r.id,
      date: r.reportDate ?? toDhakaDate(r.createdAt.getTime()),
      center: r.center ?? '',
      testType: r.testType ?? r.title ?? '',
      profileId: r.profileId,
      values: found.values.map((v) => ({
        test: v.testName,
        value: v.value,
        unit: v.unit ?? '',
        printedRange: v.printedRange ?? '',
        flag: v.flag,
        explanationBn: v.explanationBn ?? '',
      })),
    });
  }

  // ---------------------------------------------------------------- symptoms and summary

  /**
   * POST /symptoms/journal: C's journal asks up to six follow-ups, with the red-flag guard first.
   * A finished journal and any red flag are kept in symptom_logs; the summary id is that row's.
   */
  async function journal(userId: string, body: JournalBody): Promise<JournalResponse> {
    await domain.access(userId, body.profileId, true);
    const res = await callAi(() => processJournalTurn(body));
    const now = deps.now();
    if (res.isRedFlag) {
      await store.symptoms.record({
        id: newId('sym'),
        profileId: body.profileId,
        source: body.channel,
        data: { kind: 'RED_FLAG', slots: res.collectedSlots ?? {} },
        redFlag: true,
        loggedAt: now,
      });
    } else if (res.doctorSummaryReady && res.summary) {
      const id = newId('sym');
      res.summary = { ...res.summary, id };
      await store.symptoms.record({
        id,
        profileId: body.profileId,
        source: body.channel,
        data: { kind: 'SUMMARY', slots: res.collectedSlots ?? {}, summary: res.summary },
        redFlag: false,
        loggedAt: now,
      });
    }
    return journalResponse.parse(res);
  }

  /** Current medicines and the prescriptions of the last 90 days, from confirmed prescriptions. */
  async function medicineHistory(profileId: string) {
    const now = deps.now();
    const today = toDhakaDate(now.getTime());
    const rows = await store.items.confirmedForProfile(
      profileId,
      new Date(now.getTime() - 90 * DAY),
    );
    const current = [
      ...new Set(
        rows
          .filter(({ item }) => item.asNeeded || (item.courseEndsOn ?? '') >= today)
          .map(({ item }) => medicineLabel(item)),
      ),
    ];
    const byDay = new Map<string, string[]>();
    for (const { item, confirmedAt } of rows) {
      const day = toDhakaDate(confirmedAt.getTime());
      byDay.set(day, [...(byDay.get(day) ?? []), medicineLabel(item)]);
    }
    const recent = [...byDay.entries()].map(
      ([day, names]) => `${names.join(', ')} (${bnDate(day)})`,
    );
    return { current, recent };
  }

  /** POST /summaries/doctor: Premium, or a paid credit (A's CaaS), as the app's payment gate expects. */
  async function doctorSummary(
    userId: string,
    body: { profileId: string; summaryId?: string | undefined },
  ): Promise<{ summary: DoctorSummary }> {
    await domain.access(userId, body.profileId, false);
    let source = body.summaryId ? await store.symptoms.findById(body.summaryId) : null;
    if (body.summaryId && source?.profileId !== body.profileId)
      throw new DomainError('NOT_FOUND', 404);
    if (!source) {
      source =
        (await store.symptoms.listForProfile(body.profileId, 20)).find(
          (l) => l.data['kind'] === 'SUMMARY',
        ) ?? null;
    }
    const { current, recent } = await medicineHistory(body.profileId);
    if (!(await deps.useFeature(userId, 'DOCTOR_SUMMARY')).allowed) {
      throw new DomainError('PAYMENT_REQUIRED', 402, { message: 'DOCTOR_SUMMARY' });
    }
    const from = (source?.data['summary'] ?? {}) as Partial<DoctorSummary>;
    const summary = createDoctorSummary({
      id: source?.id ?? newId('dsm'),
      symptoms: from.symptoms || 'কোনো সাম্প্রতিক লক্ষণ নেই',
      ...(from.onset ? { onset: from.onset } : {}),
      ...(from.duration ? { duration: from.duration } : {}),
      ...(from.severity ? { severity: from.severity } : {}),
      ...(from.triggers ? { triggers: from.triggers } : {}),
      ...(from.associated ? { associated: from.associated } : {}),
      currentMedicines: current,
      recentPrescriptions: recent,
      createdAt: toDhakaIso(deps.now().getTime()),
    });
    return { summary };
  }

  // ---------------------------------------------------------------- voice

  async function transcribe(file: UploadedFile): Promise<{ transcript: string }> {
    if (!file.mimetype.startsWith('audio/') && file.mimetype !== 'application/octet-stream') {
      throw new DomainError('INVALID_INPUT', 400, { message: 'FILE_TYPE' });
    }
    return callAi(() => transcribeBanglaAudio(file.buffer));
  }

  /**
   * POST /voice/query: C's triage router answers ("what is my next medicine?") from this profile's
   * real doses. Every run is traced for the admin trace screen.
   */
  async function voiceQuery(
    userId: string,
    body: { profileId: string; text: string },
  ): Promise<{ answerText: string }> {
    await domain.access(userId, body.profileId, false);
    const text = body.text.trim().slice(0, 500);
    if (!text) throw new DomainError('INVALID_INPUT', 400);
    return { answerText: await askRouter(userId, body.profileId, text, 'VOICE') };
  }

  /**
   * SMS Q&A (Master Plan section 7, "Router with SMS free-text Q&A"): a free-text SMS from an
   * account holder, or from a dependent's own phone (Family Link), goes to the same read-only
   * router as a voice query, over that person's own profile. The answer costs an SMS, so it is
   * taken from the circle owner's allowance; when that is used up nothing is sent.
   */
  async function smsQuestion(input: {
    subscriberId: string;
    text: string;
  }): Promise<{ replyText: string | null; silent?: boolean }> {
    const text = input.text.trim().slice(0, 300);
    if (!text) return { replyText: null };

    let profileId: string;
    let payer: string | null;
    const dependent = (await store.profiles.findBySubscriberId(input.subscriberId))[0];
    if (dependent) {
      profileId = dependent.id;
      payer = (await store.circles.findById(dependent.circleId))?.ownerUserId ?? null;
    } else {
      const userId = await deps.findUserIdBySubscriber(input.subscriberId);
      if (!userId) return { replyText: null, silent: true };
      payer = userId;
      profileId = await defaultProfileId(userId);
    }
    if (!payer || !(await deps.useSms(payer)).allowed) return { replyText: null, silent: true };

    const answer = (await askRouter(payer, profileId, text, 'SMS')).trim();
    if (!answer) return { replyText: null };
    return {
      replyText:
        answer.length > SMS_ANSWER_MAX_CHARS
          ? `${answer.slice(0, SMS_ANSWER_MAX_CHARS - 1)}…`
          : answer,
    };
  }

  /** The triage router over one profile's own doses, read-only, traced. */
  async function askRouter(
    userId: string | null,
    profileId: string,
    text: string,
    channel: 'VOICE' | 'SMS',
  ): Promise<string> {
    const toInfo = (
      d: Awaited<ReturnType<DomainStore['doses']['listForProfile']>>[number],
    ): DoseEventInfo => ({
      id: d.id,
      brandName: d.brandName,
      dosageStrength: d.strength ?? '',
      dueTimeDhaka: toDhakaIso(d.dueAt.getTime()).slice(11, 16),
      mealRelation: d.mealRelation,
      isCritical: d.isCritical,
      status:
        d.status === 'TAKEN' || d.status === 'TAKEN_LATE'
          ? 'TAKEN'
          : d.status === 'SNOOZED'
            ? 'SNOOZED'
            : d.status === 'SCHEDULED'
              ? 'SCHEDULED'
              : 'MISSED',
    });
    // Only ever this profile's doses, whatever id the router passes back.
    const doseFetcher = {
      async getTodayDoses() {
        const day = dhakaMidnight(toDhakaDate(deps.now().getTime()))!;
        return (
          await store.doses.listForProfile(profileId, new Date(day), new Date(addDays(day, 1)))
        ).map(toInfo);
      },
      async getNextDose() {
        const now = deps.now();
        const next = (
          await store.doses.listForProfile(profileId, now, new Date(now.getTime() + DAY))
        ).find((d) => d.status === 'SCHEDULED' || d.status === 'SNOOZED');
        return next ? toInfo(next) : null;
      },
    };
    const result = await callAi(() =>
      runTriageRouter(text, {
        profileId,
        channel,
        doseFetcher,
        onTrace: async (t) => {
          await domain.recordTrace({
            userId,
            profileId,
            channel,
            rootAgent: t.agent,
            inputPreview: t.inputPreview ?? null,
            handoffs: t.handoffs,
            toolCalls: t.toolCalls,
            durationMs: t.latencyMs,
          });
        },
      }),
    );
    return result.reply;
  }

  // ---------------------------------------------------------------- insights

  /** GET /insights/:profileId: C's pattern analytics over this profile's journals and prescriptions. */
  async function insights(userId: string, profileId: string): Promise<InsightsResponse> {
    const { profile } = await domain.access(userId, profileId, false);
    const circle = await store.circles.findById(profile.circleId);
    const premium = circle ? await deps.isPremium(circle.ownerUserId) : false;
    const timeline: TimelineEntry[] = [];
    for (const log of await store.symptoms.listForProfile(profileId, 200)) {
      const summary = log.data['summary'] as Partial<DoctorSummary> | undefined;
      if (log.data['kind'] !== 'SUMMARY' || !summary?.symptoms) continue;
      timeline.push({
        id: log.id,
        date: toDhakaDate(log.loggedAt.getTime()),
        kind: 'SYMPTOM',
        title: summary.symptoms,
      });
    }
    const catalog = loadDgdaCatalog();
    const byPrescription = new Map<string, { date: string; names: string[]; cls?: string }>();
    for (const { item, confirmedAt } of await store.items.confirmedForProfile(
      profileId,
      new Date(deps.now().getTime() - 365 * DAY),
    )) {
      const entry = byPrescription.get(item.prescriptionId) ?? {
        date: toDhakaDate(confirmedAt.getTime()),
        names: [],
      };
      entry.names.push(medicineLabel(item));
      const match = catalog.find((d) => d.nameEn.toLowerCase() === item.brandName.toLowerCase());
      if (match && !entry.cls) entry.cls = match.therapeuticClass;
      byPrescription.set(item.prescriptionId, entry);
    }
    for (const [id, e] of byPrescription) {
      timeline.push({
        id,
        date: e.date,
        kind: 'PRESCRIPTION',
        title: e.names.join(', '),
        ...(e.cls ? { therapeuticClass: e.cls } : {}),
      });
    }
    return insightsResponse.parse(
      getProfileInsights(profileId, { additionalTimeline: timeline, isPremium: premium }),
    );
  }

  // ---------------------------------------------------------------- drugs

  function searchDrugs(q: string): { results: DrugBrand[] } {
    const query = q.trim().slice(0, 60);
    if (!query) return { results: [] };
    return { results: autocompleteBrandNames(query, 12).map((c) => toDrugBrand(c.drug)) };
  }

  function generics(brand: string): GenericsResponse {
    const found = brand.trim() ? findGenericAlternatives(brand.trim()) : null;
    if (!found) throw new DomainError('NOT_FOUND', 404);
    return found;
  }

  // ---------------------------------------------------------------- pharmacies

  /**
   * GET /pharmacies: stores that signed up as Pharmacy accounts, plus workstream C's partner list
   * (data/pharmacies.json). Stock comes only from owners' own updates, never guessed.
   */
  async function nearbyPharmacies(q: {
    lat?: number | undefined;
    lng?: number | undefined;
    area?: string | undefined;
    drugId?: string | undefined;
    radiusKm?: number | undefined;
  }): Promise<{ pharmacies: NearbyPharmacy[] }> {
    let origin =
      q.lat !== undefined && q.lng !== undefined && Number.isFinite(q.lat) && Number.isFinite(q.lng)
        ? { lat: q.lat, lng: q.lng }
        : DHAKA_CENTER;
    // An emulator reports a location abroad: search from central Dhaka instead, as the mock does.
    if (km(origin, DHAKA_CENTER) > 60) origin = DHAKA_CENTER;
    const radius = q.radiusKm && q.radiusKm > 0 ? Math.min(q.radiusKm, 50) : 3;
    const area = q.area?.trim().toLowerCase() ?? '';

    const stock = new Map<string, { status: StockStatus; at: Date }>();
    if (q.drugId) {
      for (const s of await store.pharmacies.stockForDrug(q.drugId)) {
        stock.set(s.pharmacyId, {
          status: s.inStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
          at: s.updatedAt,
        });
      }
    }

    type Row = { p: NearbyPharmacy; d: number | null; rank: number };
    const rows: Row[] = [];
    const add = (
      p: {
        id: string;
        name: string;
        address: string;
        phone: string;
        lat: number | null;
        lng: number | null;
      },
      partner: boolean,
      priority: boolean,
    ) => {
      const d = p.lat !== null && p.lng !== null ? km(origin, { lat: p.lat, lng: p.lng }) : null;
      if (area) {
        if (!p.name.toLowerCase().includes(area) && !p.address.toLowerCase().includes(area)) return;
      } else if (d === null || d > radius) {
        return;
      }
      const s = stock.get(p.id);
      rows.push({
        p: {
          id: p.id,
          name: p.name,
          address: p.address,
          distanceKm: area || d === null ? null : Math.round(d * 10) / 10,
          phone: p.phone,
          isPartner: partner,
          ...(s ? { stockStatus: s.status, stockUpdatedAt: toDhakaIso(s.at.getTime()) } : {}),
        },
        d,
        rank: priority ? 0 : partner ? 1 : 2,
      });
    };

    for (const p of await store.pharmacies.list()) {
      if (!p.name) continue; // an owner who has not filled in the store yet
      add(
        {
          id: p.id,
          name: p.name,
          address: p.address ?? '',
          phone: p.phone ?? '',
          lat: p.lat,
          lng: p.lng,
        },
        p.isPartner,
        p.priorityListing,
      );
    }
    for (const p of partnerPharmacies()) {
      add(p, p.isPartner ?? true, p.priorityListing ?? false);
    }
    rows.sort((a, b) => a.rank - b.rank || (a.d ?? Infinity) - (b.d ?? Infinity));
    return { pharmacies: rows.map((r) => r.p) };
  }

  async function requireOwner(userId: string): Promise<void> {
    if ((await deps.accountType(userId)) !== 'PHARMACY') throw new DomainError('FORBIDDEN', 403);
  }

  /** The owner's store, made on first use. Partner and priority follow the store's Subscription. */
  async function ownStore(userId: string): Promise<PharmacyRecord> {
    const premium = await deps.isPremium(userId);
    const found = await store.pharmacies.findByOwner(userId);
    const p: PharmacyRecord = found
      ? { ...found, isPartner: premium, priorityListing: premium }
      : {
          id: newId('phm'),
          ownerUserId: userId,
          name: '',
          address: null,
          lat: null,
          lng: null,
          phone: null,
          openingHours: null,
          isPartner: premium,
          priorityListing: premium,
          createdAt: deps.now(),
        };
    if (!found || found.isPartner !== premium || found.priorityListing !== premium) {
      await store.pharmacies.save(p);
    }
    return p;
  }

  async function myPharmacy(userId: string): Promise<MyPharmacyResponse> {
    await requireOwner(userId);
    const p = await ownStore(userId);
    const catalog = new Map(loadDgdaCatalog().map((d) => [d.id, d]));
    return {
      profile: {
        name: p.name,
        address: p.address ?? '',
        phone: p.phone ?? '',
        openingHours: p.openingHours ?? '',
        lat: p.lat,
        lng: p.lng,
        isPartner: p.isPartner,
        priorityListing: p.priorityListing,
      },
      stock: (await store.pharmacies.stockOf(p.id)).flatMap((s) => {
        const d = catalog.get(s.drugBrandId);
        return d
          ? [
              {
                drugId: d.id,
                nameEn: d.nameEn,
                nameBn: d.nameBn,
                strength: d.strength,
                status: s.inStock ? ('IN_STOCK' as const) : ('OUT_OF_STOCK' as const),
                updatedAt: toDhakaIso(s.updatedAt.getTime()),
              },
            ]
          : [];
      }),
    };
  }

  async function updatePharmacyProfile(
    userId: string,
    body: StoreProfile,
  ): Promise<{ success: boolean }> {
    await requireOwner(userId);
    const name = body.name.trim();
    if (!name || name.length > 100 || body.address.length > 300 || body.phone.length > 30) {
      throw new DomainError('INVALID_INPUT', 400);
    }
    const lat = body.lat ?? null;
    const lng = body.lng ?? null;
    if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'LOCATION' });
    }
    const p = await ownStore(userId);
    await store.pharmacies.save({
      ...p,
      name,
      address: body.address.trim(),
      phone: body.phone.trim(),
      openingHours: body.openingHours.trim().slice(0, 100),
      lat,
      lng,
    });
    return { success: true };
  }

  async function setStock(
    userId: string,
    drugId: string,
    status: StockStatus,
  ): Promise<{ success: boolean }> {
    await requireOwner(userId);
    if (!loadDgdaCatalog().some((d) => d.id === drugId)) throw new DomainError('NOT_FOUND', 404);
    const p = await ownStore(userId);
    await store.pharmacies.setStock({
      pharmacyId: p.id,
      drugBrandId: drugId,
      inStock: status === 'IN_STOCK',
      updatedAt: deps.now(),
    });
    return { success: true };
  }

  // ---------------------------------------------------------------- account settings

  async function getSettings(userId: string): Promise<AccountSettings> {
    const s = await store.settings.get(userId);
    return { discreetSms: s?.discreetSms ?? false, smsReminders: s?.smsReminders ?? true };
  }

  async function putSettings(
    userId: string,
    patch: Partial<AccountSettings>,
  ): Promise<AccountSettings> {
    const next = { ...(await getSettings(userId)), ...patch };
    await store.settings.put({ userId, ...next, updatedAt: deps.now() });
    return next;
  }

  return {
    smsQuestion,
    scanPrescription,
    scanReport,
    listReports,
    getReport,
    journal,
    doctorSummary,
    transcribe,
    voiceQuery,
    insights,
    searchDrugs,
    generics,
    nearbyPharmacies,
    myPharmacy,
    updatePharmacyProfile,
    setStock,
    getSettings,
    putSettings,
  };
}

export type FeatureService = ReturnType<typeof createFeatureService>;
