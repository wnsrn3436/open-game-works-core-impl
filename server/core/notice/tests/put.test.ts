import { advance_time } from '../../testing/dev/index.ts';
import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { HOUR, START, admin, get_notices, notice_input, put, put_failure, server, shown_ids, stop_all } from './helpers.ts';

afterEach(stop_all);

const BAD = [400, 'bad_request'];

function without_operation_id(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'operation_id'));
}

describe('put_notice texts', () => {
  it('is bad_request when a supported language is missing from texts', async () => {
    const s = await server();
    expect(await put_failure(s, { texts: [{ language: 'en', title: 'Title', body: 'Body' }] })).toEqual(BAD);
  });

  it('is bad_request when a language appears twice in texts', async () => {
    const s = await server();
    const texts = [
      { language: 'en', title: 'Title', body: 'Body' },
      { language: 'en', title: 'Again', body: 'Body' },
      { language: 'ko', title: '제목', body: '본문' },
    ];
    expect(await put_failure(s, { texts })).toEqual(BAD);
    const swapped = [
      { language: 'en', title: 'Title', body: 'Body' },
      { language: 'en', title: 'Again', body: 'Body' },
    ];
    expect(await put_failure(s, { texts: swapped })).toEqual(BAD);
  });

  it('is bad_request for a language outside supportedLanguages', async () => {
    const s = await server();
    const texts = [
      { language: 'en', title: 'Title', body: 'Body' },
      { language: 'fr', title: 'Titre', body: 'Corps' },
    ];
    expect(await put_failure(s, { texts })).toEqual(BAD);
    expect(await shown_ids(s)).toEqual([]);
  });

  it('checks the plain text rules of title and body, with a line feed allowed only in body', async () => {
    const s = await server({ 'notice.maxTitleChars': 5, 'notice.maxBodyChars': 6 });
    const texts = (title: string, body: string): unknown[] => [
      { language: 'en', title, body },
      { language: 'ko', title: '제목', body: '본문' },
    ];
    expect(await put(s, { texts: texts('Hello', 'a\nb\nc') })).toBeGreaterThan(0n);
    expect(await put_failure(s, { texts: texts('Hello!', 'Body') })).toEqual(BAD);
    expect(await put_failure(s, { texts: texts('Hi', 'Body!!!') })).toEqual(BAD);
    expect(await put_failure(s, { texts: texts(' Hi', 'Body') })).toEqual(BAD);
    expect(await put_failure(s, { texts: texts('H\ni', 'Body') })).toEqual(BAD);
    expect(await put_failure(s, { texts: texts('Hi', 'a\tb') })).toEqual(BAD);
    expect(await put_failure(s, { texts: texts('Hi', '') })).toEqual(BAD);
    expect(await put_failure(s, { texts: texts('', 'Body') })).toEqual(BAD);
  });
});

describe('put_notice image_url origin', () => {
  it('takes only the cdnR2 publicBaseUrl origin when the server has one', async () => {
    const s = await server({ 'environments.<ENV>.cdnR2': { publicBaseUrl: 'https://cdn.example.com/game' } });
    expect(await put_failure(s, { image_url: 'https://other.example.com/a.png' })).toEqual(BAD);
    expect(await put_failure(s, { image_url: 'https://cdn.example.com:8443/a.png' })).toEqual(BAD);
    const id = await put(s, { image_url: 'https://cdn.example.com/notices/a.png' });
    expect((await get_notices(s)).notices.map((n) => [n.id, n.image_url])).toEqual([[id, 'https://cdn.example.com/notices/a.png']]);
    // link_url has no origin rule.
    expect(await put(s, { link_url: 'https://other.example.com/event' })).toBeGreaterThan(id);
  });

  it('takes any https image_url when the server has no cdnR2', async () => {
    const s = await server();
    expect(await put(s, { image_url: 'https://any.example.net/a.png' })).toBeGreaterThan(0n);
  });
});

