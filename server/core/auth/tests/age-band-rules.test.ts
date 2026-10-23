import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { age_band, age_of, birth_year_month_valid, recompute, utc_year_month, type ConsentRules } from '../consent.ts';
import { boundary_error, settings_errors, terms_url_error, type AuthSettings } from '../settings.ts';

const C = CoreContract.ConsentChoice;
const RULES: ConsentRules = {
  age_band_boundaries: [13, 14, 16, 18, 19],
  child_age_years: 13,
  digital_consent_age_years: 16,
  minimum_age: 14,
  age_confirmation: true,
  privacy_choices: true,
};
const NOW = 202701;

function confirmed(fields: Partial<CoreContract.ConsentUserState> = {}): CoreContract.ConsentUserState {
  return Object.assign(new CoreContract.ConsentUserState(), { age_confirmed_at: 1n }, fields);
}

/** The birth year-month of someone who is `age` in `NOW` (born in the same month). */
function born_aged(age: number): number {
  return NOW - age * 100;
}

describe('age and age band', () => {
  it('reads the UTC year-month of a Unix ms time', () => {
    expect(utc_year_month(0n)).toBe(197001);
    expect(utc_year_month(1_800_000_000_000n)).toBe(202701);
    expect(utc_year_month(951_782_400_000n)).toBe(200002);
    expect(utc_year_month(951_868_800_000n - 1n)).toBe(200002);
    expect(utc_year_month(951_868_800_000n)).toBe(200003);
  });

  it('counts whole years from year-months', () => {
    expect(age_of(201401, 202701)).toBe(13);
    expect(age_of(201402, 202701)).toBe(12);
    expect(age_of(201312, 202701)).toBe(13);
  });

  it('computes age_from, age_to, child and below_consent_age at each boundary and one year below', () => {
    for (const boundary of RULES.age_band_boundaries) {
      for (const age of [boundary, boundary - 1]) {
        const state = recompute(confirmed(), born_aged(age), NOW, RULES);
        const band = age_band(age, RULES.age_band_boundaries);
        expect([state.age_from, state.age_to]).toEqual([band.age_from, band.age_to]);
        const below = (n: number): boolean => band.age_to !== 0 && band.age_to <= n;
        expect(state.child).toBe(below(13));
        expect(state.below_consent_age).toBe(below(16));
        expect(state.below_minimum_age).toBe(below(14));
      }
    }
    expect(age_band(12, RULES.age_band_boundaries)).toEqual({ age_from: 0, age_to: 13 });
    expect(age_band(13, RULES.age_band_boundaries)).toEqual({ age_from: 13, age_to: 14 });
    expect(age_band(40, RULES.age_band_boundaries)).toEqual({ age_from: 19, age_to: 0 });
  });

  it('has no age band and no below flags before age confirmation', () => {
    const state = recompute(new CoreContract.ConsentUserState(), null, NOW, RULES);
    expect([state.age_from, state.age_to, state.child, state.below_consent_age, state.below_minimum_age]).toEqual([0, 0, false, false, false]);
  });

  it('never sets below_minimum_age when consent.minimumAge is null', () => {
    for (const age of [5, 12, 13, 15, 30]) expect(recompute(confirmed(), born_aged(age), NOW, { ...RULES, minimum_age: null }).below_minimum_age).toBe(false);
  });

  it('recomputes the band in the UTC month of the birthday', () => {
    const birth = 201402;
    expect(recompute(confirmed(), birth, 202701, RULES).age_from).toBe(0);
    expect(recompute(confirmed(), birth, 202702, RULES).age_from).toBe(13);
  });

  it('takes a birth year-month with month 1 to 12, not after now, and an age up to the max', () => {
    expect(birth_year_month_valid(200013, NOW, 120)).toBe(false);
    expect(birth_year_month_valid(200000, NOW, 120)).toBe(false);
    expect(birth_year_month_valid(202702, NOW, 120)).toBe(false);
    expect(birth_year_month_valid(202701, NOW, 120)).toBe(true);
    expect(birth_year_month_valid(190701, NOW, 120)).toBe(true);
    expect(birth_year_month_valid(190602, NOW, 120)).toBe(true);
    expect(birth_year_month_valid(190601, NOW, 120)).toBe(false);
  });
});

