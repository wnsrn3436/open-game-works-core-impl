/** `push` `### send`: job `push_send`, push text, adapter results, the target filter, ad pushes and the night window. */
import {
  HOUR, MINUTE, POLL_MS, RETRY_MS, START_AT, advance, device, devices, fake, fake_adapter, held, logs, message, peer, queue, record, schedule, sends_to,
  set_push_consent, start, stop_all, translations, type Sent, type TestServer,
} from './helpers.ts';
import { push_cases } from './text_format.ts';

afterEach(async () => {
  await stop_all();
});

describe('sending', () => {
  it('a queue_push push goes to the registered device once, after send_at, and the record is SENT', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:once' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]', after_ms: 3n * POLL_MS });
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:once')).toEqual([]);
    expect((await record(server, push_id))?.status).toBe('SCHEDULED');
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    const sends = sends_to(server, 'fake:once');
    expect(sends).toHaveLength(1);
    expect(sends[0]?.payload).toEqual({ title: 'Plain', body: 'Nothing to fill', data: { message_id: String(message('[push_plain]')), push_id: push_id.toString() } });
    const row = await record(server, push_id);
    expect(row).toEqual(expect.objectContaining({ status: 'SENT', device_count: 1n, sent_count: 1n, cursor_user_id: d.user_id }));
    expect(row?.expires_at).toBe((row?.finished_at as bigint) + 2_592_000_000n);
  });

  it('title and body come from the translation of the device language with the format arguments filled', async () => {
    const ko = { '[push_info]': { title: '안녕 {name:은/는}', body: '보석 {count:n}개 도착' } };
    const server = await start({ settings: { supportedLanguages: ['en', 'ko'] }, files: translations(['ko'], ko) });
    const en_device = await device(server, { device_token: 'fake:en', language: 'en' });
    const ko_device = await device(server, { device_token: 'fake:ko', language: 'ko' });
    const args = [{ name: 'name', text_value: '샘' }, { name: 'count', int_value: 12_345n }];
    await queue(en_device.session, en_device.user_id, { message: '[push_info]', args });
    await queue(ko_device.session, ko_device.user_id, { message: '[push_info]', args });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:en').map((s) => [s.payload.title, s.payload.body])).toEqual([['Hello 샘', '12,345 gems arrived']]);
    expect(sends_to(server, 'fake:ko').map((s) => [s.payload.title, s.payload.body])).toEqual([['안녕 샘은', '보석 12,345개 도착']]);
  });

  it('an INVALID_TOKEN result deletes the device row; FAILED is sent again and then counted in failed_count', async () => {
    const server = await start();
    const bad = await device(server, { device_token: 'not-a-fake-token' });
    const failing = await device(server, { device_token: 'fake:failing' });
    fake(server, 'push-fcm').set_result('send', { 'fake:failing': 'FAILED' });
    const invalid_push = await queue(bad.session, bad.user_id, { message: '[push_plain]' });
    const failed_push = await queue(failing.session, failing.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect((await devices(server)).map((r) => r.device_token)).toEqual(['fake:failing']);
    expect(await record(server, invalid_push)).toEqual(expect.objectContaining({ status: 'SENT', invalid_count: 1n, device_count: 1n }));
    expect(sends_to(server, 'fake:failing')).toHaveLength(2);
    expect(await record(server, failed_push)).toEqual(expect.objectContaining({ status: 'FAILED', failed_count: 1n, device_count: 1n, sent_count: 0n }));
    expect(logs(server, 'error').filter((l) => l.message === 'push adapter failed').map((l) => l.reason)).toEqual(['adapter result FAILED']);
  });

  it('a time limit over push.sendTimeoutMs is a failed attempt', async () => {
    const server = await start({ settings: { 'push.sendTimeoutMs': 50, 'push.retryMaxAttempts': 1 } });
    const d = await device(server, { device_token: 'fake:slow' });
    fake(server, 'push-fcm').set_failure('send', 'timeout');
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'FAILED', failed_count: 1n }));
    expect(logs(server, 'error').filter((l) => l.message === 'push adapter failed').map((l) => l.reason)).toEqual(['time limit push.sendTimeoutMs']);
  });

  it('an adapter that throws is a failed attempt; the first failure log gives the reason without the device token or the text', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:thrower:77' });
    fake_adapter(server, 'push-fcm').send = (tokens, payload) => Promise.reject(new Error(`socket hang up on /3/device/${encodeURIComponent(tokens.join(','))} for ${payload.title}`));
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'FAILED', failed_count: 1n, device_count: 1n }));
    const failures = logs(server, 'error').filter((l) => l.message === 'push adapter failed');
    expect(failures.map((l) => [l.attempt, l.reason])).toEqual([[1, 'adapter threw Error: socket hang up on /3/device/[redacted] for [redacted]']]);
    expect(JSON.stringify(logs(server))).not.toContain('thrower');
  });

  it('a SCHEDULED record taken later than push.maxDelayMs after send_at is EXPIRED and not sent', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:late' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(server, HOUR + 2n * POLL_MS);
    expect((await record(server, push_id))?.status).toBe('EXPIRED');
    expect(sends_to(server, 'fake:late')).toEqual([]);
  });

  it('a filter target goes only to devices of its platforms, languages and active_within_ms; active_within_ms 0 is no condition', async () => {
    const server = await start({ settings: { supportedLanguages: ['en', 'ko'] }, files: translations(['ko']) });
    await device(server, { device_token: 'fake:android-en' });
    await device(server, { device_token: 'fake:ios-en', platform: 'ios' });
    await device(server, { device_token: 'fake:android-ko', language: 'ko' });
    await advance(server, 10n * MINUTE);
    await device(server, { device_token: 'fake:android-en-new' });
    const to = (filter: Record<string, unknown>): Promise<bigint> => schedule(server, { message_id: message('[push_plain]'), send_at: START_AT + 10n * MINUTE, target: { filter } });
    await to({ platforms: ['android'], languages: ['en'], active_within_ms: 5n * MINUTE });
    await to({ platforms: [], languages: ['ko'], active_within_ms: HOUR });
    await to({ platforms: ['ios'], languages: [], active_within_ms: HOUR });
    await to({ platforms: ['web'], languages: [], active_within_ms: HOUR });
    await to({ platforms: [], languages: ['en'], active_within_ms: 0n });
    await advance(server, POLL_MS);
    const count = (token: string): number => sends_to(server, token).length;
    expect([count('fake:android-en'), count('fake:ios-en'), count('fake:android-ko'), count('fake:android-en-new')]).toEqual([1, 2, 1, 2]);
  });

  it('the log has no device token, title or body', async () => {
    const server = await start();
    const ok = await device(server, { device_token: 'fake:secret-token-1' });
    const bad = await device(server, { device_token: 'secret-token-2' });
    fake(server, 'push-fcm').set_result('send', { 'fake:secret-token-1': 'FAILED' });
    const args = [{ name: 'name', text_value: 'Zorblax' }, { name: 'count', int_value: 987_654n }];
    await queue(ok.session, ok.user_id, { message: '[push_info]', args });
    await queue(bad.session, bad.user_id, { message: '[push_info]', args });
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    const lines = logs(server);
    expect(lines.filter((l) => l.message === 'push sent')).toHaveLength(2);
    const text = JSON.stringify(lines);
    for (const secret of ['secret-token-1', 'secret-token-2', 'Zorblax', '987,654', 'gems arrived']) expect(text).not.toContain(secret);
  });
});

