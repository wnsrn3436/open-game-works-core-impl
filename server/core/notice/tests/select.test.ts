import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { standalone } from '../../validation/tests/standalone.ts';
import { choose_language, choose_notices, type CachedNotice, type NoticeChoiceSettings } from '../select.ts';

const NOW = 1_800_000_000_000n;

function notice(fields: Partial<CachedNotice> = {}): CachedNotice {
  return {
    id: 1n,
    kind: CoreContract.NoticeKind.NOTICE_KIND_NOTICE,
    priority: 0,
    start_at: NOW,
    end_at: NOW + 1_000n,
    platforms: [],
    languages: [],
    min_client_version: null,
    max_client_version: null,
    texts: [{ language: 'en', title: 'Title', body: 'Body' }],
    image_url: '',
    shortcut_id: 0,
    link_url: '',
    ...fields,
  };
}

const query = { language: 'ko', platform: 'android', client_version: '1.0.0', now: NOW };

const validation = standalone();

function choose(notices: CachedNotice[], q: typeof query, settings: NoticeChoiceSettings): ReturnType<typeof choose_notices> {
  return choose_notices(notices, q, settings, validation);
}

describe('supportedLanguages change', () => {
  it('gives the sourceLanguage text of a stored notice that has no text of a language added later', () => {
    // The notice was stored when supportedLanguages was [en]; ko is added after that.
    const stored = notice({ texts: [{ language: 'en', title: 'Title', body: 'Body' }] });
    const before = choose([stored], query, { supported_languages: ['en'], source_language: 'en', max_notices: 10 });
    const after = choose([stored], query, { supported_languages: ['en', 'ko'], source_language: 'en', max_notices: 10 });
    expect(before.map((n) => [n.title, n.body])).toEqual([['Title', 'Body']]);
    expect(after.map((n) => [n.title, n.body])).toEqual([['Title', 'Body']]);
  });

  it('chooses the added language for its target condition', () => {
    const stored = notice({ languages: ['ko'], texts: [{ language: 'en', title: 'Title', body: 'Body' }] });
    expect(choose([stored], query, { supported_languages: ['en'], source_language: 'en', max_notices: 10 })).toEqual([]);
    expect(choose([stored], query, { supported_languages: ['en', 'ko'], source_language: 'en', max_notices: 10 })).toHaveLength(1);
  });
});

describe('language and version choice', () => {
  it('chooses the supported spelling of the requested tag, else sourceLanguage', () => {
    const settings = { supported_languages: ['en', 'zh-Hant'], source_language: 'en', max_notices: 1 };
    expect(choose_language('ZH-HANT', settings)).toBe('zh-Hant');
    expect(choose_language('zh', settings)).toBe('en');
  });

  it('compares app versions with validation.compare_versions by integer parts', () => {
    const limited = notice({ min_client_version: validation.parse_version('1.9.0'), max_client_version: validation.parse_version('1.10.0') });
    expect(choose([limited], { ...query, client_version: '1.10.0' }, { supported_languages: ['en'], source_language: 'en', max_notices: 10 })).toHaveLength(1);
    expect(choose([limited], { ...query, client_version: '1.9.0' }, { supported_languages: ['en'], source_language: 'en', max_notices: 10 })).toHaveLength(1);
    expect(choose([limited], { ...query, client_version: '1.8.9' }, { supported_languages: ['en'], source_language: 'en', max_notices: 10 })).toEqual([]);
    expect(choose([limited], { ...query, client_version: '1.10.1' }, { supported_languages: ['en'], source_language: 'en', max_notices: 10 })).toEqual([]);
  });

  it('returns no notice for a maxNotices of 0', () => {
    expect(choose([notice()], query, { supported_languages: ['en'], source_language: 'en', max_notices: 0 })).toEqual([]);
  });
});
