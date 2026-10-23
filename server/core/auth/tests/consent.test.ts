import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { recompute, utc_year_month } from '../consent.ts';
import { C, E, P, T0, admin, auto_login, call, consent_of, fake, guest, log_text, logs, missing, personal_rows, probe, social, start, testing, type TestServer, type TestSession } from './helpers.ts';

const NOW_YM = utc_year_month(T0);
const BOUNDARIES = [13, 14, 16, 18, 19];

function confirm(session: TestSession, birth_year_month: number): Promise<{ code: number; response: CoreContract.ConfirmAgeResponse }> {
  return call<CoreContract.ConfirmAgeResponse>(session, 'core/ConfirmAge', Object.assign(new CoreContract.ConfirmAgeRequest(), { birth_year_month }));
}

function update(session: TestSession, fields: Partial<CoreContract.UpdateConsentRequest>): Promise<{ code: number; response: CoreContract.UpdateConsentResponse }> {
  const request = Object.assign(new CoreContract.UpdateConsentRequest(), { privacy_version: 1, tracking: CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED }, fields);
  return call<CoreContract.UpdateConsentResponse>(session, 'core/UpdateConsent', request);
}

function push(session: TestSession, push_ad: CoreContract.ConsentChoice, push_night: CoreContract.ConsentChoice): Promise<{ code: number; response: CoreContract.UpdatePushConsentResponse }> {
  return call<CoreContract.UpdatePushConsentResponse>(session, 'core/UpdatePushConsent', Object.assign(new CoreContract.UpdatePushConsentRequest(), { push_ad, push_night }));
}

const aged = (age: number): number => NOW_YM - age * 100;