describe('real adapters', () => {
  it('a test server with the real push adapters reads their secrets by key and starts; a send it cannot make is FAILED', async () => {
    const server = await start({ real: { 'push-fcm': 'push-fcm', 'push-apns': 'push-apns-sandbox' } });
    const d = await device(server, { device_token: 'apns-token-0001', platform: 'ios' });
    const push_id = await queue(d.session, d.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'FAILED', device_count: 1n, failed_count: 1n }));
    expect(JSON.stringify(logs(server))).not.toContain('apns-token-0001');
  });
});

describe('ad push', () => {
  it('an Ad push does not go to a device with ad_allowed false and counts consent_skipped_count; its title starts with the [push_ad_label] title and a space', async () => {
    const server = await start();
    const denied = await device(server, { device_token: 'fake:ad-denied' });
    const granted = await device(server, { device_token: 'fake:ad-granted' });
    await set_push_consent(granted.session, true, true);
    const args = [{ name: 'percent', int_value: 30n }];
    const skipped = await queue(denied.session, denied.user_id, { message: '[push_ad]', args });
    await queue(granted.session, granted.user_id, { message: '[push_ad]', args });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:ad-denied')).toEqual([]);
    expect(await record(server, skipped)).toEqual(expect.objectContaining({ status: 'SENT', consent_skipped_count: 1n, device_count: 1n, sent_count: 0n }));
    expect(sends_to(server, 'fake:ad-granted').map((s) => [s.payload.title, s.payload.body])).toEqual([['(Ad) Sale', '30% off']]);
  });

  // START_AT is 08:00 UTC; the first job runs at START_AT + POLL_MS. A device offset of 16 h makes it 00:00 local.
  const NIGHT_OFFSET = 16n * HOUR;
  const AD = { message: '[push_ad]', args: [{ name: 'percent', int_value: 5n }] };

  it('in the night window, an Ad push to a device with night_allowed false goes to push_held, and goes once at the first run after the window ends', async () => {
    const server = await start();
    const d = await device(server, { device_token: 'fake:night', timezone_offset_ms: NIGHT_OFFSET });
    await set_push_consent(d.session, true, false);
    const push_id = await queue(d.session, d.user_id, AD);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:night')).toEqual([]);
    expect(await held(server)).toEqual([expect.objectContaining({ push_id, user_id: d.user_id, send_at: START_AT + 8n * HOUR, expires_at: START_AT + 9n * HOUR })]);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', held_count: 1n, sent_count: 0n }));
    await advance(server, 8n * HOUR - 2n * POLL_MS);
    expect(sends_to(server, 'fake:night')).toEqual([]);
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:night')).toHaveLength(1);
    expect(await held(server)).toEqual([]);
    expect((await record(server, push_id))?.sent_count).toBe(1n);
  });

  it('in the night window, an Ad push to a device with night_allowed true goes at once, and an Info push goes whatever the consent', async () => {
    const server = await start();
    const night_ok = await device(server, { device_token: 'fake:night-ok', timezone_offset_ms: NIGHT_OFFSET });
    const info = await device(server, { device_token: 'fake:night-info', timezone_offset_ms: NIGHT_OFFSET });
    await set_push_consent(night_ok.session, true, true);
    await queue(night_ok.session, night_ok.user_id, AD);
    await queue(info.session, info.user_id, { message: '[push_plain]' });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:night-ok')).toHaveLength(1);
    expect(sends_to(server, 'fake:night-info')).toHaveLength(1);
    expect(await held(server)).toEqual([]);
  });

  it('two instances whose jobs both take one push_held row send it to the device once, and sent_count goes up by 1', async () => {
    const a = await start();
    const b: TestServer = await peer(a);
    const d = await device(a, { device_token: 'fake:held-twice', timezone_offset_ms: NIGHT_OFFSET });
    await set_push_consent(d.session, true, false);
    const push_id = await queue(d.session, d.user_id, AD);
    await advance(a, POLL_MS, b);
    expect(await held(a)).toHaveLength(1);
    await advance(a, 8n * HOUR, b);
    expect(sends_to(a, 'fake:held-twice')).toHaveLength(1);
    expect((await record(a, push_id))?.sent_count).toBe(1n);
  });

  it('held pushes go push.sendBatchSize at a time between rounds of due records: a record due at the night window end goes after the first held batch', async () => {
    const server = await start({ settings: { 'push.sendBatchSize': 2 } });
    for (let n = 0; n < 5; n++) {
      const d = await device(server, { device_token: `fake:held-${String(n)}`, timezone_offset_ms: NIGHT_OFFSET });
      await set_push_consent(d.session, true, false);
      await queue(d.session, d.user_id, AD);
    }
    const due = await device(server, { device_token: 'fake:due-at-end' });
    const push_id = await queue(due.session, due.user_id, { message: '[push_plain]', send_at: START_AT + 8n * HOUR });
    await advance(server, POLL_MS);
    expect(await held(server)).toHaveLength(5);
    await advance(server, 8n * HOUR - 2n * POLL_MS);
    expect(fake(server, 'push-fcm').calls()).toEqual([]);
    await advance(server, POLL_MS);
    await advance(server, POLL_MS);
    const order = fake(server, 'push-fcm').calls().flatMap((c) => (c.input as Sent).tokens);
    expect(order).toHaveLength(6);
    expect(order.indexOf('fake:due-at-end')).toBe(2);
    expect(await held(server)).toEqual([]);
    expect((await record(server, push_id))?.status).toBe('SENT');
  });

  const adapter_failures = (server: TestServer): Record<string, unknown>[] => logs(server, 'error').filter((l) => l.message === 'push adapter failed');

  it('held pushes of one record that fail in two held batches leave one push adapter failed log for the record', async () => {
    const server = await start({ settings: { 'push.sendBatchSize': 2, 'push.retryMaxAttempts': 1 } });
    const users: bigint[] = [];
    const results: Record<string, string> = {};
    for (let n = 0; n < 3; n++) {
      const d = await device(server, { device_token: `fake:held-fail-${String(n)}`, timezone_offset_ms: NIGHT_OFFSET });
      await set_push_consent(d.session, true, false);
      users.push(d.user_id);
      results[`fake:held-fail-${String(n)}`] = 'FAILED';
    }
    fake(server, 'push-fcm').set_result('send', results);
    const push_id = await schedule(server, { message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT, target: { user_ids: users } });
    await advance(server, POLL_MS);
    expect(await held(server)).toHaveLength(3);
    await advance(server, 8n * HOUR);
    expect(await held(server)).toEqual([]);
    expect(fake(server, 'push-fcm').calls()).toHaveLength(3);
    expect((await record(server, push_id))?.failed_count).toBe(3n);
    expect(adapter_failures(server)).toHaveLength(1);
  });

  it('a held push that fails after its record logged an adapter failure that a retry ended does not log it again', async () => {
    const server = await start({ settings: { 'push.retryMaxAttempts': 2 } });
    const day = await device(server, { device_token: 'fake:day-retry' });
    const night = await device(server, { device_token: 'fake:night-fail', timezone_offset_ms: NIGHT_OFFSET });
    for (const d of [day, night]) await set_push_consent(d.session, true, false);
    fake(server, 'push-fcm').set_result('send', { 'fake:day-retry': 'FAILED' });
    const push_id = await schedule(server, { message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT, target: { user_ids: [day.user_id, night.user_id] } });
    await advance(server, POLL_MS);
    fake(server, 'push-fcm').set_result('send', { 'fake:day-retry': 'OK', 'fake:night-fail': 'FAILED' });
    await advance(server, RETRY_MS);
    expect(await record(server, push_id)).toEqual(expect.objectContaining({ status: 'SENT', sent_count: 1n, failed_count: 0n, held_count: 1n }));
    expect(adapter_failures(server)).toHaveLength(1);
    await advance(server, 8n * HOUR);
    await advance(server, RETRY_MS);
    expect(sends_to(server, 'fake:night-fail')).toHaveLength(2);
    expect((await record(server, push_id))?.failed_count).toBe(1n);
    expect(adapter_failures(server)).toHaveLength(1);
  });

  it('an Ad push whose text has an empty part leaves one push text has an empty part log for the record, after held pushes in two held batches too', async () => {
    // The ko translations have no title of the [push_ad_label] row.
    const ad = { '[push_ad]': { title: 'Sale', body: '{percent}% off' } };
    const settings = { supportedLanguages: ['en', 'ko'], 'push.sendBatchSize': 1 };
    const server = await start({ settings, files: translations(['ko'], ad, ['[push_ad_label_message]']) });
    const day = await device(server, { device_token: 'fake:ko-day', language: 'ko' });
    const nights = [
      await device(server, { device_token: 'fake:ko-night-0', language: 'ko', timezone_offset_ms: NIGHT_OFFSET }),
      await device(server, { device_token: 'fake:ko-night-1', language: 'ko', timezone_offset_ms: NIGHT_OFFSET }),
    ];
    for (const d of [day, ...nights]) await set_push_consent(d.session, true, false);
    const text_failures = (): number => logs(server, 'error').filter((l) => l.message === 'push text has an empty part').length;
    const push_id = await schedule(server, {
      message_id: message('[push_ad]'), args: [{ name: 'percent', value: { int_value: 5n } }], send_at: START_AT,
      target: { user_ids: [day.user_id, ...nights.map((d) => d.user_id)] },
    });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:ko-day').map((s) => [s.payload.title, s.payload.body])).toEqual([[' Sale', '5% off']]);
    expect(await held(server)).toHaveLength(2);
    expect(text_failures()).toBe(1);
    await advance(server, 8n * HOUR);
    expect(await held(server)).toEqual([]);
    // The held pushes go in user ID order, and user IDs are random.
    const night_tokens = [...nights].sort((x, y) => (x.user_id < y.user_id ? -1 : 1)).map((d) => [d.token]);
    expect(fake(server, 'push-fcm').calls().map((c) => (c.input as Sent).tokens)).toEqual([['fake:ko-day'], ...night_tokens]);
    expect((await record(server, push_id))?.sent_count).toBe(3n);
    expect(text_failures()).toBe(1);
  });

  it('nightStartMinute < nightEndMinute: local minute nightStartMinute is held, local minute nightEndMinute goes at once', async () => {
    const server = await start({ settings: { 'pushConsent.nightStartMinute': 600, 'pushConsent.nightEndMinute': 720 } });
    const at_start = await device(server, { device_token: 'fake:at-start', timezone_offset_ms: 2n * HOUR });
    const at_end = await device(server, { device_token: 'fake:at-end', timezone_offset_ms: 4n * HOUR });
    for (const d of [at_start, at_end]) {
      await set_push_consent(d.session, true, false);
      await queue(d.session, d.user_id, AD);
    }
    await advance(server, POLL_MS);
    expect((await held(server)).map((r) => r.user_id)).toEqual([at_start.user_id]);
    expect(sends_to(server, 'fake:at-start')).toEqual([]);
    expect(sends_to(server, 'fake:at-end')).toHaveLength(1);
  });

  it('nightStartMinute > nightEndMinute: local minute nightStartMinute is held, local minute nightEndMinute goes at once', async () => {
    const server = await start();
    const at_start = await device(server, { device_token: 'fake:22', timezone_offset_ms: 14n * HOUR });
    const at_end = await device(server, { device_token: 'fake:08', timezone_offset_ms: 0n });
    for (const d of [at_start, at_end]) {
      await set_push_consent(d.session, true, false);
      await queue(d.session, d.user_id, AD);
    }
    await advance(server, POLL_MS);
    expect((await held(server)).map((r) => r.user_id)).toEqual([at_start.user_id]);
    expect(sends_to(server, 'fake:08')).toHaveLength(1);
  });
});

