import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import { SAVE, START_AT, error_code, save, start, stop, type Env } from './helpers.ts';

const HOUR_MS = 3_600_000n;

function consent(analytics: CoreContract.ConsentChoice): CoreContract.UpdateConsentRequest {
  const request = new CoreContract.UpdateConsentRequest();
  request.privacy_version = 1;
  request.ad_personalization = CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED;
  request.analytics = analytics;
  request.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE;
  return request;
}

/** The `core_tutorial_step` server events of the user as `[tutorial_id, step]`, in stored order. */
async function events(env: Env, user_id: bigint): Promise<[number, number][]> {
  const result = await Testing.send_admin(env.server, 'list_server_events', {
    user_id: String(user_id),
    name: 'core_tutorial_step',
    from_at: String(START_AT),
    to_at: String(START_AT + HOUR_MS),
    limit: 100,
  });
  expect(result.status).toBe(200);
  const entries = (result.json as { entries: { name: string; params: string }[] }).entries;
  return entries.map((entry) => {
    expect(entry.name).toBe('core_tutorial_step');
    const event = CoreContract.AnalyticsEvent.decode(Buffer.from(entry.params, 'base64'));
    if (event === null) throw new Error('undecodable params');
    const params = new Map(event.params.map((param) => [param.key, param]));
    expect([...params.keys()]).toEqual(['tutorial_id', 'step']);
    for (const param of params.values()) expect(param.kind).toBe(CoreContract.AnalyticsParamKind.ANALYTICS_PARAM_KIND_INT);
    const tutorial_id = params.get('tutorial_id');
    const step = params.get('step');
    if (tutorial_id === undefined || step === undefined) throw new Error('missing core_tutorial_step params');
    return [Number(tutorial_id.int_value), Number(step.int_value)];
  });
}

describe('core analytics event core_tutorial_step', () => {
  let env: Env;
  beforeEach(async () => {
    // With privacy choices, a user allows analytics only by granting it.
    env = await start({ 'consent.privacyChoices': true });
  });
  afterEach(async () => {
    await stop(env);
  });

  it('is left only by a SaveTutorialProgress that changed progress, and only for a user who allowed analytics', async () => {
    const allowed = await Testing.login(env.server, 'allowed');
    const granted = await Testing.send(allowed, 'core/UpdateConsent', consent(CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED));
    expect(error_code(granted.envelope)).toBe(0);
    const denied = await Testing.login(env.server, 'denied');
    const refused = await Testing.send(denied, 'core/UpdateConsent', consent(CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED));
    expect(error_code(refused.envelope)).toBe(0);
    const unanswered = await Testing.login(env.server, 'unanswered');

    const saves: [number, number][] = [
      [env.first, 1],
      [env.first, 1], // no change
      [env.first, 3],
      [env.first, 2], // smaller: no change
      [env.first, 4], // INVALID_REQUEST
      [env.second, 2],
    ];
    for (const session of [allowed, denied, unanswered]) {
      for (const [tutorial_id, step] of saves) {
        await Testing.send(session, SAVE, save(tutorial_id, step));
      }
    }

    expect(await events(env, allowed.user_id)).toEqual([
      [env.first, 1],
      [env.first, 3],
      [env.second, 2],
    ]);
    expect(await events(env, denied.user_id)).toEqual([]);
    expect(await events(env, unanswered.user_id)).toEqual([]);
  });
});
