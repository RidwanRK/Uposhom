import { describe, expect, it, vi } from 'vitest';
import { createMemoryDomainStore } from '../src/domain/memory.js';
import { RETENTION } from '../src/ops/retention.js';
import { OTHER, SUB, ok, settle } from './platform.js';
import { domainHarness } from './domain-harness.js';

/** The dependent's own phone, and the opaque id Applink returns for it on verify. */
const DEP_MSISDN = '01811111111';
const DEP_SUB = 'tel:8801811111111';

const otpFakes = (subscriberId = DEP_SUB) => ({
  requestOtp: async () => ok({ referenceNo: 'ref-1' }),
  verifyOtp: async () => ok({ subscriberId, subscriptionStatus: 'REGISTERED' }),
});

async function setup(opts: { subscriberId?: string } = {}) {
  const store = createMemoryDomainStore();
  const h = await domainHarness({ store, applink: otpFakes(opts.subscriberId) });
  const admin = await h.addUser(SUB);
  vi.spyOn(h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
  const self = (await h.api(admin, 'GET', '/circles')).json().profiles[0];
  const dep = (
    await h.api(admin, 'POST', '/profiles', { name: 'Abba', relationship: 'father', age: 72 })
  ).json();
  const request = (profileId: string, msisdn = DEP_MSISDN) =>
    h.api(admin, 'POST', `/profiles/${profileId}/link/request`, { msisdn });
  const verify = (profileId: string, otp = '12345', msisdn = DEP_MSISDN) =>
    h.api(admin, 'POST', `/profiles/${profileId}/link/verify`, { msisdn, otp });
  return { h, store, admin, self, dep, request, verify };
}

const mo = (message: string, sourceAddress: string, requestId: string) => ({
  version: '1.0',
  applicationId: 'APP_1',
  sourceAddress,
  message,
  requestId,
  encoding: '0',
});

describe('Family Link on the server', () => {
  it('sends the code to the dependent, records their consent, and binds the number on verify', async () => {
    const t = await setup();
    const req = await t.request(t.dep.id);
    expect(req.statusCode).toBe(200);
    expect(req.json()).toEqual({ success: true });
    expect(t.h.applink.requestOtp).toHaveBeenCalledWith({ subscriberId: '8801811111111' });
    expect(await t.h.stores.consents.hasKind(t.admin.id, 'FAMILY_LINK_OTP_V1')).toBe(true);

    const ver = await t.verify(t.dep.id);
    expect(ver.statusCode).toBe(200);
    const circle = (await t.h.api(t.admin, 'GET', '/circles')).json();
    const linked = circle.profiles.find((p: { id: string }) => p.id === t.dep.id);
    expect(linked.phoneLinked).toBe(true);
    // The opaque id never reaches the app.
    expect(JSON.stringify(circle)).not.toContain('8801811111111');
    expect((await t.store.profiles.findBySubscriberId(DEP_SUB)).map((p) => p.id)).toEqual([
      t.dep.id,
    ]);
    expect((await t.store.audit.listForProfile(t.dep.id)).map((a) => a.action)).toEqual([
      'FAMILY_LINK_VERIFIED',
    ]);
    await t.h.app.close();
  });

  it('a code asked for one profile cannot be spent on another', async () => {
    const t = await setup();
    const other = (
      await t.h.api(t.admin, 'POST', '/profiles', { name: 'Amma', relationship: 'mother' })
    ).json();
    await t.request(t.dep.id);
    const wrong = await t.verify(other.id);
    expect(wrong.statusCode).toBe(410);
    expect(wrong.json().error.code).toBe('OTP_EXPIRED');
    expect(await t.store.profiles.findBySubscriberId(DEP_SUB)).toEqual([]);
    await t.h.app.close();
  });

  it('refuses the admin’s own profile, a number with an account, and a stranger', async () => {
    const t = await setup();
    const own = await t.request(t.self.id);
    expect(own.statusCode).toBe(409);
    expect(own.json().error.code).toBe('OWN_PROFILE');

    await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    const hasAccount = await t.request(t.dep.id, '01711111111');
    expect(hasAccount.statusCode).toBe(409);
    expect(hasAccount.json().error).toEqual({ code: 'ALREADY_LINKED', message: 'HAS_ACCOUNT' });

    const stranger = await t.h.addUser('tel:8801922222222', { msisdn: '8801922222222' });
    expect(
      (
        await t.h.api(stranger, 'POST', `/profiles/${t.dep.id}/link/request`, {
          msisdn: DEP_MSISDN,
        })
      ).statusCode,
    ).toBe(404);
    expect(t.h.applink.requestOtp).not.toHaveBeenCalled();
    await t.h.app.close();
  });

  it('one number, one profile: a subscriber id already bound elsewhere is refused', async () => {
    const t = await setup();
    const other = (
      await t.h.api(t.admin, 'POST', '/profiles', { name: 'Amma', relationship: 'mother' })
    ).json();
    await t.request(t.dep.id);
    expect((await t.verify(t.dep.id)).statusCode).toBe(200);
    await t.request(other.id);
    const again = await t.verify(other.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({ code: 'ALREADY_LINKED', message: 'NUMBER_IN_USE' });
    await t.h.app.close();
  });

  it('the dependent’s own phone can ask a question by SMS, and their STOP is recorded on the profile', async () => {
    const t = await setup();
    await t.request(t.dep.id);
    await t.verify(t.dep.id);

    await t.h.callback('sms/receive', mo('UPOSHOM আমার পরের ওষুধ কখন?', DEP_SUB, 'mo-1'));
    await settle(t.h);
    const calls = t.h.applink.sendSms.mock.calls as unknown as Array<[string[], string]>;
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).not.toContain('Reply UPOSHOM'); // an answer, not the usage line
    expect((await t.store.traces.list(5)).map((tr) => tr.channel)).toContain('SMS');

    await t.h.callback('sms/receive', mo('STOP', DEP_SUB, 'mo-2'));
    await settle(t.h);
    expect(await t.h.stores.optOuts.suppressionFor(DEP_SUB)).toBe('STOP');
    expect((await t.store.audit.listForProfile(t.dep.id)).map((a) => a.action)).toContain(
      'SMS_OPT_OUT',
    );
    await t.h.app.close();
  });
});

describe('SMS Q&A caps', () => {
  it('answers at most ten questions per number per day', async () => {
    const t = await setup();
    for (let i = 0; i < 12; i++) {
      await t.h.callback('sms/receive', mo('আমার পরের ওষুধ কখন?', SUB, `q-${i}`));
    }
    await settle(t.h);
    expect(t.h.applink.sendSms).toHaveBeenCalledTimes(10);
    await t.h.app.close();
  });
});

describe('admins from ADMIN_MSISDNS', () => {
  it('a listed number gets the admin flag at OTP sign-in and can read the traces', async () => {
    const h = await domainHarness({
      applink: {
        requestOtp: async () => ok({ referenceNo: 'ref-1' }),
        verifyOtp: async () => ok({ subscriberId: SUB, subscriptionStatus: 'REGISTERED' }),
      },
      config: { ADMIN_MSISDNS: ['8801959979376'] },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { msisdn: '01959979376' },
    });
    const ver = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { msisdn: '01959979376', otp: '12345' },
    });
    expect(ver.json().user.isAdmin).toBe(true);
    const traces = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/traces',
      headers: { authorization: `Bearer ${ver.json().token}` },
    });
    expect(traces.statusCode).toBe(200);
    await h.app.close();
  });

  it('an unlisted number does not, and loses a flag it had', async () => {
    const h = await domainHarness({
      applink: {
        requestOtp: async () => ok({ referenceNo: 'ref-1' }),
        verifyOtp: async () => ok({ subscriberId: SUB, subscriptionStatus: 'REGISTERED' }),
      },
      config: { ADMIN_MSISDNS: ['8801700000000'] },
    });
    const user = await h.addUser(SUB);
    await h.stores.users.setAdmin(user.id, true);
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { msisdn: '01959979376' },
    });
    const ver = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { msisdn: '01959979376', otp: '12345' },
    });
    expect(ver.json().user.isAdmin).toBeUndefined();
    expect((await h.stores.users.findById(user.id))?.isAdmin).toBe(false);
    await h.app.close();
  });
});