describe('push text', () => {
  /** The core test data `push_message` row whose body is each fixture text. */
  const BODIES: Readonly<Record<string, string>> = {
    '{v}': '[push_fmt_plain]', '{v:n}': '[push_fmt_n]', '{v:ordinal}': '[push_fmt_ordinal]', '{v:duration}': '[push_fmt_duration]',
    '{v:date}': '[push_fmt_date]', '{v:datetime}': '[push_fmt_datetime]', '{v:plural:item/items}': '[push_fmt_plural]', '{v:으로/로}': '[push_fmt_euro]',
    '{v:이/가}': '[push_fmt_iga]', '{v:compact}': '[push_fmt_compact]', '{v}}': '[push_fmt_brace]',
  };

  it('for each int and string case of core test fixture text-format with an expected text, the push text of a device of that language and offset 0 is it', async () => {
    const cases = push_cases().filter((c) => c.expected !== null);
    const languages = [...new Set(['en', ...cases.map((c) => c.input.language)])];
    const server = await start({ settings: { supportedLanguages: languages }, files: translations(languages.filter((l) => l !== 'en')) });
    const sent: { token: string; expected: string; name: string }[] = [];
    for (const [n, c] of cases.entries()) {
      const id_name = BODIES[c.input.text];
      if (id_name === undefined) throw new Error(`no push_message body ${c.input.text}`);
      const token = `fake:case-${String(n)}`;
      const d = await device(server, { device_token: token, language: c.input.language });
      const arg = c.input.kind === 'int' ? { name: 'v', int_value: BigInt(c.input.value) } : { name: 'v', text_value: c.input.value };
      expect(await queue(d.session, d.user_id, { message: id_name, args: [arg] }), c.name).toBeGreaterThan(0n);
      sent.push({ token, expected: c.expected as string, name: c.name });
    }
    await advance(server, POLL_MS);
    for (const s of sent) expect({ name: s.name, body: sends_to(server, s.token).map((x) => x.payload.body) }).toEqual({ name: s.name, body: [s.expected] });
  });

  it('the {t:date} text of a device with timezone_offset_ms 9 hours is the text of t + 9 hours on a device with 0', async () => {
    const server = await start();
    const nine = await device(server, { device_token: 'fake:tz9', timezone_offset_ms: 9n * HOUR });
    const zero = await device(server, { device_token: 'fake:tz0' });
    const t = 1_704_484_800_000n;
    await queue(nine.session, nine.user_id, { message: '[push_when]', args: [{ name: 't', int_value: t }] });
    await queue(zero.session, zero.user_id, { message: '[push_when]', args: [{ name: 't', int_value: t + 9n * HOUR }] });
    await advance(server, POLL_MS);
    const body = (token: string): string | undefined => sends_to(server, token)[0]?.payload.body;
    expect(body('fake:tz9')).toBe('01/06/2024');
    expect(body('fake:tz9')).toBe(body('fake:tz0'));
  });

  it('a date whose year is not 1 to 9999 is an empty slot with one error log for the record', async () => {
    const server = await start();
    const a = await device(server, { device_token: 'fake:year-a' });
    const b = await device(server, { device_token: 'fake:year-b' });
    const push_id = await schedule(server, {
      message_id: message('[push_when]'), args: [{ name: 't', value: { int_value: 253_402_300_800_000n } }], send_at: START_AT,
      target: { user_ids: [a.user_id, b.user_id] },
    });
    await advance(server, POLL_MS);
    expect(sends_to(server, 'fake:year-a').map((s) => s.payload.body)).toEqual(['']);
    expect(logs(server, 'error').filter((l) => l.message === 'push text has an empty part')).toHaveLength(1);
    expect((await record(server, push_id))?.sent_count).toBe(2n);
  });
});