describe('ConfirmAge with a minimum age', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await start({ settings: { 'consent.minimumAge': 14, 'consent.ageConfirmation': true, 'consent.privacyChoices': true } });
  });
  afterAll(async () => {
    await testing.stop_test_server(server);
  });

  it('computes age_from, age_to, child and below_consent_age at each boundary and one year below; the birth year-month is in no UserState or log', async () => {
    const sent: number[] = [];
    for (const boundary of BOUNDARIES) {
      for (const age of [boundary, boundary - 1]) {
        sent.push(aged(age));
        const user = await guest(server);
        const reply = await confirm(user.session, aged(age));
        expect(reply.code).toBe(0);
        const expected = recompute(Object.assign(new CoreContract.ConsentUserState(), { age_confirmed_at: 1n }), aged(age), NOW_YM, {
          age_band_boundaries: BOUNDARIES,
          child_age_years: 13,
          digital_consent_age_years: 16,
          minimum_age: 14,
          age_confirmation: true,
          privacy_choices: true,
        });
        const got = reply.response.consent;
        expect([got?.age_from, got?.age_to, got?.child, got?.below_consent_age, got?.below_minimum_age]).toEqual([expected.age_from, expected.age_to, expected.child, expected.below_consent_age, expected.below_minimum_age]);
        const state = JSON.stringify(await testing.read_user_state(server, user.result.user_id), (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
        expect(state).not.toContain(String(aged(age)));
      }
    }
    expect(sent.length).toBe(BOUNDARIES.length * 2);
    const text = log_text(server);
    expect(text).toContain('ConfirmAge');
    for (const birth_year_month of sent) expect(text).not.toMatch(new RegExp(`\\b${String(birth_year_month)}\\b`));
  });

  it('a ConfirmAge below consent.minimumAge succeeds with below_minimum_age and withdraws the user', async () => {
    const user = await social(server, P.LOGIN_PROVIDER_APPLE, 'young-apple');
    const reply = await confirm(user.session, aged(13));
    expect(reply.code).toBe(0);
    expect(reply.response.consent?.below_minimum_age).toBe(true);
    const record = await admin(server, 'get_user', { user_id: user.result.user_id.toString() });
    expect(record.body.withdrawn_at).not.toBeNull();
    expect(record.body.user_state).toEqual({});
    expect(await personal_rows(server, user.result.user_id, 'auth_age')).toEqual([]);
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    expect((await auto_login(server, user.result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    const audits = (logs(server, 'audit')) as { reason?: unknown; user_id?: unknown }[];
    expect(audits.some((l) => l.reason === 'age_blocked' && String(l.user_id) === user.result.user_id.toString())).toBe(true);
    await testing.wait_background(server);
    const revokes = (fake(server, 'login-apple')).calls().filter((c) => c.operation === 'revoke' && c.input === 'fake:young-apple');
    expect(revokes).toHaveLength(1);
  });

  it('a second ConfirmAge does not change the age band; month 13, a future year-month and an age over auth.maxAgeYears are INVALID_REQUEST', async () => {
    const user = await guest(server);
    const first = await confirm(user.session, aged(20));
    const second = await confirm(user.session, aged(15));
    expect([first.code, second.code]).toEqual([0, 0]);
    expect([second.response.consent?.age_from, second.response.consent?.age_to]).toEqual([first.response.consent?.age_from, first.response.consent?.age_to]);
    const other = await guest(server);
    for (const bad of [199013, NOW_YM + 1, aged(121)]) expect((await confirm(other.session, bad)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
  });

  it('recomputes age_from and age_to at the next Login in the UTC month of the birthday', async () => {
    const user = await guest(server);
    const birth = NOW_YM - 1800 + 1; // 18 in the next month
    expect((await confirm(user.session, birth)).response.consent?.age_from).toBe(16);
    testing.advance_time(server, 31n * 86_400_000n);
    const again = await auto_login(server, user.result.login_token);
    expect(again.code).toBe(0);
    expect([again.response.result?.consent?.age_from, again.response.result?.consent?.age_to]).toEqual([18, 19]);
  });

  it('with consent.privacyChoices, unanswered and DENIED are not allowed and GRANTED is; below the consent age ad personalization and for a child analytics stay off', async () => {
    const user = await guest(server);
    expect((await confirm(user.session, aged(30))).code).toBe(0);
    let state = await consent_of(server, user.result.user_id);
    expect([state.analytics_allowed, state.ad_personalization_allowed]).toEqual([false, false]);
    expect((await update(user.session, { ad_personalization: C.CONSENT_CHOICE_DENIED, analytics: C.CONSENT_CHOICE_DENIED })).code).toBe(0);
    state = await consent_of(server, user.result.user_id);
    expect([state.analytics_allowed, state.ad_personalization_allowed]).toEqual([false, false]);
    const granted = await update(user.session, { ad_personalization: C.CONSENT_CHOICE_GRANTED, analytics: C.CONSENT_CHOICE_GRANTED });
    expect([granted.response.consent?.analytics_allowed, granted.response.consent?.ad_personalization_allowed]).toEqual([true, true]);
    const teen = await guest(server);
    expect((await confirm(teen.session, aged(15))).code).toBe(0);
    const teen_state = await update(teen.session, { ad_personalization: C.CONSENT_CHOICE_GRANTED, analytics: C.CONSENT_CHOICE_GRANTED });
    expect(teen_state.response.consent?.ad_personalization_allowed).toBe(false);
  });

  it('with consent.ageConfirmation, analytics is off before age confirmation whatever the choice and follows it after a non-child ConfirmAge', async () => {
    const user = await guest(server);
    const before = await update(user.session, { ad_personalization: C.CONSENT_CHOICE_GRANTED, analytics: C.CONSENT_CHOICE_GRANTED });
    expect(before.response.consent?.analytics_allowed).toBe(false);
    expect((await confirm(user.session, aged(25))).response.consent?.analytics_allowed).toBe(true);
  });

  it('an UpdateConsent version other than consent.version is INVALID_REQUEST; each changed item leaves one record of the request version', async () => {
    const user = await guest(server);
    expect((await update(user.session, { privacy_version: 2, ad_personalization: C.CONSENT_CHOICE_GRANTED, analytics: C.CONSENT_CHOICE_GRANTED })).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await update(user.session, { ad_personalization: C.CONSENT_CHOICE_GRANTED, analytics: C.CONSENT_CHOICE_DENIED })).code).toBe(0);
    const rows = await personal_rows(server, user.result.user_id, 'auth_consent_record');
    expect(rows.map((r) => [r.purpose, r.value, String(r.version)])).toEqual([
      ['ad_personalization', 'CONSENT_CHOICE_GRANTED', '1'],
      ['analytics', 'CONSENT_CHOICE_DENIED', '1'],
      ['tracking', 'TRACKING_STATUS_NOT_DETERMINED', '1'],
    ]);
  });

  it('two UpdateConsents at the same request time that change the same item leave two rows of seq 1 and 2', async () => {
    const user = await guest(server);
    expect((await update(user.session, { ad_personalization: C.CONSENT_CHOICE_GRANTED, analytics: C.CONSENT_CHOICE_GRANTED, tracking: CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE })).code).toBe(0);
    const base = (await personal_rows(server, user.result.user_id, 'auth_consent_record')).length;
    expect((await update(user.session, { ad_personalization: C.CONSENT_CHOICE_DENIED, analytics: C.CONSENT_CHOICE_GRANTED, tracking: CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE })).code).toBe(0);
    const rows = await personal_rows(server, user.result.user_id, 'auth_consent_record');
    expect(rows.map((r) => String(r.seq))).toEqual(rows.map((_, i) => String(i + 1)));
    expect(rows.length).toBe(base + 1);
  });
});

describe('consent without a minimum age', () => {
  it('starts with consent.minimumAge null and no ConfirmAge sets below_minimum_age', async () => {
    const server = await start({ settings: { 'consent.minimumAge': null } });
    try {
      for (const age of [5, 12, 13, 15, 17, 18, 40]) {
        const user = await guest(server);
        expect((await confirm(user.session, aged(age))).response.consent?.below_minimum_age).toBe(false);
      }
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('does not start with boundaries out of order or without auth.childAgeYears, auth.digitalConsentAgeYears or consent.minimumAge', async () => {
    for (const settings of [
      { 'consent.ageBandBoundaries': [13, 16, 14, 18] },
      { 'consent.ageBandBoundaries': [14, 16, 18] },
      { 'consent.ageBandBoundaries': [13, 14, 18] },
      { 'consent.ageBandBoundaries': [13, 14, 16, 18], 'consent.minimumAge': 15 },
    ]) {
      await expect(start({ settings })).rejects.toThrow();
    }
  });

  it('without consent.ageConfirmation, analytics follows the choice before age confirmation; without privacyChoices a DENIED ad personalization is off', async () => {
    const server = await start({ settings: { 'consent.ageConfirmation': false, 'consent.privacyChoices': false } });
    try {
      const user = await guest(server);
      expect(user.result.consent?.analytics_allowed).toBe(true);
      const denied = await update(user.session, { ad_personalization: C.CONSENT_CHOICE_DENIED });
      expect(denied.response.consent?.ad_personalization_allowed).toBe(false);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});

describe('UpdatePushConsent', () => {
  it('sets _at of each changed item to the request time with one record each (version 0)', async () => {
    const server = await start({ settings: { 'pushConsent.adPush': true } });
    try {
      const user = await guest(server);
      const first = await push(user.session, C.CONSENT_CHOICE_GRANTED, C.CONSENT_CHOICE_DENIED);
      expect(first.code).toBe(0);
      expect([first.response.consent?.push_ad_at, first.response.consent?.push_night_at]).toEqual([T0, T0]);
      testing.advance_time(server, 1000n);
      const second = await push(user.session, C.CONSENT_CHOICE_GRANTED, C.CONSENT_CHOICE_GRANTED);
      expect([second.response.consent?.push_ad_at, second.response.consent?.push_night_at]).toEqual([T0, T0 + 1000n]);
      const rows = await personal_rows(server, user.result.user_id, 'auth_consent_record');
      expect(rows.map((r) => [r.purpose, r.value, String(r.version)])).toEqual([
        ['push_ad', 'CONSENT_CHOICE_GRANTED', '0'],
        ['push_night', 'CONSENT_CHOICE_DENIED', '0'],
        ['push_night', 'CONSENT_CHOICE_GRANTED', '0'],
      ]);
      expect((await push(user.session, C.CONSENT_CHOICE_UNSPECIFIED, C.CONSENT_CHOICE_GRANTED)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it.skipIf(missing('push'))('calls push.refresh_push_consent', async () => {
    const server = await start({ settings: { 'pushConsent.adPush': true, 'environments.<ENV>.adapters.push-fcm': 'fake' } });
    try {
      const user = await guest(server);
      const token = Object.assign(new CoreContract.RegisterPushTokenRequest(), { device_token: 'push-device-1', language: 'en', timezone_offset_ms: 0n });
      expect((await call(user.session, 'core/RegisterPushToken', token, { headers: { 'X-Ogw-Platform': 'android' } })).code).toBe(0);
      expect((await push(user.session, C.CONSENT_CHOICE_GRANTED, C.CONSENT_CHOICE_GRANTED)).code).toBe(0);
      // push.refresh_push_consent wrote the device registration's night_allowed from the new state.
      const exported = await admin(server, 'export_personal_data', { user_id: user.result.user_id.toString() });
      expect(JSON.stringify(exported.body)).toMatch(/night_allowed"?:\s*true/);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('is INVALID_REQUEST when pushConsent.adPush is false', async () => {
    const server = await start({ settings: { 'pushConsent.adPush': false } });
    try {
      const user = await guest(server);
      expect((await push(user.session, C.CONSENT_CHOICE_GRANTED, C.CONSENT_CHOICE_GRANTED)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});