describe('domain retention', () => {
  it('purges agent traces after 30 days and the audit log after a year', async () => {
    const store = createMemoryDomainStore();
    const h = await domainHarness({ store });
    const now = h.clock.now.getTime();
    const at = (ms: number) => new Date(now - ms);
    const trace = (id: string, createdAt: Date) => ({
      id,
      userId: null,
      profileId: null,
      channel: 'SMS',
      rootAgent: 'TriageAgent',
      inputPreview: null,
      handoffs: [],
      toolCalls: [],
      durationMs: 1,
      createdAt,
    });
    await store.traces.record(trace('old', at(RETENTION.agentTracesMs + 1000)));
    await store.traces.record(trace('new', at(1000)));
    const audit = (subjectId: string, when: Date) => ({
      actorUserId: null,
      action: 'READ',
      subjectType: 'reports',
      subjectId,
      profileId: 'p1',
      detail: null,
      at: when,
    });
    await store.audit.record(audit('old', at(RETENTION.auditLogMs + 1000)));
    await store.audit.record(audit('new', at(RETENTION.agentTracesMs + 1000)));

    expect(await h.app.purgeDomainData()).toEqual({ agentTraces: 1, auditLog: 1 });
    expect((await store.traces.list(10)).map((t) => t.id)).toEqual(['new']);
    expect((await store.audit.listForProfile('p1')).map((a) => a.subjectId)).toEqual(['new']);
    await h.app.close();
  });
});
