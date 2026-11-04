/** Message reports, operator deletion and listing, and message retention. */
import { stop_test_server, wait_background } from '../../testing/dev/index.ts';
import { admin, admin_list, E, got, K, later, reason, report_chat, rows, send_chat, sent, seqs, start, START_AT, users, type Harness } from './helpers.ts';

let h: Harness;

afterEach(async () => {
  await stop_test_server(h.server);
});

/** The `Open` reports of `list_reports` within an hour of `START_AT`. */
async function open_reports(): Promise<Record<string, unknown>[]> {
  const listed = await admin(h.server, 'list_reports', { status: 'Open', from_at: String(START_AT - 3_600_000n), to_at: String(START_AT + 3_600_000n), limit: 100 });
  expect(listed.status).toBe(200);
  return (listed.json as { reports: Record<string, unknown>[] }).reports;
}

function delete_world(seq: bigint): Promise<{ status: number; json: unknown }> {
  return admin(h.server, 'delete_chat_message', { channel_kind: 'World', key_a: '1', key_b: '0', seq: String(seq) });
}

describe('ReportChatMessage', () => {
  it('makes one report with the message text as evidence, refuses my own message with INVALID_REQUEST and a missing seq with CHAT_MESSAGE_NOT_FOUND', async () => {
    h = await start();
    const [a, b] = await users(h.server, 2);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'rude words here'));
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 1n)).code).toBe(0);
    expect((await report_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 1n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 7n)).code).toBe(E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND);
    const listed = await admin(h.server, 'list_reports', { status: 'Open', from_at: String(START_AT - 3_600_000n), to_at: String(START_AT + 3_600_000n), limit: 100 });
    expect(listed.status).toBe(200);
    const reports = (listed.json as { reports: Record<string, unknown>[] }).reports;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reporter_id: String(a.user_id),
      target_id: String(b.user_id),
      reason_id: reason(),
      evidence: 'rude words here',
      ref: 'CHAT_CHANNEL_KIND_WORLD:1:0:1',
      comment: '',
    });
  });

  it('refuses a deleted or expired message with CHAT_MESSAGE_NOT_FOUND', async () => {
    h = await start({ settings: { 'chat.retentionMs': 10_000 } });
    const [a, b] = await users(h.server, 2);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'one'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'two'));
    expect((await delete_world(1n)).status).toBe(200);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 1n)).code).toBe(E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND);
    later(h.server, 10_000n);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 2n)).code).toBe(E.CORE_ERROR_CHAT_MESSAGE_NOT_FOUND);
  });

  it('answers REPORT_LIMIT and makes no report once block-report.maxReportsPerWindow reports of the caller are in the window', async () => {
    h = await start({ settings: { 'block-report.maxReportsPerWindow': 1 } });
    const [a, b] = await users(h.server, 2);
    for (const text of ['one', 'two']) await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, text));
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 1n)).code).toBe(0);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 2n)).code).toBe(E.CORE_ERROR_REPORT_LIMIT);
    expect((await open_reports()).map((r) => r['ref'])).toEqual(['CHAT_CHANNEL_KIND_WORLD:1:0:1']);
  });

  it('answers INVALID_REQUEST and makes no report when add_report is INVALID_INPUT: a message text over block-report.maxEvidenceBytes or a reason_id with no report_reason row', async () => {
    h = await start({ settings: { 'block-report.maxEvidenceBytes': 4 } });
    const [a, b] = await users(h.server, 2);
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'longer than four bytes'));
    await sent(send_chat(b, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'four'));
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 1n)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 2n, 999_999)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await open_reports()).toEqual([]);
    expect((await report_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 2n)).code).toBe(0);
  });
});

describe('operator deletion and retention', () => {
  it('drops a message from GetChatMessages after delete_chat_message and lists it with deleted true; a missing message is not_found', async () => {
    h = await start();
    const [a, b] = await users(h.server, 2);
    for (const text of ['keep', 'remove']) await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, text));
    expect((await delete_world(2n)).status).toBe(200);
    expect(seqs(await got(b, K.CHAT_CHANNEL_KIND_WORLD, 1n))).toEqual([1n]);
    const listed = await admin_list(h.server, 'World', 1n, 0n);
    expect(listed.map((m) => [m.seq, m.text, m.deleted])).toEqual([
      ['1', 'keep', false],
      ['2', 'remove', true],
    ]);
    expect(listed[1]).toMatchObject({ kind: 'World', key_a: '1', key_b: '0', sender_id: String(a.user_id), message_kind: 'CHAT_MESSAGE_KIND_TEXT' });
    expect(await admin_list(h.server, 'World', 1n, 0n, 1n)).toHaveLength(1);
    const missing = await delete_world(9n);
    expect([missing.status, missing.json]).toEqual([404, { error: 'not_found' }]);
  });

  it('answers not_found to delete_chat_message of a message past chat.retentionMs that the expiry sweep has not deleted, and changes nothing', async () => {
    h = await start({ settings: { 'chat.retentionMs': 10_000, 'routing.storageSweepIntervalMs': 3_600_000 } });
    const [a] = await users(h.server, 1);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'old'));
    later(h.server, 10_000n);
    const expired = await delete_world(1n);
    expect([expired.status, expired.json]).toEqual([404, { error: 'not_found' }]);
    expect(rows(h.core(), 'SELECT seq, deleted FROM chat_message')).toEqual([{ seq: 1n, deleted: false }]);
    expect(rows(h.core(), 'SELECT seq FROM chat_deletion')).toEqual([]);
    expect(rows(h.core(), 'SELECT last_delete_seq FROM chat_channel')).toEqual([{ last_delete_seq: 0n }]);
  });

  it('leaves out of list_chat_messages a message past chat.retentionMs that the expiry sweep has not deleted, and keeps a deleted message', async () => {
    h = await start({ settings: { 'chat.retentionMs': 10_000, 'routing.storageSweepIntervalMs': 3_600_000 } });
    const [a] = await users(h.server, 1);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'old'));
    later(h.server, 5_000n);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'removed'));
    expect((await delete_world(2n)).status).toBe(200);
    later(h.server, 5_000n);
    expect((await admin_list(h.server, 'World', 1n, 0n)).map((m) => [m.seq, m.text, m.deleted])).toEqual([['2', 'removed', true]]);
    expect(rows(h.core(), 'SELECT seq FROM chat_message ORDER BY seq')).toHaveLength(2);
  });

  it('drops a message past chat.retentionMs from GetChatMessages and the expiry sweep deletes its row', async () => {
    h = await start({ settings: { 'chat.retentionMs': 10_000, 'routing.storageSweepIntervalMs': 60_000 } });
    const [a] = await users(h.server, 1);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'old'));
    later(h.server, 5_000n);
    await sent(send_chat(a, K.CHAT_CHANNEL_KIND_WORLD, 1n, 'new'));
    later(h.server, 5_000n);
    const response = await got(a, K.CHAT_CHANNEL_KIND_WORLD, 1n);
    expect([seqs(response), response.last_seq]).toEqual([[2n], 2n]);
    expect(rows(h.core(), 'SELECT seq FROM chat_message ORDER BY seq')).toHaveLength(2);
    later(h.server, 60_000n);
    await wait_background(h.server);
    expect(rows(h.core(), 'SELECT seq FROM chat_message ORDER BY seq')).toEqual([]);
  });
});