describe('privacy choices', () => {
  it('with consent.privacyChoices, allows only GRANTED, and never below the consent age or for a child', () => {
    const adult = born_aged(30);
    for (const [choice, allowed] of [[C.CONSENT_CHOICE_UNSPECIFIED, false], [C.CONSENT_CHOICE_DENIED, false], [C.CONSENT_CHOICE_GRANTED, true]] as const) {
      const state = recompute(confirmed({ analytics: choice, ad_personalization: choice }), adult, NOW, RULES);
      expect([state.analytics_allowed, state.ad_personalization_allowed]).toEqual([allowed, allowed]);
    }
    const teen = recompute(confirmed({ analytics: C.CONSENT_CHOICE_GRANTED, ad_personalization: C.CONSENT_CHOICE_GRANTED }), born_aged(15), NOW, RULES);
    expect(teen.ad_personalization_allowed).toBe(false);
    expect(teen.analytics_allowed).toBe(true);
    const child = recompute(confirmed({ analytics: C.CONSENT_CHOICE_GRANTED }), born_aged(10), NOW, RULES);
    expect(child.analytics_allowed).toBe(false);
  });

  it('without consent.privacyChoices, allows unless ad personalization is DENIED', () => {
    const rules = { ...RULES, privacy_choices: false };
    expect(recompute(confirmed(), born_aged(30), NOW, rules).ad_personalization_allowed).toBe(true);
    expect(recompute(confirmed({ ad_personalization: C.CONSENT_CHOICE_DENIED }), born_aged(30), NOW, rules).ad_personalization_allowed).toBe(false);
    expect(recompute(confirmed(), born_aged(30), NOW, rules).analytics_allowed).toBe(true);
  });

  it('with consent.ageConfirmation, refuses analytics before age confirmation whatever the choice', () => {
    const before = recompute(Object.assign(new CoreContract.ConsentUserState(), { analytics: C.CONSENT_CHOICE_GRANTED }), null, NOW, RULES);
    expect(before.analytics_allowed).toBe(false);
    const without = recompute(Object.assign(new CoreContract.ConsentUserState(), { analytics: C.CONSENT_CHOICE_GRANTED }), null, NOW, { ...RULES, age_confirmation: false });
    expect(without.analytics_allowed).toBe(true);
  });
});

function settings(fields: Partial<AuthSettings>): AuthSettings {
  return {
    terms: { TERMS: { version: 1, url: 'https://example.com/terms' }, PRIVACY: { version: 1, url: 'https://example.com/privacy' } },
    age_band_boundaries: [13, 14, 16, 18, 19],
    max_age_years: 120,
    child_age_years: 13,
    digital_consent_age_years: 16,
    minimum_age: null,
    ...fields,
  } as AuthSettings;
}

describe('settings rules', () => {
  it('fails server start on boundaries out of order, with a duplicate, or without the required ages', () => {
    expect(boundary_error(settings({}))).toBeNull();
    expect(boundary_error(settings({ age_band_boundaries: [13, 16, 14, 18] }))).not.toBeNull();
    expect(boundary_error(settings({ age_band_boundaries: [13, 13, 16] }))).not.toBeNull();
    expect(boundary_error(settings({ age_band_boundaries: [14, 16, 18] }))).not.toBeNull();
    expect(boundary_error(settings({ age_band_boundaries: [13, 14, 18] }))).not.toBeNull();
    expect(boundary_error(settings({ minimum_age: 15 }))).not.toBeNull();
    expect(boundary_error(settings({ minimum_age: 14 }))).toBeNull();
    expect(boundary_error(settings({ age_band_boundaries: [0, 13, 16] }))).not.toBeNull();
    expect(boundary_error(settings({ age_band_boundaries: [13, 16, 121] }))).not.toBeNull();
  });

  it('takes https terms URLs with a host and no user info, and http only in LOCAL', () => {
    expect(terms_url_error('https://example.com/terms', 'PROD')).toBeNull();
    expect(terms_url_error('http://example.com/terms', 'PROD')).not.toBeNull();
    expect(terms_url_error('http://example.com/terms', 'LOCAL')).toBeNull();
    expect(terms_url_error('https://user:pw@example.com/terms', 'PROD')).not.toBeNull();
    expect(terms_url_error('ftp://example.com/terms', 'LOCAL')).not.toBeNull();
    expect(terms_url_error('not a url', 'DEV')).not.toBeNull();
    expect(settings_errors(settings({ terms: { TERMS: { version: 1, url: 'http://x.example' }, PRIVACY: { version: 1, url: 'https://y.example' } } }), 'STG')).toHaveLength(1);
  });
});
