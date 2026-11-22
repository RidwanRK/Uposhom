import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApplinkClient, type ServiceName } from '@uposhom/applink-client';

const MOCK = fileURLToPath(new URL('../../../scripts/mock-applink.mjs', import.meta.url));

const PATHS: Record<ServiceName, string> = {
  smsSend: '/sms/send',
  subscriptionSend: '/subscription/send',
  subscriptionQueryBase: '/subscription/query-base',
  subscriptionChargingInfo: '/subscription/getSubscriberChargingInfo',
  otpRequest: '/otp/request',
  otpVerify: '/otp/verify',
  caasOtpGeneration: '/caas/direct/debit',
  caasOtpVerify: '/caas/otp/verify',
};

export interface MockApplink {
  stop(): void;
  /** A real client pointed at the mock. `scenario` is the mock's path prefix, e.g. '/fail-E1850'. */
  client(scenario?: string): ReturnType<typeof createApplinkClient>;
  /** Client whose OTP verify answers with a failure but whose OTP request succeeds. */
  clientWithVerifyFailure(code: string): ReturnType<typeof createApplinkClient>;
  badRequests(): Promise<unknown[]>;
}

export async function startMockApplink(port: number): Promise<MockApplink> {
  const base = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(process.execPath, [MOCK, '--port', String(port), '--quiet'], {
    stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    try {
      await fetch(`${base}/__report`);
      break;
    } catch {
      if (i > 50) throw new Error('mock Applink did not start');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const make = (urlFor: (service: ServiceName, path: string) => string) =>
    createApplinkClient({
      applicationId: 'APP_MOCK',
      password: 'mock-not-a-real-password',
      endpoints: Object.fromEntries(
        (Object.entries(PATHS) as [ServiceName, string][]).map(([s, p]) => [s, urlFor(s, p)]),
      ),
      timeoutMs: 2000,
    });

  return {
    stop: () => void proc.kill(),
    client: (scenario = '') => make((_s, p) => `${base}${scenario}${p}`),
    clientWithVerifyFailure: (code) =>
      make((s, p) => (s === 'otpVerify' ? `${base}/fail-${code}${p}` : `${base}${p}`)),
    badRequests: async () => {
      const report = (await (await fetch(`${base}/__report`)).json()) as { verdict: string }[];
      return report.filter((r) => r.verdict === 'BAD');
    },
  };
}
