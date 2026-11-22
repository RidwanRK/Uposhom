#!/usr/bin/env node
/**
 * One command for the whole backend on your own machine, with a fake Applink:
 *
 *   pnpm dev:local
 *
 * It starts the local Applink mock and the real API pointed at it, so sign-up OTP, SMS, Subscription
 * and pay-per-use charging all work end to end with no Applink credentials. Data is in memory and
 * forgotten on restart.
 *
 *   API        http://localhost:3000            (PORT to change)
 *   Applink    http://127.0.0.1:8090            (a small proxy in front of the mock on 8089)
 *   Sign-up    any 4 to 8 digit code works for every OTP
 *   Payments   after you verify a payment, a "paid in full" charging notification is sent for you
 *              one second later (DEV_AUTO_SETTLE=0 to turn that off and post your own)
 *
 * What the mock cannot do, and what this script adds on top of it:
 *   - the mock's debit answer does not echo your externalTrxId the way the real platform does, so
 *     the proxy fills it in;
 *   - nothing sends the charging notification that settles a payment, so the proxy does.
 * Limitation: the mock answers every OTP verify with the same subscriber id, so use one phone
 * number at a time (a second number signs in as the same subscriber).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = Number(process.env.PORT ?? 3000);
const MOCK_PORT = 8089;
const PROXY_PORT = 8090;
const AUTO_SETTLE = process.env.DEV_AUTO_SETTLE !== '0';

const children = [];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// 1. The Applink mock.
children.push(
  spawn(process.execPath, ['scripts/mock-applink.mjs', '--port', String(MOCK_PORT), '--quiet'], {
    cwd: root,
    stdio: 'inherit',
  }),
);

// 2. A small proxy that makes the mock behave like the real platform for charging.
const debits = new Map(); // requestCorrelator -> { externalTrxId, amount }
const proxy = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let sent = {};
    try {
      sent = JSON.parse(body);
    } catch {
      /* the mock answers E1312 for a body that is not JSON */
    }
    const upstream = await fetch(`http://127.0.0.1:${MOCK_PORT}${req.url}`, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
      body: req.method === 'POST' ? body : undefined,
    });
    let answer = await upstream.text();

    if (req.url?.endsWith('/caas/direct/debit')) {
      // Echo the transaction id, as the real platform does.
      const parsed = JSON.parse(answer);
      parsed.externalTrxId = sent.externalTrxId;
      if (parsed.requestCorrelator) {
        debits.set(parsed.requestCorrelator, {
          externalTrxId: sent.externalTrxId,
          amount: sent.amount,
        });
      }
      answer = JSON.stringify(parsed);
    }

    if (AUTO_SETTLE && req.url?.endsWith('/caas/otp/verify')) {
      const debit = debits.get(sent.referenceNo);
      if (debit) {
        setTimeout(() => {
          void fetch(`http://127.0.0.1:${API_PORT}/api/applink/caas/charging-notification`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              timeStamp: '22-Nov-2026 11:55',
              TotalAmount: debit.amount,
              externalTrxId: debit.externalTrxId,
              balanceDue: '0',
              statusDetail: 'Success',
              currency: 'BDT',
              version: '1.0',
              internalTrxId: 'dev-int-1',
              paidAmount: debit.amount,
              referenceId: 'dev-ref-1',
              statusCode: 'S1000',
            }),
          }).catch(() => undefined);
        }, 1000);
      }
    }
    res.writeHead(upstream.status, { 'content-type': 'application/json;charset=utf-8' });
    res.end(answer);
  });
});
proxy.listen(PROXY_PORT, '127.0.0.1');

// 3. The API, pointed at the proxy. Nothing here is a real credential.
const p = (path) => `http://127.0.0.1:${PROXY_PORT}${path}`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  APPLINK_APP_ID: 'APP_MOCK',
  APPLINK_PASSWORD: 'mock-not-a-real-password',
  APPLINK_SMS_SEND_URL: p('/sms/send'),
  APPLINK_SUBSCRIPTION_SEND_URL: p('/subscription/send'),
  APPLINK_SUBSCRIPTION_QUERY_BASE_URL: p('/subscription/query-base'),
  APPLINK_SUBSCRIPTION_CHARGING_INFO_URL: p('/subscription/getSubscriberChargingInfo'),
  APPLINK_OTP_REQUEST_URL: p('/otp/request'),
  APPLINK_OTP_VERIFY_URL: p('/otp/verify'),
  APPLINK_CAAS_DEBIT_URL: p('/caas/direct/debit'),
  APPLINK_CAAS_OTP_VERIFY_URL: p('/caas/otp/verify'),
  STORE_DRIVER: 'memory',
  QUEUE_DRIVER: 'memory',
};
children.push(
  spawn('pnpm --filter @uposhom/api dev', { cwd: root, env, stdio: 'inherit', shell: true }),
);

setTimeout(() => {
  console.log(`
  Uposhom local backend
    API       http://localhost:${API_PORT}   (try /healthz, /legal/terms)
    Applink   fake, via http://127.0.0.1:${PROXY_PORT}
    Any 4 to 8 digit code passes OTP. Payments settle by themselves${AUTO_SETTLE ? '' : ' (auto-settle is OFF)'}.
    Ctrl+C stops everything.
`);
}, 1500);
