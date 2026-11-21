import { z } from 'zod';
import {
  accountSettings,
  alertsResponse,
  caasInitiateResponse,
  caasVerifyResponse,
  circleResponse,
  confirmResponse,
  doctorSummaryResponse,
  doseActionResponse,
  drugSearchResponse,
  entitlementsResponse,
  genericsResponse,
  insightsResponse,
  journalResponse,
  myPharmacyResponse,
  okResponse,
  otpRequestResponse,
  otpVerifyResponse,
  pharmaciesResponse,
  profile,
  reportDetail,
  reportListResponse,
  stepUpVerifyResponse,
  subscriptionStatusResponse,
  todayDosesResponse,
  tracesResponse,
  transcribeResponse,
  uploadAndParseResponse,
  voiceQueryResponse,
  type AccountType,
  type CaasPurpose,
  type ConfirmItem,
  type DoseActionBody,
  type LinkRole,
  type MealTimes,
  type StockStatus,
  type StoreProfile,
} from '@uposhom/shared';
import { request, type UploadFile } from './client';

/** One typed function per endpoint, all validated with the zod schemas from packages/shared. */
export const api = {
  auth: {
    requestOtp: (msisdn: string) =>
      request({
        method: 'POST',
        path: '/auth/otp/request',
        body: { msisdn },
        schema: otpRequestResponse,
        anon: true,
      }),
    verifyOtp: (msisdn: string, otp: string, accountType?: AccountType) =>
      request({
        method: 'POST',
        path: '/auth/otp/verify',
        body: { msisdn, otp, accountType },
        schema: otpVerifyResponse,
        anon: true,
      }),
    logout: () => request({ method: 'POST', path: '/auth/logout', schema: okResponse }),
    requestStepUp: () =>
      request({ method: 'POST', path: '/auth/step-up/request', schema: okResponse }),
    verifyStepUp: (otp: string) =>
      request({
        method: 'POST',
        path: '/auth/step-up/verify',
        body: { otp },
        schema: stepUpVerifyResponse,
      }),
  },

  circles: {
    get: () => request({ path: '/circles', schema: circleResponse }),
    createProfile: (b: {
      name: string;
      age?: number;
      relationship: string;
      msisdn?: string;
      mealTimes?: MealTimes;
    }) => request({ method: 'POST', path: '/profiles', body: b, schema: profile }),
    updateProfile: (id: string, b: Record<string, unknown>) =>
      request({ method: 'PUT', path: `/profiles/${id}`, body: b, schema: profile }),
    requestLink: (id: string, msisdn: string) =>
      request({
        method: 'POST',
        path: `/profiles/${id}/link/request`,
        body: { msisdn },
        schema: okResponse,
      }),
    verifyLink: (id: string, msisdn: string, otp: string) =>
      request({
        method: 'POST',
        path: `/profiles/${id}/link/verify`,
        body: { msisdn, otp },
        schema: okResponse,
      }),
    invite: (b: { profileId: string; msisdn: string; role: LinkRole }) =>
      request({ method: 'POST', path: '/links', body: b, schema: okResponse }),
    changeRole: (linkId: string, role: LinkRole) =>
      request({ method: 'PUT', path: `/links/${linkId}`, body: { role }, schema: okResponse }),
    removeLink: (linkId: string, stepUpToken: string) =>
      request({
        method: 'DELETE',
        path: `/links/${linkId}`,
        headers: { 'X-Step-Up-Token': stepUpToken },
        schema: okResponse,
      }),
    setSecondaryCaregiver: (profileId: string, linkId: string) =>
      request({
        method: 'PUT',
        path: `/profiles/${profileId}/secondary-caregiver`,
        body: { linkId },
        schema: okResponse,
      }),
  },

  devices: {
    register: (expoPushToken: string) =>
      request({
        method: 'POST',
        path: '/devices',
        body: { expoPushToken, platform: 'android' },
        schema: okResponse,
      }),
  },

  prescriptions: {
    uploadAndParse: (file: UploadFile, profileId?: string) =>
      request({
        method: 'POST',
        path: '/prescriptions/upload-and-parse',
        upload: { field: 'file', file, fields: profileId ? { profileId } : undefined },
        schema: uploadAndParseResponse,
      }),
    confirm: (draftId: string, profileId: string, items: ConfirmItem[]) =>
      request({
        method: 'POST',
        path: `/prescriptions/${draftId}/confirm`,
        body: { profileId, items },
        schema: confirmResponse,
      }),
  },

  doses: {
    today: (profileId?: string, days?: number) =>
      request({ path: '/doses/today', query: { profileId, days }, schema: todayDosesResponse }),
    act: (doseId: string, body: DoseActionBody) =>
      request({
        method: 'POST',
        path: `/doses/${doseId}/action`,
        body,
        schema: doseActionResponse,
      }),
    acknowledge: (doseId: string) =>
      request({ method: 'POST', path: `/doses/${doseId}/acknowledge`, schema: okResponse }),
  },

  alerts: {
    list: () => request({ path: '/alerts', schema: alertsResponse }),
  },

  symptoms: {
    journal: (b: {
      profileId: string;
      inputText: string;
      channel: 'TEXT' | 'VOICE';
      sessionId?: string;
      skip?: boolean;
    }) => request({ method: 'POST', path: '/symptoms/journal', body: b, schema: journalResponse }),
  },

  summaries: {
    doctor: (profileId: string, summaryId?: string) =>
      request({
        method: 'POST',
        path: '/summaries/doctor',
        body: { profileId, summaryId },
        schema: doctorSummaryResponse,
      }),
  },

  voice: {
    transcribe: (file: UploadFile) =>
      request({
        method: 'POST',
        path: '/voice/transcribe',
        upload: { field: 'audio', file },
        schema: transcribeResponse,
      }),
    query: (profileId: string, text: string) =>
      request({
        method: 'POST',
        path: '/voice/query',
        body: { profileId, text },
        schema: voiceQueryResponse,
      }),
  },

  billing: {
    subscriptionStatus: () =>
      request({ path: '/billing/subscription/status', schema: subscriptionStatusResponse }),
    subscribe: (consentWording: string) =>
      request({
        method: 'POST',
        path: '/billing/subscription/subscribe',
        body: { consentAccepted: true, consentWording },
        schema: subscriptionStatusResponse,
      }),
    unsubscribe: () =>
      request({
        method: 'POST',
        path: '/billing/subscription/unsubscribe',
        schema: subscriptionStatusResponse,
      }),
    caasInitiate: (purpose: CaasPurpose, consentWording: string) =>
      request({
        method: 'POST',
        path: '/billing/caas/initiate',
        body: { purpose, consentWording },
        schema: caasInitiateResponse,
      }),
    caasVerify: (chargeId: string, otp: string) =>
      request({
        method: 'POST',
        path: '/billing/caas/verify',
        body: { chargeId, otp },
        schema: caasVerifyResponse,
      }),
    caasStatus: (chargeId: string) =>
      request({ path: `/billing/caas/${chargeId}`, schema: caasVerifyResponse }),
    entitlements: () => request({ path: '/billing/entitlements', schema: entitlementsResponse }),
  },

  reports: {
    list: (profileId?: string) =>
      request({ path: '/reports', query: { profileId }, schema: reportListResponse }),
    get: (id: string) => request({ path: `/reports/${id}`, schema: reportDetail }),
    uploadAndParse: (file: UploadFile, profileId?: string) =>
      request({
        method: 'POST',
        path: '/reports/upload-and-parse',
        upload: { field: 'file', file, fields: profileId ? { profileId } : undefined },
        schema: reportDetail,
      }),
  },

  drugs: {
    search: (q: string) =>
      request({ path: '/drugs/search', query: { q }, schema: drugSearchResponse }),
    generics: (brand: string) =>
      request({ path: '/drugs/generics', query: { brand }, schema: genericsResponse }),
  },

  pharmacies: {
    nearby: (p: {
      lat?: number;
      lng?: number;
      area?: string;
      drugId?: string;
      radiusKm?: number;
    }) => request({ path: '/pharmacies', query: p, schema: pharmaciesResponse }),
    me: () => request({ path: '/pharmacies/me', schema: myPharmacyResponse }),
    setStock: (drugId: string, status: StockStatus) =>
      request({
        method: 'PUT',
        path: `/pharmacies/me/stock/${drugId}`,
        body: { status },
        schema: okResponse,
      }),
    updateProfile: (b: StoreProfile) =>
      request({ method: 'PUT', path: '/pharmacies/me/profile', body: b, schema: okResponse }),
  },

  insights: {
    get: (profileId: string) =>
      request({ path: `/insights/${profileId}`, schema: insightsResponse }),
  },

  account: {
    getSettings: () => request({ path: '/account/settings', schema: accountSettings }),
    putSettings: (b: Partial<z.infer<typeof accountSettings>>) =>
      request({ method: 'PUT', path: '/account/settings', body: b, schema: accountSettings }),
    optOut: (scope: 'SMS' | 'SUBSCRIPTION' | 'ALL') =>
      request({ method: 'POST', path: '/account/opt-out', body: { scope }, schema: okResponse }),
    deleteAll: (stepUpToken: string) =>
      request({
        method: 'DELETE',
        path: '/account',
        headers: { 'X-Step-Up-Token': stepUpToken },
        schema: okResponse,
      }),
  },

  admin: {
    traces: () => request({ path: '/admin/traces', schema: tracesResponse }),
  },
};
