import { describe, expect, it, vi } from 'vitest';
import { circleResponse } from '@uposhom/shared';
import { createTokenService } from '../src/auth/tokens.js';
import type { UserRecord } from '../src/stores/types.js';
import { harness, settle, OTHER, SUB } from './platform.js';

const CARER_MSISDN = '8801711111111';

async function setup() {
  const h = await harness({ realDomain: true });
  const admin = await h.addUser(SUB);
  const self = (await h.api(admin, 'GET', '/circles')).json().profiles[0];
  const invite = (body: object, as: UserRecord = admin) => h.api(as, 'POST', '/links', body);
  const circleOf = async (u: UserRecord) =>
    circleResponse.parse((await h.api(u, 'GET', '/circles')).json());
  const linksOn = async (u: UserRecord, profileId: string) =>
    (await circleOf(u)).profiles.find((p) => p.id === profileId)?.links ?? [];
  const tokens = createTokenService('x'.repeat(40));
  const del = async (u: UserRecord, linkId: string, stepUp = true) =>
    h.app.inject({
      method: 'DELETE',
      url: `/api/v1/links/${linkId}`,
      headers: {
        ...(await h.bearer(u)),
        ...(stepUp ? { 'x-step-up-token': await tokens.signStepUp(u.id) } : {}),
      },
    });
  return { h, admin, self, invite, circleOf, linksOn, del };
}

