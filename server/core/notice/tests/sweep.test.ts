/**
 * `put_notice` and `delete_notice` of a notice that `sweep_expired` deletes after the operation started. The sweep takes
 * no `lock_game_row` lock, so the row can be gone at the write statement although an earlier read in the same
 * transaction saw it. The DB handle here answers every read of `notice_notice` with the live row and every write with
 * no changed row, the state after the sweep committed between the two.
 */
import type { AdminTransaction } from '../../admin-api/index.ts';
import type { DbHandle } from '../../storage/index.ts';
import { standalone } from '../../validation/tests/standalone.ts';
import { create_notice, type NoticeModule } from '../index.ts';
import { HOUR, START } from './helpers.ts';

const TX = {} as AdminTransaction;
const NOTICE_ID = 7n;

interface Fake {
  readonly notice: NoticeModule;
  /** The statements of the handler, in order. */
  readonly statements: string[];
  /** How many `after_commit` functions the handler registered. */
  readonly after_commits: () => number;
}

function fake(): Fake {
  const statements: string[] = [];
  let after_commits = 0;
  const db = {
    query(sql: string): Record<string, unknown>[] {
      statements.push(sql);
      if (/^SELECT\b.*\bFROM notice_notice\b/.test(sql)) return [{ notice_id: NOTICE_ID }];
      return [];
    },
  } as unknown as DbHandle;
  const modules = {
    'admin-api': { is_maintenance: () => false },
    validation: standalone(),
    storage: {
      register_table: () => undefined,
      db: () => db,
      read_db: () => db,
      lock_game_row: () => undefined,
      after_commit: () => {
        after_commits += 1;
      },
    },
    'server-time': { clock_now: () => START, schedule_job: () => undefined },
    logging: { write: () => undefined },
  };
  const settings = {
    supportedLanguages: ['en'],
    sourceLanguage: 'en',
    'notice.maxNotices': 20,
    'notice.maxStoredNotices': 100,
    'notice.maxTitleChars': 50,
    'notice.maxBodyChars': 500,
    'notice.cacheMs': 60_000,
  };
  return { notice: create_notice({ settings, modules, server: null }), statements, after_commits: () => after_commits };
}

function put_input(): Record<string, unknown> {
  return {
    operation_id: 'op-sweep',
    notice_id: NOTICE_ID,
    kind: 'Notice',
    priority: 0,
    start_at: START,
    end_at: START + HOUR,
    platforms: [],
    languages: [],
    min_client_version: '',
    max_client_version: '',
    texts: [{ language: 'en', title: 'Title', body: 'Body' }],
    image_url: '',
    shortcut_id: 0,
    link_url: '',
  };
}

describe('notice row deleted by sweep_expired during the operation', () => {
  it('put_notice replacing it is not_found and leaves the cache as it is', () => {
    const f = fake();
    expect(f.notice.put_notice.handler(put_input(), TX, null, null)).toBe('not_found');
    expect(f.statements.some((sql) => sql.startsWith('UPDATE notice_notice'))).toBe(true);
    expect(f.after_commits()).toBe(0);
  });

  it('delete_notice of it is not_found and leaves the cache as it is', () => {
    const f = fake();
    expect(f.notice.delete_notice.handler({ notice_id: NOTICE_ID }, TX, null, null)).toBe('not_found');
    expect(f.statements.some((sql) => sql.startsWith('DELETE FROM notice_notice'))).toBe(true);
    expect(f.after_commits()).toBe(0);
  });
});
