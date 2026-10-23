import { put, server, shown_ids, get_notices, stop_all } from './helpers.ts';

afterEach(stop_all);

describe('target conditions', () => {
  it('gives a platform notice only to clients on a listed platform', async () => {
    const s = await server();
    const id = await put(s, { platforms: ['ios', 'web'] });
    expect(await shown_ids(s, { platform: 'ios' })).toEqual([id]);
    expect(await shown_ids(s, { platform: 'web' })).toEqual([id]);
    expect(await shown_ids(s, { platform: 'android' })).toEqual([]);
  });

  it('gives an empty platforms notice to every platform', async () => {
    const s = await server();
    const id = await put(s, { platforms: [] });
    for (const platform of ['android', 'ios', 'web', 'windows', 'macos', 'linux']) expect(await shown_ids(s, { platform })).toEqual([id]);
  });

  it('gives a language notice only to clients whose chosen language is listed', async () => {
    const s = await server();
    const id = await put(s, { languages: ['ko'] });
    expect(await shown_ids(s, { language: 'ko' })).toEqual([id]);
    expect(await shown_ids(s, { language: 'en' })).toEqual([]);
    // An unsupported tag chooses the source language en, which is not listed.
    expect(await shown_ids(s, { language: 'fr' })).toEqual([]);
  });

  it('gives a version notice to app versions from min to max, both included, by integer parts', async () => {
    const s = await server();
    const id = await put(s, { min_client_version: '1.2.0', max_client_version: '1.10.5' });
    for (const version of ['1.2.0', '1.9.99', '1.10.0', '1.10.5']) expect(await shown_ids(s, { client_version: version })).toEqual([id]);
    for (const version of ['1.1.99', '1.10.6', '1.11.0', '2.0.0', '0.9.9']) expect(await shown_ids(s, { client_version: version })).toEqual([]);
  });

  it('applies an empty version limit as no limit', async () => {
    const s = await server();
    const min_only = await put(s, { min_client_version: '2.0.0', priority: 2 });
    const max_only = await put(s, { max_client_version: '1.0.0', priority: 1 });
    expect(await shown_ids(s, { client_version: '0.0.1' })).toEqual([max_only]);
    expect(await shown_ids(s, { client_version: '1.5.0' })).toEqual([]);
    expect(await shown_ids(s, { client_version: '99.0.0' })).toEqual([min_only]);
  });

  it('passes the version condition for a dev run client', async () => {
    const s = await server();
    const id = await put(s, { min_client_version: '5.0.0', max_client_version: '5.0.0' });
    expect(await shown_ids(s, { client_version: '' })).toEqual([id]);
    expect(await shown_ids(s, { client_version: '4.0.0' })).toEqual([]);
  });

  it('gives a notice only to a client that meets every condition', async () => {
    const s = await server();
    const id = await put(s, { platforms: ['ios'], languages: ['ko'], min_client_version: '1.0.0', max_client_version: '' });
    expect(await shown_ids(s, { platform: 'ios', language: 'ko', client_version: '1.0.0' })).toEqual([id]);
    expect(await shown_ids(s, { platform: 'android', language: 'ko', client_version: '1.0.0' })).toEqual([]);
    expect(await shown_ids(s, { platform: 'ios', language: 'en', client_version: '1.0.0' })).toEqual([]);
    expect(await shown_ids(s, { platform: 'ios', language: 'ko', client_version: '0.9.0' })).toEqual([]);
  });
});

describe('language', () => {
  it('gives the requested supported language text, ignoring ASCII case', async () => {
    const s = await server();
    await put(s);
    for (const language of ['ko', 'KO', 'Ko']) {
      const [notice] = (await get_notices(s, { language })).notices;
      expect([notice?.title, notice?.body]).toEqual(['제목', '본문']);
    }
    const [en] = (await get_notices(s, { language: 'EN' })).notices;
    expect([en?.title, en?.body]).toEqual(['Title', 'Body']);
  });

  it('gives the sourceLanguage text for an unsupported language', async () => {
    const s = await server();
    await put(s);
    for (const language of ['fr', 'ko-KR', '']) {
      const [notice] = (await get_notices(s, { language })).notices;
      expect([notice?.title, notice?.body]).toEqual(['Title', 'Body']);
    }
  });
});
