import { Platform } from 'react-native';
import type { CircleResponse, DoseActionBody, TodayDosesResponse } from '@uposhom/shared';

/**
 * expo-sqlite offline cache. The server stays the single source of truth: this is a read cache of the
 * schedule and profiles so Home paints instantly with no network, plus a tiny queue of dose actions
 * taken while offline. The app never recomputes doses.
 */

export interface PendingAction {
  id: number;
  doseId: string;
  body: DoseActionBody;
  createdAt: number;
}

interface Backend {
  getJson: (key: string) => Promise<string | null>;
  setJson: (key: string, value: string) => Promise<void>;
  enqueue: (doseId: string, body: DoseActionBody) => Promise<void>;
  pending: () => Promise<PendingAction[]>;
  dropPending: (id: number) => Promise<void>;
  clear: () => Promise<void>;
}

// ---- Web preview: in memory only (expo-sqlite has no web build here).
function memoryBackend(): Backend {
  const kv = new Map<string, string>();
  let queue: PendingAction[] = [];
  let seq = 1;
  return {
    getJson: async (k) => kv.get(k) ?? null,
    setJson: async (k, v) => void kv.set(k, v),
    enqueue: async (doseId, body) =>
      void queue.push({ id: seq++, doseId, body, createdAt: Date.now() }),
    pending: async () => [...queue],
    dropPending: async (id) => void (queue = queue.filter((q) => q.id !== id)),
    clear: async () => {
      kv.clear();
      queue = [];
    },
  };
}

// ---- Android: expo-sqlite
async function sqliteBackend(): Promise<Backend> {
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync('uposhom.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, saved_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dose_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return {
    getJson: async (k) =>
      (await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', k))?.value ??
      null,
    setJson: async (k, v) => {
      await db.runAsync(
        'INSERT OR REPLACE INTO kv (key, value, saved_at) VALUES (?, ?, ?)',
        k,
        v,
        Date.now(),
      );
    },
    enqueue: async (doseId, body) => {
      await db.runAsync(
        'INSERT INTO pending_actions (dose_id, body, created_at) VALUES (?, ?, ?)',
        doseId,
        JSON.stringify(body),
        Date.now(),
      );
    },
    pending: async () =>
      (
        await db.getAllAsync<{ id: number; dose_id: string; body: string; created_at: number }>(
          'SELECT * FROM pending_actions ORDER BY id',
        )
      ).map((r) => ({
        id: r.id,
        doseId: r.dose_id,
        body: JSON.parse(r.body) as DoseActionBody,
        createdAt: r.created_at,
      })),
    dropPending: async (id) => {
      await db.runAsync('DELETE FROM pending_actions WHERE id = ?', id);
    },
    clear: async () => {
      await db.execAsync('DELETE FROM kv; DELETE FROM pending_actions;');
    },
  };
}

let backendPromise: Promise<Backend> | null = null;
function backend(): Promise<Backend> {
  backendPromise ??=
    Platform.OS === 'web'
      ? Promise.resolve(memoryBackend())
      : sqliteBackend().catch(() => memoryBackend());
  return backendPromise;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await (await backend()).getJson(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await (await backend()).setJson(key, JSON.stringify(value));
  } catch {
    // the cache is best effort; never block the UI on it
  }
}

export const cache = {
  loadDoses: (profileId: string) => readJson<TodayDosesResponse>(`doses:${profileId}`),
  saveDoses: (profileId: string, v: TodayDosesResponse) => writeJson(`doses:${profileId}`, v),
  loadCircle: () => readJson<CircleResponse>('circle'),
  saveCircle: (v: CircleResponse) => writeJson('circle', v),
  enqueueAction: async (doseId: string, body: DoseActionBody) => {
    try {
      await (await backend()).enqueue(doseId, body);
    } catch {
      // ignore
    }
  },
  pendingActions: async (): Promise<PendingAction[]> => {
    try {
      return await (await backend()).pending();
    } catch {
      return [];
    }
  },
  dropPending: async (id: number) => {
    try {
      await (await backend()).dropPending(id);
    } catch {
      // ignore
    }
  },
  clear: async () => {
    try {
      await (await backend()).clear();
    } catch {
      // ignore
    }
  },
};
