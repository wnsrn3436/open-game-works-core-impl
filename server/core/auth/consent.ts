/**
 * Age and privacy choices (`### age and privacy choices`): the age from the birth year-month, the age band, and the
 * computed fields of `ConsentUserState`. Pure functions of their input.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';

export interface ConsentRules {
  readonly age_band_boundaries: readonly number[];
  readonly child_age_years: number;
  readonly digital_consent_age_years: number;
  readonly minimum_age: number | null;
  readonly age_confirmation: boolean;
  readonly privacy_choices: boolean;
}

const MS_PER_DAY = 86_400_000n;

/** The UTC year-month `yyyymm` of a Unix ms time. */
export function utc_year_month(time: bigint): number {
  // Days to a civil date (Howard Hinnant's days_from_civil inverse), in integers so no Date is needed.
  const days = time >= 0n ? time / MS_PER_DAY : -((-time + MS_PER_DAY - 1n) / MS_PER_DAY);
  const z = Number(days) + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return year * 100 + month;
}

/** ⌊((now year × 12 + now month) − (birth year × 12 + birth month)) / 12⌋. */
export function age_of(birth_year_month: number, now_year_month: number): number {
  const months = (y: number): number => Math.floor(y / 100) * 12 + (y % 100);
  return Math.floor((months(now_year_month) - months(birth_year_month)) / 12);
}

/** `INVALID_REQUEST` cases of `ConfirmAge`: the month is not 1 to 12, it is after now, or the age is over the max. */
export function birth_year_month_valid(birth_year_month: number, now_year_month: number, max_age_years: number): boolean {
  const month = birth_year_month % 100;
  if (month < 1 || month > 12) return false;
  if (birth_year_month > now_year_month) return false;
  return age_of(birth_year_month, now_year_month) <= max_age_years;
}

/** `age_from`, `age_to` of an age: the largest boundary ≤ age and the smallest boundary > age, 0 when none. */
export function age_band(age: number, boundaries: readonly number[]): { age_from: number; age_to: number } {
  let age_from = 0;
  let age_to = 0;
  for (const b of boundaries) {
    if (b <= age && b > age_from) age_from = b;
    if (b > age && (age_to === 0 || b < age_to)) age_to = b;
  }
  return { age_from, age_to };
}

/**
 * The `ConsentUserState` of a stored state with the age band and the computed fields recomputed. `birth_year_month`
 * is the stored birth year-month, or null before age confirmation.
 */
export function recompute(
  stored: CoreContract.ConsentUserState,
  birth_year_month: number | null,
  now_year_month: number,
  rules: ConsentRules,
): CoreContract.ConsentUserState {
  const next = Object.assign(new CoreContract.ConsentUserState(), stored);
  if (birth_year_month === null || next.age_confirmed_at === 0n) {
    next.age_from = 0;
    next.age_to = 0;
  } else {
    const band = age_band(age_of(birth_year_month, now_year_month), rules.age_band_boundaries);
    next.age_from = band.age_from;
    next.age_to = band.age_to;
  }
  const below = (n: number): boolean => next.age_confirmed_at !== 0n && next.age_to !== 0 && next.age_to <= n;
  next.child = below(rules.child_age_years);
  next.below_consent_age = below(rules.digital_consent_age_years);
  next.below_minimum_age = rules.minimum_age !== null && below(rules.minimum_age);
  const GRANTED = CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED;
  const DENIED = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED;
  if ((rules.age_confirmation && next.age_confirmed_at === 0n) || next.child) next.analytics_allowed = false;
  else next.analytics_allowed = rules.privacy_choices ? next.analytics === GRANTED : true;
  if (next.below_consent_age) next.ad_personalization_allowed = false;
  else if (next.ad_personalization === GRANTED) next.ad_personalization_allowed = true;
  else if (next.ad_personalization === DENIED) next.ad_personalization_allowed = false;
  // CONSENT_CHOICE_UNSPECIFIED
  else next.ad_personalization_allowed = !rules.privacy_choices;
  return next;
}

/** True when two states have the same field values. */
export function same_state(a: CoreContract.ConsentUserState, b: CoreContract.ConsentUserState): boolean {
  const x = a.encode();
  const y = b.encode();
  return x.length === y.length && x.every((byte, i) => byte === y[i]);
}

function element_name(values: Readonly<Record<string, number>>, value: number): string {
  const entry = Object.entries(values).find(([, v]) => v === value);
  return entry === undefined ? String(value) : entry[0];
}

/** The element name (`core` `## spec`) of a `ConsentChoice` value. */
export function choice_name(value: CoreContract.ConsentChoice): string {
  return element_name(CoreContract.ConsentChoice, value);
}

/** The element name of a `TrackingStatus` value. */
export function tracking_name(value: CoreContract.TrackingStatus): string {
  return element_name(CoreContract.TrackingStatus, value);
}

/** The element name of a `LoginProvider` value. */
export function provider_name(value: CoreContract.LoginProvider): string {
  return element_name(CoreContract.LoginProvider, value);
}