describe('put_notice input rules', () => {
  it('is bad_request for a URL that is not https, has no host or has user info', async () => {
    const s = await server();
    for (const url of ['http://example.com/a.png', 'https://', 'https://user:pw@example.com/a', 'ftp://example.com/a', 'example.com/a']) {
      expect(await put_failure(s, { image_url: url })).toEqual(BAD);
      expect(await put_failure(s, { link_url: url })).toEqual(BAD);
    }
  });

  it('is bad_request when start_at is not before end_at', async () => {
    const s = await server();
    expect(await put_failure(s, { start_at: String(START), end_at: String(START) })).toEqual(BAD);
    expect(await put_failure(s, { start_at: String(START + 1n), end_at: String(START) })).toEqual(BAD);
  });

  it('is bad_request for an unknown platform, an unsupported target language or a malformed version', async () => {
    const s = await server();
    expect(await put_failure(s, { platforms: ['ps5'] })).toEqual(BAD);
    expect(await put_failure(s, { languages: ['fr'] })).toEqual(BAD);
    expect(await put_failure(s, { min_client_version: '1.2' })).toEqual(BAD);
    expect(await put_failure(s, { max_client_version: 'v1.2.3' })).toEqual(BAD);
  });

  it('is bad_request for a version limit with a part that starts with 0, as validation.parse_version reads none', async () => {
    const s = await server();
    expect(await put_failure(s, { min_client_version: '01.0.0' })).toEqual(BAD);
    expect(await put_failure(s, { max_client_version: '1.02.0' })).toEqual(BAD);
    expect(await put_failure(s, { min_client_version: '1.0.00' })).toEqual(BAD);
    expect((await admin(s, 'list_notices', {})).json).toEqual({ notices: [] });
    expect(await put(s, { min_client_version: '0.10.0', max_client_version: '10.0.0' })).toBe(1n);
  });

  it('is bad_request for a shortcut_id that is not a shortcut table ID', async () => {
    const s = await server();
    expect(await put_failure(s, { shortcut_id: 987654 })).toEqual(BAD);
  });

  it('takes a shortcut table ID as shortcut_id, and GetNotices gives it', async () => {
    const s = await server();
    const shortcut_id = GameDataDev.find_id_value('[shortcut_shop]');
    expect(shortcut_id).not.toBe(0);
    const id = await put(s, { shortcut_id });
    expect((await get_notices(s)).notices.map((n) => [n.id, n.shortcut_id])).toEqual([[id, shortcut_id]]);
  });

  it('is bad_request for a new notice when notice.maxStoredNotices notices remain', async () => {
    const s = await server({ 'notice.maxStoredNotices': 2 });
    const first = await put(s);
    await put(s);
    expect(await put_failure(s, {})).toEqual(BAD);
    // Changing a stored notice is not a new notice.
    expect(await put(s, { notice_id: String(first), priority: 9 })).toBe(first);
    expect((await admin(s, 'delete_notice', { notice_id: String(first) })).status).toBe(200);
    expect(await put(s)).toBeGreaterThan(first);
  });
});

