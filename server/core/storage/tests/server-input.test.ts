import { DB_KIND, new_db, new_user, start_instance, type DbTarget } from './helpers.ts';

const SECRET_KEY = 'environments.<ENV>.secrets.db';

/** Starts with the given `server` fields and settings; the failure reason, or null after a start and a stop. */
function start(db: DbTarget, server: Parameters<typeof start_instance>[0]['server'], settings: Record<string, unknown> = {}): string | null {
  const i = start_instance({ db, server, settings });
  if (typeof i === 'string') return i;
  i.stop();
  return null;
}

describe('module input server', () => {
  it('--db postgresql reads the connection string through read_secret db; without it server start fails', async () => {
    const db = await new_db();
    const asked: string[] = [];
    const failure = start(db, {
      db: 'postgresql',
      read_secret: (name) => {
        asked.push(name);
        return null;
      },
    });
    expect(failure).toMatch(/db/);
    expect(asked).toEqual(['db']);
  });

  it('without --db the secret named by environments.<ENV>.secrets.db is read through read_secret; no name or no value fails server start', async () => {
    const db = await new_db();
    const asked: string[] = [];
    const read_secret = (name: string): string | null => {
      asked.push(name);
      return null;
    };
    expect(start(db, { env: 'DEV', db: null, read_secret }, { [SECRET_KEY]: 'pg_main' })).toMatch(/pg_main/);
    expect(asked).toEqual(['pg_main']);
    expect(start(db, { env: 'DEV', db: null, read_secret }, { [SECRET_KEY]: '' })).toMatch(/secrets\.db/);
    expect(asked).toEqual(['pg_main']);
  });

  it.runIf(DB_KIND === 'postgresql')('PostgreSQL: without --db the server starts on the connection string of the named secret', async () => {
    const db = await new_db();
    const i = start_instance({
      db,
      server: { env: 'DEV', db: null, read_secret: (name) => (name === 'pg_main' ? (db.secrets.db ?? null) : null) },
      settings: { [SECRET_KEY]: 'pg_main' },
    });
    if (typeof i === 'string') throw new Error(i);
    try {
      const user = await new_user(i.storage);
      expect(i.storage.get_user_record(i.storage.read_db(), user)).not.toBeNull();
    } finally {
      i.stop();
    }
  });
});