describe('invites', () => {
  it('an invited person is linked when they sign in, with the role they were given', async () => {
    const t = await setup();
    const res = await t.invite({ profileId: t.self.id, msisdn: '01711111111', role: 'CAREGIVER' });
    expect(res.json()).toEqual({ success: true });
    // Not linked until they sign in.
    expect((await t.linksOn(t.admin, t.self.id)).map((l) => l.role)).toEqual(['ADMIN']);

    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    const theirs = await t.circleOf(carer);
    const shared = theirs.profiles.find((p) => p.id === t.self.id);
    expect(shared).toMatchObject({ myRole: 'CAREGIVER' });
    expect(
      theirs.profiles.find((p) => p.relationship === 'SELF' && p.id !== t.self.id),
    ).toBeTruthy();

    const links = await t.linksOn(t.admin, t.self.id);
    expect(links.map((l) => [l.role, l.name, l.isSecondaryCaregiver])).toEqual([
      ['ADMIN', '019****9376', false],
      ['CAREGIVER', '017****1111', false],
    ]);
    await t.h.app.close();
  });

  it('shows the person’s own profile name once they have set one', async () => {
    const t = await setup();
    await t.invite({ profileId: t.self.id, msisdn: CARER_MSISDN, role: 'VIEWER' });
    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    const own = (await t.circleOf(carer)).profiles.find((p) => p.myRole === 'ADMIN')!;
    await t.h.api(carer, 'PUT', `/profiles/${own.id}`, { name: 'Karim' });
    expect((await t.linksOn(t.admin, t.self.id)).map((l) => l.name)).toEqual([
      '019****9376',
      'Karim',
    ]);
    await t.h.app.close();
  });

  it('accepts Bangla digits and +880 forms, and a repeated invite links once', async () => {
    const t = await setup();
    await t.invite({ profileId: t.self.id, msisdn: '০১৭১১১১১১১১', role: 'CAREGIVER' });
    await t.invite({ profileId: t.self.id, msisdn: '+8801711111111', role: 'CAREGIVER' });
    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    await t.circleOf(carer);
    await t.circleOf(carer);
    expect(await t.linksOn(t.admin, t.self.id)).toHaveLength(2);
    await t.h.app.close();
  });

  it('refuses a bad number, the inviter’s own number, and someone already linked', async () => {
    const t = await setup();
    const bad = await t.invite({ profileId: t.self.id, msisdn: '12345', role: 'CAREGIVER' });
    expect(bad.json().error).toEqual({ code: 'INVALID_INPUT', message: 'MSISDN' });
    const self = await t.invite({ profileId: t.self.id, msisdn: '01959979376', role: 'CAREGIVER' });
    expect(self.json().error).toEqual({ code: 'INVALID_INPUT', message: 'SELF' });

    await t.invite({ profileId: t.self.id, msisdn: CARER_MSISDN, role: 'CAREGIVER' });
    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    await t.circleOf(carer);
    const again = await t.invite({ profileId: t.self.id, msisdn: CARER_MSISDN, role: 'VIEWER' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_LINKED');
    await t.h.app.close();
  });

  it('only an admin of the profile can invite', async () => {
    const t = await setup();
    await t.invite({ profileId: t.self.id, msisdn: CARER_MSISDN, role: 'CAREGIVER' });
    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    await t.circleOf(carer);
    const byCarer = await t.invite(
      { profileId: t.self.id, msisdn: '01722222222', role: 'VIEWER' },
      carer,
    );
    expect(byCarer.statusCode).toBe(403);
    const stranger = await t.h.addUser('tel:8801733333333', { msisdn: '8801733333333' });
    const byStranger = await t.invite(
      { profileId: t.self.id, msisdn: '01722222222', role: 'VIEWER' },
      stranger,
    );
    expect(byStranger.statusCode).toBe(404);
    await t.h.app.close();
  });

  it('an invite expires after a week', async () => {
    const t = await setup();
    await t.invite({ profileId: t.self.id, msisdn: CARER_MSISDN, role: 'CAREGIVER' });
    t.h.clock.now = new Date(t.h.clock.now.getTime() + 8 * 86_400_000);
    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    expect((await t.circleOf(carer)).profiles.map((p) => p.id)).not.toContain(t.self.id);
    await t.h.app.close();
  });

  it('caps a profile at ten people, invites included', async () => {
    const t = await setup();
    for (let i = 0; i < 9; i++) {
      const res = await t.invite({
        profileId: t.self.id,
        msisdn: `0171000000${i}`,
        role: 'VIEWER',
      });
      expect(res.statusCode).toBe(200);
    }
    const tenth = await t.invite({ profileId: t.self.id, msisdn: '01710000009', role: 'VIEWER' });
    expect(tenth.json().error.code).toBe('LIMIT_REACHED');
    await t.h.app.close();
  });
});

describe('roles, removal and the secondary caregiver', () => {
  async function withCarer() {
    const t = await setup();
    await t.invite({ profileId: t.self.id, msisdn: CARER_MSISDN, role: 'CAREGIVER' });
    const carer = await t.h.addUser(OTHER, { msisdn: CARER_MSISDN });
    await t.circleOf(carer);
    const [adminLink, carerLink] = await t.linksOn(t.admin, t.self.id);
    return { ...t, carer, adminLink: adminLink!, carerLink: carerLink! };
  }

  it('an admin changes a role; a viewer can no longer act on doses', async () => {
    const t = await withCarer();
    const res = await t.h.api(t.admin, 'PUT', `/links/${t.carerLink.id}`, { role: 'VIEWER' });
    expect(res.json()).toEqual({ success: true });
    expect((await t.circleOf(t.carer)).profiles.find((p) => p.id === t.self.id)?.myRole).toBe(
      'VIEWER',
    );
    const asViewer = await t.h.api(t.carer, 'PUT', `/profiles/${t.self.id}`, { name: 'x' });
    expect(asViewer.statusCode).toBe(403);
    await t.h.app.close();
  });

  it('the profile’s own person cannot be demoted or removed, and a caregiver cannot change roles', async () => {
    const t = await withCarer();
    const demote = await t.h.api(t.admin, 'PUT', `/links/${t.adminLink.id}`, { role: 'VIEWER' });
    expect(demote.json().error.code).toBe('OWN_PROFILE');
    expect((await t.del(t.admin, t.adminLink.id)).json().error.code).toBe('OWN_PROFILE');
    const byCarer = await t.h.api(t.carer, 'PUT', `/links/${t.carerLink.id}`, { role: 'ADMIN' });
    expect(byCarer.statusCode).toBe(403);
    await t.h.app.close();
  });

  it('a dependent profile keeps at least one admin', async () => {
    const t = await withCarer();
    vi.spyOn(t.h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
    const dep = (
      await t.h.api(t.admin, 'POST', '/profiles', { name: 'Abba', relationship: 'FATHER' })
    ).json();
    const [only] = await t.linksOn(t.admin, dep.id);
    const res = await t.h.api(t.admin, 'PUT', `/links/${only!.id}`, { role: 'CAREGIVER' });
    expect(res.json().error.code).toBe('LAST_ADMIN');
    expect((await t.del(t.admin, only!.id)).json().error.code).toBe('LAST_ADMIN');
    await t.h.app.close();
  });

  it('removing someone needs a step-up OTP; anyone may leave', async () => {
    const t = await withCarer();
    const noStepUp = await t.del(t.admin, t.carerLink.id, false);
    expect(noStepUp.statusCode).toBe(403);
    expect(noStepUp.json().error.code).toBe('STEP_UP_REQUIRED');
    expect((await t.del(t.carer, t.carerLink.id)).json()).toEqual({ success: true });
    expect((await t.circleOf(t.carer)).profiles.map((p) => p.id)).not.toContain(t.self.id);
    expect((await t.del(t.admin, 'lnk_none')).statusCode).toBe(404);
    await t.h.app.close();
  });

  it('sets the secondary caregiver, only to a caregiver who is not the patient', async () => {
    const t = await withCarer();
    const url = `/profiles/${t.self.id}/secondary-caregiver`;
    expect((await t.h.api(t.admin, 'PUT', url, { linkId: t.carerLink.id })).json()).toEqual({
      success: true,
    });
    expect((await t.linksOn(t.admin, t.self.id)).map((l) => l.isSecondaryCaregiver)).toEqual([
      false,
      true,
    ]);
    const own = await t.h.api(t.admin, 'PUT', url, { linkId: t.adminLink.id });
    expect(own.json().error).toEqual({ code: 'INVALID_INPUT', message: 'NOT_A_CAREGIVER' });
    expect((await t.h.api(t.admin, 'PUT', url, { linkId: 'lnk_none' })).statusCode).toBe(404);

    // Made a viewer: no longer the secondary caregiver.
    await t.h.api(t.admin, 'PUT', `/links/${t.carerLink.id}`, { role: 'VIEWER' });
    expect((await t.linksOn(t.admin, t.self.id)).map((l) => l.isSecondaryCaregiver)).toEqual([
      false,
      false,
    ]);
    await t.h.app.close();
  });

  it('an invited caregiver gets the T+30 alert for a missed critical dose', async () => {
    const t = await withCarer();
    vi.spyOn(t.h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
    await t.h.api(t.admin, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [
        {
          brandName: 'Napa',
          dosageStrength: '500mg',
          form: 'Tablet',
          parsedPattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 2,
          isCritical: true,
        },
      ],
    });
    t.h.clock.now = new Date('2026-11-22T22:00:00+06:00');
    await t.h.app.ladder.tick();
    await settle(t.h);
    const to = t.h.applink.sendSms.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(to).toEqual([OTHER]);
    expect((await t.h.api(t.carer, 'GET', '/alerts')).json().alerts).toHaveLength(1);
    await t.h.app.close();
  });
});