describe('put_notice and delete_notice of a notice ID', () => {
  it('replaces the whole notice of a stored notice ID', async () => {
    const s = await server();
    const id = await put(s, { priority: 1, platforms: ['ios'] });
    const texts = [
      { language: 'en', title: 'New', body: 'Changed' },
      { language: 'ko', title: '새', body: '바뀜' },
    ];
    expect(await put(s, { notice_id: String(id), texts, end_at: String(START + 2n * HOUR) })).toBe(id);
    const [notice] = (await get_notices(s, { platform: 'android' })).notices;
    expect([notice?.id, notice?.title, notice?.priority, notice?.end_at]).toEqual([id, 'New', 0, START + 2n * HOUR]);
    const listed = (await admin(s, 'list_notices', {})).json as { notices: { notice_id: string; platforms: string[] }[] };
    expect(listed.notices.map((n) => [n.notice_id, n.platforms])).toEqual([[String(id), []]]);
  });

  it('is not_found for a notice ID that is not stored', async () => {
    const s = await server();
    expect(await put_failure(s, { notice_id: '999' })).toEqual([404, 'not_found']);
    expect((await admin(s, 'delete_notice', { notice_id: '999' })).status).toBe(404);
    const id = await put(s);
    expect((await admin(s, 'delete_notice', { notice_id: String(id) })).status).toBe(200);
    expect((await admin(s, 'delete_notice', { notice_id: String(id) })).status).toBe(404);
    expect(await put_failure(s, { notice_id: String(id) })).toEqual([404, 'not_found']);
    expect(await shown_ids(s)).toEqual([]);
  });

  it('lists the notices that are not deleted in notice_id order', async () => {
    const s = await server();
    const a = await put(s, { priority: 1 });
    const b = await put(s, { priority: 3 });
    const c = await put(s, { priority: 2 });
    expect((await admin(s, 'delete_notice', { notice_id: String(b) })).status).toBe(200);
    const listed = (await admin(s, 'list_notices', {})).json as { notices: { notice_id: string; kind: string; texts: unknown[] }[] };
    expect(listed.notices.map((n) => n.notice_id)).toEqual([String(a), String(c)]);
    expect(listed.notices[0]?.kind).toBe('Notice');
    expect(listed.notices[0]?.texts).toHaveLength(2);
  });

  it('lists each notice as its put_notice input without operation_id, plus updated_at', async () => {
    const s = await server();
    const input = notice_input({
      kind: 'Banner',
      priority: 5,
      start_at: String(START - HOUR),
      end_at: String(START + 3n * HOUR),
      platforms: ['ios', 'web'],
      languages: ['ko'],
      min_client_version: '1.2.3',
      max_client_version: '2.0.0',
      texts: [
        { language: 'en', title: 'Sale', body: 'Line one\nLine two' },
        { language: 'ko', title: '세일', body: '첫 줄\n둘째 줄' },
      ],
      image_url: 'https://img.example.com/sale.png',
      shortcut_id: GameDataDev.find_id_value('[shortcut_shop]'),
      link_url: 'https://example.com/sale',
    });
    const created = await admin(s, 'put_notice', input);
    expect(created.status).toBe(200);
    const id = (created.json as { notice_id: string }).notice_id;
    const fields = without_operation_id(input);
    expect((await admin(s, 'list_notices', {})).json).toEqual({ notices: [{ ...fields, notice_id: id, updated_at: String(START) }] });

    advance_time(s, HOUR);
    const changed = notice_input({ ...fields, notice_id: id, priority: 6, max_client_version: '' });
    expect((await admin(s, 'put_notice', changed)).status).toBe(200);
    expect((await admin(s, 'list_notices', {})).json).toEqual({ notices: [{ ...without_operation_id(changed), updated_at: String(START + HOUR) }] });
  });

  it('treats a notice whose end_at has passed as deleted', async () => {
    const s = await server({ 'notice.maxStoredNotices': 2 });
    const ended = await put(s);
    const kept = await put(s, { end_at: String(START + 2n * HOUR) });
    advance_time(s, HOUR);
    const listed = (await admin(s, 'list_notices', {})).json as { notices: { notice_id: string }[] };
    expect(listed.notices.map((n) => n.notice_id)).toEqual([String(kept)]);
    expect(await put_failure(s, { notice_id: String(ended), end_at: String(START + 2n * HOUR) })).toEqual([404, 'not_found']);
    expect((await admin(s, 'delete_notice', { notice_id: String(ended) })).status).toBe(404);
    // The ended notice is not in the notice.maxStoredNotices count.
    expect(await put(s, { start_at: String(START + HOUR), end_at: String(START + 2n * HOUR) })).toBe(kept + 1n);
  });
});
