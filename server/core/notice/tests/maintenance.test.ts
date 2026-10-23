import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { admin, get_notices, get_notices_envelope, put, server, stop_all } from './helpers.ts';

afterEach(stop_all);

describe('GetNotices without login', () => {
  it('handles GetNotices with no access token', async () => {
    const s = await server();
    const id = await put(s);
    const { status, envelope, response } = await get_notices_envelope(s);
    expect(status).toBe(200);
    expect(envelope?.error).toBeNull();
    expect(response?.maintenance).toBe(false);
    expect(response?.notices.map((n) => n.id)).toEqual([id]);
  });

  it('returns maintenance true and the Maintenance notice during maintenance', async () => {
    const s = await server();
    const notice = await put(s, { kind: 'Notice', priority: 1 });
    const maintenance = await put(s, {
      kind: 'Maintenance',
      texts: [
        { language: 'en', title: 'Maintenance', body: 'Back soon.\nThank you.' },
        { language: 'ko', title: '점검', body: '곧 돌아옵니다.' },
      ],
    });
    expect((await admin(s, 'set_maintenance', { enabled: true })).status).toBe(200);
    const response = await get_notices(s);
    expect(response.maintenance).toBe(true);
    expect(response.notices.map((n) => [n.id, n.kind])).toEqual([
      [notice, CoreContract.NoticeKind.NOTICE_KIND_NOTICE],
      [maintenance, CoreContract.NoticeKind.NOTICE_KIND_MAINTENANCE],
    ]);
    expect(response.notices[1]?.body).toBe('Back soon.\nThank you.');
    expect((await admin(s, 'set_maintenance', { enabled: false })).status).toBe(200);
    expect((await get_notices(s)).maintenance).toBe(false);
  });

  it('gives every Notice field', async () => {
    const s = await server();
    const id = await put(s, { kind: 'Banner', priority: 7, image_url: 'https://img.example.com/a.png', link_url: 'https://example.com/event' });
    const [notice] = (await get_notices(s)).notices;
    expect(notice?.id).toBe(id);
    expect(notice?.kind).toBe(CoreContract.NoticeKind.NOTICE_KIND_BANNER);
    expect(notice?.priority).toBe(7);
    expect(notice?.image_url).toBe('https://img.example.com/a.png');
    expect(notice?.link_url).toBe('https://example.com/event');
    expect(notice?.shortcut_id).toBe(0);
  });
});
