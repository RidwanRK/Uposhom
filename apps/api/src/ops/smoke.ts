import { ApplinkError, ApplinkTransportError, createApplinkClient } from '@uposhom/applink-client';

/**
 * Applink smoke test: the first thing to run when credentials arrive. Base Size needs no
 * subscriber, costs nothing and touches no one, so it proves in one call that the credentials,
 * the provisioning and this machine's egress IP all work. Every failure is turned into the next
 * step to take, because the raw status codes do not say what to do.
 */
export interface SmokeResult {
  ok: boolean;
  /** Process exit code. */
  code: number;
  lines: string[];
}

const NEXT_STEP: Record<string, string> = {
  E1303:
    'The IP this request came from is not allow-listed. On THIS machine run `curl -4 https://api.ipify.org`, ' +
    "then add that address to the application's allowed host addresses in the Applink portal " +
    '(production is the VM, not your laptop).',
  E1313:
    'Authentication failed. Check APPLINK_APP_ID and APPLINK_PASSWORD (no stray spaces or quotes), ' +
    'and that the application is active in the portal.',
  E1309:
    'The Subscription API is not enabled for this application. That is a portal fix, not a code fix: ' +
    'ask Applink support to provision it.',
  E1315: 'Applink cannot find the service. Check the endpoint URL and that the service is active.',
  E1312: 'Applink rejected the request as invalid. This is a bug in our request: report it.',
};

export async function runSmoke(
  env: Record<string, string | undefined>,
  opts: { fetch?: typeof fetch } = {},
): Promise<SmokeResult> {
  const lines: string[] = [];
  const say = (l: string) => lines.push(l);

  const applicationId = env['APPLINK_APP_ID']?.trim();
  const password = env['APPLINK_PASSWORD']?.trim();
  const url = env['APPLINK_SUBSCRIPTION_QUERY_BASE_URL']?.trim();

  const missing = [
    !applicationId && 'APPLINK_APP_ID',
    !password && 'APPLINK_PASSWORD',
    !url && 'APPLINK_SUBSCRIPTION_QUERY_BASE_URL',
  ].filter(Boolean);
  if (missing.length || !applicationId || !password || !url) {
    say(`Missing: ${missing.join(', ')}.`);
    say(
      'Set them (the URL is https://api.applink.com.bd/subscription/query-base for the real platform,',
    );
    say('or http://127.0.0.1:8089/subscription/query-base for the local mock) and run again.');
    return { ok: false, code: 2, lines };
  }

  const client = createApplinkClient({
    applicationId,
    password,
    endpoints: { subscriptionQueryBase: url },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  say(`Calling Base Size at ${new URL(url).origin} as ${applicationId} ...`);
  try {
    const res = await client.queryBase();
    say(`OK. Credentials, provisioning and egress IP all work. Subscriber base size: ${res.size}.`);
    return { ok: true, code: 0, lines };
  } catch (err) {
    if (err instanceof ApplinkError) {
      say(`FAILED with ${err.statusCode}: ${err.statusDetail}`);
      say(
        NEXT_STEP[err.statusCode] ??
          (err.retryable
            ? 'Platform-side and temporary: wait a minute and run again.'
            : 'See references/08-status-codes.md in the Applink skill.'),
      );
    } else if (err instanceof ApplinkTransportError) {
      say(`FAILED to reach Applink: ${err.message}`);
      say('Check the URL, that this machine has outbound HTTPS, and DNS.');
    } else {
      say('FAILED unexpectedly.');
    }
    return { ok: false, code: 1, lines };
  }
}
