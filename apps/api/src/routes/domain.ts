import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  circleResponse,
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
  };
}
