import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type {
  CircleResponse,
  Dose,
  DoseActionBody,
  Profile,
  TodayDosesResponse,
} from '@uposhom/shared';
import { api } from '../api/endpoints';
import { cache } from '../db/cache';
import { flushPendingActions, syncReminders, cancelDoseAlarm } from '../notifications/reminders';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';

export const qk = {
  circle: ['circle'] as const,
  doses: (pid: string | undefined) => ['doses', pid] as const,
  alerts: ['alerts'] as const,
  entitlements: ['entitlements'] as const,
  subscription: ['subscription'] as const,
  reports: ['reports'] as const,
  report: (id: string) => ['report', id] as const,
  insights: (pid: string | undefined) => ['insights', pid] as const,
  settings: ['settings'] as const,
  traces: ['traces'] as const,
  pharmacyMe: ['pharmacyMe'] as const,
};

/** Re-render on a timer, e.g. to flip a dose to "overdue" without a refetch. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Load a value from the SQLite cache once, so the first paint needs no network. */
function useCached<T>(load: () => Promise<T | null>, enabled = true): T | undefined {
  const [value, setValue] = useState<T | undefined>();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void load().then((v) => alive && v && setValue(v));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return value;
}

export function useCircle() {
  const signedIn = useSession((s) => !!s.accessToken);
  const cached = useCached<CircleResponse>(() => cache.loadCircle(), signedIn);
  return useQuery({
    queryKey: qk.circle,
    enabled: signedIn,
    placeholderData: cached,
    queryFn: async () => {
      try {
        const r = await api.circles.get();
        void cache.saveCircle(r);
        return r;
      } catch (e) {
        const c = await cache.loadCircle();
        if (c) return c;
        throw e;
      }
    },
  });
}

/** The profile whose routine is on screen: the stored choice, else the first profile. */
export function useActiveProfile(): {
  profile: Profile | undefined;
  profiles: Profile[];
  setActive: (id: string) => void;
  isLoading: boolean;
} {
  const { data, isLoading } = useCircle();
  const activeId = useSettings((s) => s.activeProfileId);
  const setActive = useSettings((s) => s.setActiveProfileId);
  const profiles = useMemo(() => data?.profiles ?? [], [data]);
  const profile = profiles.find((p) => p.id === activeId) ?? profiles[0];
  return { profile, profiles, setActive, isLoading };
}

export type TodayWithSource = TodayDosesResponse & { fromCache?: boolean };

export function useTodayDoses(profileId: string | undefined) {
  const cached = useCached<TodayDosesResponse>(
    () => (profileId ? cache.loadDoses(profileId) : Promise.resolve(null)),
    !!profileId,
  );
  const { data: circle } = useCircle();
  const names = useMemo(
    () => Object.fromEntries((circle?.profiles ?? []).map((p) => [p.id, p.name])),
    [circle],
  );

  const q = useQuery<TodayWithSource>({
    queryKey: qk.doses(profileId),
    enabled: !!profileId,
    placeholderData: cached ? { ...cached, fromCache: true } : undefined,
    refetchInterval: 60_000,
    queryFn: async () => {
      await flushPendingActions();
      try {
        const r = await api.doses.today(profileId, 2);
        void cache.saveDoses(profileId!, r);
        return r;
      } catch (e) {
        const c = await cache.loadDoses(profileId!);
        if (c) return { ...c, fromCache: true };
        throw e;
      }
    },
  });

  // Keep the device alarms in step with what the server says is coming up.
  useEffect(() => {
    if (q.data && !q.data.fromCache) void syncReminders(q.data.doses, names).catch(() => undefined);
  }, [q.data, names]);

  return q;
}

export function useDoseAction(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dose, body }: { dose: Dose; body: DoseActionBody }) => {
      try {
        return await api.doses.act(dose.id, body);
      } catch (e) {
        // Offline: keep the action and apply it when the phone is back online.
        if (e instanceof Error && 'isNetwork' in e && (e as { isNetwork: boolean }).isNetwork) {
          await cache.enqueueAction(dose.id, body);
          return null;
        }
        throw e;
      }
    },
    onMutate: async ({ dose, body }) => {
      await qc.cancelQueries({ queryKey: qk.doses(profileId) });
      const prev = qc.getQueryData<TodayWithSource>(qk.doses(profileId));
      const status =
        body.action === 'TAKEN' ? 'TAKEN' : body.action === 'SKIP' ? 'SKIPPED' : 'SNOOZED';
      if (prev) {
        qc.setQueryData<TodayWithSource>(qk.doses(profileId), {
          ...prev,
          doses: prev.doses.map((d) =>
            d.id === dose.id
              ? {
                  ...d,
                  status,
                  takenAt: body.action === 'TAKEN' ? new Date().toISOString() : d.takenAt,
                }
              : d,
          ),
        });
      }
      if (body.action !== 'SNOOZE') void cancelDoseAlarm(dose.id);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.doses(profileId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.doses(profileId) });
      void qc.invalidateQueries({ queryKey: qk.circle });
      void qc.invalidateQueries({ queryKey: qk.alerts });
    },
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: qk.alerts,
    queryFn: () => api.alerts.list(),
    refetchInterval: 60_000,
  });
}

export function useEntitlements() {
  return useQuery({ queryKey: qk.entitlements, queryFn: () => api.billing.entitlements() });
}

export function useSubscription(poll = false) {
  return useQuery({
    queryKey: qk.subscription,
    queryFn: () => api.billing.subscriptionStatus(),
    refetchInterval: poll ? 2000 : false,
  });
}

/** Role of the signed-in person on a profile: viewers can look but not act. */
export function canActOn(profile: Profile | undefined): boolean {
  return profile?.myRole !== 'VIEWER';
}
