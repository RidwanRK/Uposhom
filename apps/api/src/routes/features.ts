import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  accountSettings,
  doctorSummaryBody,
  doctorSummaryResponse,
  drugSearchResponse,
  genericsResponse,
  insightsResponse,
  journalBody,
  journalResponse,
  myPharmacyResponse,
  okResponse,
  pharmaciesResponse,
  reportDetail,
  reportListResponse,
  setStockBody,
  storeProfile,
  transcribeResponse,
  uploadAndParseResponse,
  voiceQueryBody,
  voiceQueryResponse,
} from '@uposhom/shared';
import { DomainError, useDomainErrors } from '../domain/errors.js';
import type { FeatureService, UploadedFile } from '../domain/features.js';

/** Photos and recordings: 8 MB is far above a phone's resized WebP or a minute of audio. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError('INVALID_INPUT', 400);
  return r.data;
};

const userOf = (req: FastifyRequest): string => {
  const id = req.auth?.userId;
  if (!id) throw new DomainError('FORBIDDEN', 403);
  return id;
};

/**
 * Reads one multipart upload: the named file and any plain fields, in whatever order the app sent
 * them (its FormData puts the file first, then profileId).
 */
async function readUpload(
  req: FastifyRequest,
  field: string,
): Promise<{ file: UploadedFile; fields: Record<string, string> }> {
  if (!req.isMultipart()) throw new DomainError('INVALID_INPUT', 400, { message: 'MULTIPART' });
  let file: UploadedFile | null = null;
  const fields: Record<string, string> = {};
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === field) file = { buffer, mimetype: part.mimetype };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new DomainError('INVALID_INPUT', 413, { message: 'FILE_TOO_LARGE' });
    }
    throw new DomainError('INVALID_INPUT', 400, { message: 'MULTIPART' });
  }
  if (!file || file.buffer.length === 0)
    throw new DomainError('INVALID_INPUT', 400, { message: 'FILE' });
  return { file, fields };
}

const reportsQuery = z.object({ profileId: z.string().min(1).optional() });
const searchQuery = z.object({ q: z.string().max(100).default('') });
const genericsQuery = z.object({ brand: z.string().min(1).max(100) });
const pharmaciesQuery = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  area: z.string().max(100).optional(),
  drugId: z.string().max(100).optional(),
  radiusKm: z.coerce.number().optional(),
});
const settingsPatch = accountSettings.partial();

/**
 * The app endpoints that were missing on the server (see domain/features.ts). All under /api/v1,
 * all need a signed-in user; responses are checked against the shared contracts on the way out.
 */
export function featureRoutes(features: FeatureService) {
  return async function register(app: FastifyInstance): Promise<void> {
    useDomainErrors(app);
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });
    app.addHook('preHandler', app.authenticate);

    // Scans
    app.post('/prescriptions/upload-and-parse', async (req) => {
      const { file, fields } = await readUpload(req, 'file');
      return uploadAndParseResponse.parse(
        await features.scanPrescription(userOf(req), file, fields['profileId'] || undefined),
      );
    });
    app.post('/reports/upload-and-parse', async (req) => {
      const { file, fields } = await readUpload(req, 'file');
      return reportDetail.parse(
        await features.scanReport(userOf(req), file, fields['profileId'] || undefined),
      );
    });

    // Report vault
    app.get('/reports', async (req) => {
      const q = parse(reportsQuery, req.query);
      return reportListResponse.parse(await features.listReports(userOf(req), q.profileId));
    });
    app.get<{ Params: { id: string } }>('/reports/:id', async (req) =>
      reportDetail.parse(await features.getReport(userOf(req), req.params.id)),
    );

    // Symptom journal and the doctor summary
    app.post('/symptoms/journal', async (req) =>
      journalResponse.parse(await features.journal(userOf(req), parse(journalBody, req.body))),
    );
    app.post('/summaries/doctor', async (req) =>
      doctorSummaryResponse.parse(
        await features.doctorSummary(userOf(req), parse(doctorSummaryBody, req.body)),
      ),
    );

    // Voice
    app.post('/voice/transcribe', async (req) => {
      const { file } = await readUpload(req, 'audio');
      return transcribeResponse.parse(await features.transcribe(file));
    });
    app.post('/voice/query', async (req) =>
      voiceQueryResponse.parse(
        await features.voiceQuery(userOf(req), parse(voiceQueryBody, req.body)),
      ),
    );

    // Sickness history and patterns
    app.get<{ Params: { id: string } }>('/insights/:id', async (req) =>
      insightsResponse.parse(await features.insights(userOf(req), req.params.id)),
    );

    // Generic medicine finder
    app.get('/drugs/search', async (req) =>
      drugSearchResponse.parse(features.searchDrugs(parse(searchQuery, req.query).q)),
    );
    app.get('/drugs/generics', async (req) =>
      genericsResponse.parse(features.generics(parse(genericsQuery, req.query).brand)),
    );

    // Pharmacies: search for everyone; the store's own pages for Pharmacy accounts
    app.get('/pharmacies', async (req) =>
      pharmaciesResponse.parse(await features.nearbyPharmacies(parse(pharmaciesQuery, req.query))),
    );
    app.get('/pharmacies/me', async (req) =>
      myPharmacyResponse.parse(await features.myPharmacy(userOf(req))),
    );
    app.put('/pharmacies/me/profile', async (req) =>
      okResponse.parse(
        await features.updatePharmacyProfile(userOf(req), parse(storeProfile, req.body)),
      ),
    );
    app.put<{ Params: { drugId: string } }>('/pharmacies/me/stock/:drugId', async (req) =>
      okResponse.parse(
        await features.setStock(
          userOf(req),
          req.params.drugId,
          parse(setStockBody, req.body).status,
        ),
      ),
    );

    // Account settings (discreet SMS, SMS reminders on/off)
    app.get('/account/settings', async (req) =>
      accountSettings.parse(await features.getSettings(userOf(req))),
    );
    app.put('/account/settings', async (req) =>
      accountSettings.parse(
        await features.putSettings(userOf(req), parse(settingsPatch, req.body)),
      ),
    );
  };
}
