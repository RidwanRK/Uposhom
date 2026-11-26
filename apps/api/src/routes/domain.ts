import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  alertsResponse,
  tracesResponse,
  circleResponse,
  okResponse,
  changeRoleBody,
  inviteBody,
  linkRequestBody,
  linkVerifyBody,
  confirmBody,
  confirmResponse,
  createProfileBody,
  doseActionBody,
  doseActionResponse,
  profile,
  todayDosesResponse,
  updateProfileBody,
} from '@uposhom/shared';
import { DomainError, useDomainErrors } from '../domain/errors.js';
import type { DomainService } from '../domain/service.js';

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError('INVALID_INPUT', 400);
  return r.data;
};

const secondaryBody = z.object({ linkId: z.string().min(1) });
const appointmentBody = z.object({
  title: z.string().min(1).max(100),
  /** ISO 8601 with an offset, e.g. 2026-11-28T10:30:00+06:00 */
  dueAt: z.string().min(10).max(40),
});
const tracesQuery = z.object({ limit: z.coerce.number().int().optional() });
const deviceBody = z.object({
  expoPushToken: z.string().min(1).max(200),
  platform: z.string().max(20).optional(),
});

const todayQuery = z.object({
  profileId: z.string().min(1).optional(),
  days: z.coerce.number().int().optional(),
});

const userOf = (req: FastifyRequest): string => {
  const id = req.auth?.userId;
  if (!id) throw new DomainError('FORBIDDEN', 403);
  return id;
};

/**
 * Workstream B's app routes under /api/v1 (Master Plan 16.3): the family circle and profiles,
 * the prescription confirm gate, and the dose timeline and actions. Every route needs a signed-in
 * user and is scoped by their links to profiles. Responses are checked against the shared zod
 * contracts on the way out, so the app and the server cannot drift apart silently.
 */
export function domainRoutes(domain: DomainService) {
  return async function register(app: FastifyInstance): Promise<void> {
    useDomainErrors(app);
    app.addHook('preHandler', app.authenticate);

    app.get('/circles', async (req) => circleResponse.parse(await domain.getCircle(userOf(req))));

    app.post('/profiles', async (req, reply) => {
      const body = parse(createProfileBody, req.body);
      const created = await domain.createProfile(userOf(req), body);
      return reply.code(201).send(profile.parse(created));
    });

    app.put<{ Params: { id: string } }>('/profiles/:id', async (req) => {
      const body = parse(updateProfileBody, req.body);
      return profile.parse(await domain.updateProfile(userOf(req), req.params.id, body));
    });

    // Family Link: an OTP to a dependent's own phone binds that number to their profile.
    app.post<{ Params: { id: string } }>('/profiles/:id/link/request', async (req) => {
      const body = parse(linkRequestBody, req.body);
      return okResponse.parse(
        await domain.requestFamilyLink(userOf(req), req.params.id, {
          msisdn: body.msisdn,
          ip: req.ip,
        }),
      );
    });
    app.post<{ Params: { id: string } }>('/profiles/:id/link/verify', async (req) => {
      const body = parse(linkVerifyBody, req.body);
      return okResponse.parse(await domain.verifyFamilyLink(userOf(req), req.params.id, body));
    });

    // Caregivers and viewers. An invite becomes a link when that person signs in.
    app.post('/links', async (req) => {
      const body = parse(inviteBody, req.body);
      return okResponse.parse(await domain.invite(userOf(req), body));
    });

    app.put<{ Params: { id: string } }>('/links/:id', async (req) => {
      const body = parse(changeRoleBody, req.body);
      return okResponse.parse(await domain.changeRole(userOf(req), req.params.id, body.role));
    });

    // Removing someone re-proves the phone first (A's step-up OTP).
    app.delete<{ Params: { id: string } }>(
      '/links/:id',
      { preHandler: app.requireStepUp },
      async (req) => okResponse.parse(await domain.removeLink(userOf(req), req.params.id)),
    );

    app.put<{ Params: { id: string } }>('/profiles/:id/secondary-caregiver', async (req) => {
      const body = parse(secondaryBody, req.body);
      return okResponse.parse(await domain.setSecondary(userOf(req), req.params.id, body.linkId));
    });

    app.post<{ Params: { id: string } }>('/prescriptions/:id/confirm', async (req, reply) => {
      const body = parse(confirmBody, req.body);
      const result = await domain.confirm(userOf(req), req.params.id, body);
      return reply.code(201).send(confirmResponse.parse(result));
    });

    app.get('/doses/today', async (req) => {
      const q = parse(todayQuery, req.query);
      return todayDosesResponse.parse(
        await domain.today(userOf(req), {
          ...(q.profileId ? { profileId: q.profileId } : {}),
          ...(q.days !== undefined ? { days: q.days } : {}),
        }),
      );
    });

    app.post<{ Params: { id: string } }>('/doses/:id/action', async (req) => {
      const body = parse(doseActionBody, req.body);
      // Notification buttons send this header so the log says where the tap came from.
      const channel = req.headers['x-action-source'] === 'notification' ? 'NOTIFICATION' : 'APP';
      return doseActionResponse.parse(await domain.act(userOf(req), req.params.id, body, channel));
    });

    // A caregiver saw the missed-dose alert: no secondary caregiver alert follows.
    app.post<{ Params: { id: string } }>('/doses/:id/acknowledge', async (req) =>
      okResponse.parse(await domain.acknowledge(userOf(req), req.params.id)),
    );

    app.get('/alerts', async (req) => alertsResponse.parse(await domain.alerts(userOf(req))));

    // The app registers its Expo push token after sign-in, for caregiver alerts.
    app.post('/devices', async (req) => {
      const body = parse(deviceBody, req.body);
      return okResponse.parse(await domain.registerDevice(userOf(req), body));
    });

    // Follow-up appointments, reminded the day before. (Not in packages/shared yet: the shapes
    // are appointmentBody below and { id, title, dueAt, reminderState } back.)
    app.post<{ Params: { id: string } }>('/profiles/:id/appointments', async (req, reply) => {
      const body = parse(appointmentBody, req.body);
      return reply.code(201).send(await domain.addAppointment(userOf(req), req.params.id, body));
    });
    app.get<{ Params: { id: string } }>('/profiles/:id/appointments', async (req) =>
      domain.listAppointments(userOf(req), req.params.id),
    );

    // Admin-only agent-trace viewer (the admin flag is checked on the account, and audited).
    app.get('/admin/traces', async (req) => {
      const q = parse(tracesQuery, req.query);
      return tracesResponse.parse(await domain.listTraces(userOf(req), q.limit));
    });
  };
}
