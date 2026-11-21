import type { z } from 'zod';
import { apiErrorBody, refreshResponse } from '@uposhom/shared';
import { useSession } from '../store/session';
import { API_URL, USE_MOCK } from './config';
import { mockRequest } from './mock/server';

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;
  constructor(status: number, code: string, message?: string, retryAfterSeconds?: number) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Multipart upload of one file (prescription, report or voice recording). */
  upload?: { field: string; file: UploadFile; fields?: Record<string, string> };
  schema?: z.ZodType<T>;
  /** Skip the Authorization header (sign-in calls). */
  anon?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const BASE = '/api/v1';

function buildUrl(path: string, query?: RequestOptions<unknown>['query']): string {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_URL}${BASE}${path}${qs ? `?${qs}` : ''}`;
}

interface RawResult {
  status: number;
  json: unknown;
}

async function send(opts: RequestOptions<unknown>, token: string | null): Promise<RawResult> {
  const method = opts.method ?? 'GET';

  if (USE_MOCK) {
    return mockRequest({
      method,
      path: opts.path,
      query: opts.query ?? {},
      body: opts.body,
      upload: opts.upload,
      token,
    });
  }

  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (token && !opts.anon) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.upload) {
    const form = new FormData();
    // React Native's FormData accepts a { uri, name, type } descriptor.
    form.append(opts.upload.field, opts.upload.file as unknown as Blob);
    for (const [k, v] of Object.entries(opts.upload.fields ?? {})) form.append(k, v);
    body = form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? (opts.upload ? 60000 : 20000),
  );
  try {
    const res = await fetch(buildUrl(opts.path, opts.query), {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    throw new ApiError(0, 'NETWORK', 'network');
  } finally {
    clearTimeout(timer);
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time. Needs no Applink call, so an elderly user is never pushed into a paid OTP. */
async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken, setTokens, clear } = useSession.getState();
    if (!refreshToken) {
      await clear();
      return false;
    }
    try {
      const res = await send(
        { method: 'POST', path: '/auth/refresh', body: { refreshToken }, anon: true },
        null,
      );
      const parsed = refreshResponse.safeParse(res.json);
      if (res.status === 200 && parsed.success) {
        await setTokens(parsed.data.token, parsed.data.refreshToken);
        return true;
      }
      // A rejected refresh token means this session is over. A network error keeps it.
      if (res.status === 401 || res.status === 403) await clear();
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function request<T = unknown>(opts: RequestOptions<T>): Promise<T> {
  const token = useSession.getState().accessToken;
  let res = await send(opts, token);

  if (res.status === 401 && !opts.anon) {
    const ok = await refreshSession();
    if (ok) res = await send(opts, useSession.getState().accessToken);
  }

  if (res.status >= 200 && res.status < 300) {
    if (!opts.schema) return res.json as T;
    const parsed = opts.schema.safeParse(res.json);
    if (!parsed.success) throw new ApiError(res.status, 'BAD_RESPONSE', parsed.error.message);
    return parsed.data;
  }

  const err = apiErrorBody.safeParse(res.json);
  if (err.success) {
    throw new ApiError(
      res.status,
      err.data.error.code,
      err.data.error.message,
      err.data.error.retryAfterSeconds,
    );
  }
  throw new ApiError(res.status, res.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR');
}
