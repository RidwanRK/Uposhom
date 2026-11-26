import type { FastifyInstance, FastifyReply } from 'fastify';
import type { BillingConfig } from '../billing/config.js';
import { RETENTION } from '../ops/retention.js';

/**
 * Terms of service, privacy policy and support contact, served as public pages so the Applink
 * portal description and the app can link to them (Applink checks for these before approving).
 *
 * Prices, retention periods and the opt-out keyword are filled in from the same configuration the
 * system runs on, so the text cannot drift from what the code does. The wording is a working draft
 * (see docs/legal-review.md for what the team must confirm before publishing).
 */
export interface LegalConfig {
  appName: string;
  supportEmail: string | undefined;
  supportPhone: string | undefined;
  smsKeyword: string;
  billing: BillingConfig;
  /** When this text last changed. Shown on both pages. */
  lastUpdated: string;
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const days = (ms: number): number => Math.round(ms / (24 * 60 * 60 * 1000));

function layout(title: string, body: string, cfg: LegalConfig): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(cfg.appName)}</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b2b28; background: #f7faf9; margin: 0; }
  main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  h1 { color: #0d5c52; font-size: 1.8rem; margin: 1rem 0 .25rem; }
  h2 { color: #0d5c52; font-size: 1.2rem; margin-top: 2rem; }
  .meta { color: #5b6b68; font-size: .9rem; }
  nav a { margin-right: 1rem; color: #0d5c52; }
  ul { padding-left: 1.2rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6eeec; background: #0f1a18; }
    h1, h2, nav a { color: #7fd1c2; }
    .meta { color: #9db0ac; }
  }
</style>
</head>
<body>
<main>
<nav><a href="/legal/terms">Terms of service</a><a href="/legal/privacy">Privacy policy</a><a href="/support">Support</a></nav>
<h1>${esc(title)}</h1>
<p class="meta">${esc(cfg.appName)} · Last updated ${esc(cfg.lastUpdated)}</p>
${body}
</main>
</body>
</html>`;
}

function contact(cfg: LegalConfig): string {
  const parts = [
    cfg.supportEmail
      ? `email <a href="mailto:${esc(cfg.supportEmail)}">${esc(cfg.supportEmail)}</a>`
      : '',
    cfg.supportPhone ? `phone ${esc(cfg.supportPhone)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' or ') : 'the support contact listed in the app';
}

export function termsHtml(cfg: LegalConfig): string {
  const fc = cfg.billing.plans.FAMILY_CIRCLE;
  const summary = cfg.billing.caas.DOCTOR_SUMMARY.amount;
  const scan = cfg.billing.caas.SCAN.amount;
  const explain = cfg.billing.caas.REPORT_EXPLAIN.amount;
  return layout(
    'Terms of service',
    `
<p>These terms govern your use of ${esc(cfg.appName)}, a family medicine organiser that helps you keep track of prescriptions and doses. By creating an account you agree to them.</p>

<h2>1. What the service is, and is not</h2>
<p>${esc(cfg.appName)} organises information you give it and reminds you to take medicines. It does <strong>not</strong> give medical advice, diagnose, or replace your doctor or pharmacist. Explanations in simple Bangla are for understanding only. Always follow your doctor's instructions. In an emergency, call <strong>999</strong>.</p>

<h2>2. Your account</h2>
<p>You sign up with your mobile number and a one-time code. One account belongs to one person. You are responsible for what happens under your account, and for keeping your phone secure. You may add family members only with their agreement; a family member's own number is confirmed with their own code before it is linked.</p>

<h2>3. SMS messages</h2>
<p>Signing up subscribes your number to the service through our telecom partner, Applink (hSenid Mobile) on the Banglalink network. We send reminders and alerts by SMS. Reply with the keyword and a code to record a dose, for example <strong>${esc(cfg.smsKeyword)} 1</strong> (taken), <strong>${esc(cfg.smsKeyword)} 2</strong> (snooze) or <strong>${esc(cfg.smsKeyword)} 3</strong> (skip). Reply <strong>STOP</strong> at any time to stop all messages and end your subscription. Your mobile operator's own terms and charges for messages apply.</p>

<h2>4. Paid features</h2>
<ul>
  <li><strong>Family Circle Premium:</strong> ${esc(fc.amount)} ${esc(fc.currency)} per month, charged to your mobile account, renewing automatically each month. Before you subscribe we show the price, the renewal and these terms, and we record that you accepted them.</li>
  <li><strong>Pay per use:</strong> a doctor summary costs ${esc(summary)} BDT; an extra prescription scan costs ${esc(scan)} BDT and a report explanation ${esc(explain)} BDT, each time. Every payment needs a fresh one-time code that you enter yourself. Nothing is charged without it.</li>
  <li><strong>Cancelling:</strong> cancel in the app (Settings), or reply STOP. A cancelled subscription ends at once and also ends our messages to your number.</li>
  <li><strong>Problems with a charge:</strong> contact support with the date and the amount and we will look into it.</li>
</ul>

<h2>5. Using the service fairly</h2>
<p>Do not misuse the service, attempt to break it, send it other people's data without their agreement, or use it to send unwanted messages. We may suspend an account that does.</p>

<h2>6. Availability and changes</h2>
<p>We work to keep the service running but cannot promise it will always be available. Reminders depend on your phone and network; please do not rely on them as your only safeguard for critical medicines. We may change these terms; the date above shows the latest version, and we will tell you in the app about important changes.</p>

<h2>7. Liability</h2>
<p>To the extent the law allows, we are not liable for loss arising from a missed or late reminder, or from decisions made about your health. Nothing here limits any right you have under the laws of Bangladesh.</p>

<h2>8. Contact</h2>
<p>Questions or complaints: ${contact(cfg)}. See also our <a href="/legal/privacy">privacy policy</a>.</p>`,
    cfg,
  );
}

export function privacyHtml(cfg: LegalConfig): string {
  return layout(
    'Privacy policy',
    `
<p>This explains what ${esc(cfg.appName)} collects, why, who sees it, how long we keep it, and what you can do about it.</p>

<h2>1. What we collect</h2>
<ul>
  <li><strong>Your mobile number</strong>, stored encrypted, and an identifier our telecom partner gives us for your number.</li>
  <li><strong>Your subscription and what you agreed to:</strong> the wording you accepted, the price shown, when, and from which device address, so we can show you consented.</li>
  <li><strong>Message records:</strong> that a reminder was sent and whether it was delivered. We do not keep the text of messages in these records.</li>
  <li><strong>Payments:</strong> a ledger of one-off charges and their outcome.</li>
  <li><strong>The health information you add</strong> (prescriptions, reports, doses and symptom notes) so the service can organise it and remind you. [Detailed handling of this information is described by the app team.]</li>
</ul>

<h2>2. Why we use it</h2>
<p>To run your account, send the reminders you asked for, take the payments you approve, keep the service secure, and meet our obligations to our telecom partner. We rely on your consent, which you give when you sign up and when you subscribe or pay.</p>

<h2>3. Who it is shared with</h2>
<ul>
  <li><strong>Applink (hSenid Mobile) and your mobile operator</strong>, to send one-time codes and SMS and to bill the features you approve.</li>
  <li><strong>Our hosting provider</strong>, who runs the servers that store the data.</li>
  <li><strong>Providers that read your prescription images or generate explanations</strong>, only to provide those features. [To be confirmed by the AI team before publishing.]</li>
</ul>
<p>We do not sell your data and we do not send you advertising.</p>

<h2>4. Your family</h2>
<p>People you add can see the information you share with them in their role (administrator, caregiver or viewer). A family member with their own phone confirms their own number before anything is linked to it.</p>

<h2>5. How long we keep it</h2>
<ul>
  <li>Message delivery records: ${days(RETENTION.smsLogMs)} days.</li>
  <li>One-time-code records: removed ${days(RETENTION.otpAfterExpiryMs)} day after they expire.</li>
  <li>Sign-in sessions: removed ${days(RETENTION.sessionAfterExpiryMs)} days after they end.</li>
  <li>Assistant activity logs (no message text kept beyond a short preview): ${days(RETENTION.agentTracesMs)} days.</li>
  <li>Record-access audit log: ${days(RETENTION.auditLogMs)} days.</li>
  <li>Records of what you agreed to are kept for as long as your account exists, as evidence, and deleted with it.</li>
</ul>

<h2>6. Your choices</h2>
<ul>
  <li><strong>Stop messages and end your subscription:</strong> reply STOP, or use Settings in the app.</li>
  <li><strong>Delete your data:</strong> use "Delete my data" in the app. Your number and the identifier from our telecom partner are deleted or anonymised.</li>
  <li><strong>Ask a question or make a complaint:</strong> ${contact(cfg)}.</li>
</ul>

<h2>7. Security</h2>
<p>Your number is stored encrypted. Connections use HTTPS. We keep personal details such as numbers, codes and message text out of our system logs. No system is perfectly secure, so please tell us at once if you think your account has been used by someone else.</p>

<h2>8. Changes</h2>
<p>If we change this policy we will update the date above and tell you in the app about important changes. See also our <a href="/legal/terms">terms of service</a>.</p>`,
    cfg,
  );
}

export function supportHtml(cfg: LegalConfig): string {
  return layout(
    'Support',
    `
<p>We are happy to help with your account, messages, payments or your data.</p>
<ul>
  ${cfg.supportEmail ? `<li>Email: <a href="mailto:${esc(cfg.supportEmail)}">${esc(cfg.supportEmail)}</a></li>` : ''}
  ${cfg.supportPhone ? `<li>Phone: ${esc(cfg.supportPhone)}</li>` : ''}
</ul>
<p><strong>Stop all messages:</strong> reply <strong>STOP</strong> to any message from us.</p>
<p><strong>In a medical emergency, call 999.</strong> ${esc(cfg.appName)} is not an emergency service.</p>
<p><a href="/legal/terms">Terms of service</a> · <a href="/legal/privacy">Privacy policy</a></p>`,
    cfg,
  );
}

export function legalRoutes(cfg: LegalConfig) {
  return async function register(app: FastifyInstance): Promise<void> {
    const html =
      (render: (c: LegalConfig) => string) => async (_req: unknown, reply: FastifyReply) =>
        reply
          .type('text/html; charset=utf-8')
          .header('cache-control', 'public, max-age=300')
          .header(
            'content-security-policy',
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
          )
          .send(render(cfg));
    app.get('/legal/terms', html(termsHtml));
    app.get('/legal/privacy', html(privacyHtml));
    app.get('/support', html(supportHtml));
  };
}
