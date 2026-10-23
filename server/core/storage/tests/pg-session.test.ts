import { setTimeout as real_wait } from 'node:timers/promises';
import { open_pg_session } from '../dev/index.ts';
import { DB_KIND, new_db } from './helpers.ts';

/** The PostgreSQL connection string of a new test DB. */
async function pg_connection(): Promise<string> {
  const url = (await new_db('postgresql')).secrets['db'];
  if (url === undefined) throw new Error('not a PostgreSQL test DB');
  return url;
}

describe.runIf(DB_KIND === 'postgresql')('open_pg_session (PostgreSQL)', () => {
  it('opens a connection of its own whose pid is its backend pid and runs statements with $n parameters', async () => {
    const connection = await pg_connection();
    const one = await open_pg_session(connection);
    const two = await open_pg_session(connection);
    try {
      expect(Number((await one.query('SELECT pg_backend_pid() AS pid'))[0]?.['pid'])).toBe(one.pid);
      expect(two.pid).not.toBe(one.pid);
      const rows = await one.query('SELECT CAST($1 AS BIGINT) + 1 AS n, $2::text AS s', [41n, 'x']);
      expect(rows).toEqual([{ n: 42n, s: 'x' }]);
    } finally {
      one.close();
      two.close();
    }
  });

  it('a lock of an open transaction waits other connections without a lock wait limit, and close ends that transaction', async () => {
    const connection = await pg_connection();
    const holder = await open_pg_session(connection);
    const waiter = await open_pg_session(connection);
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(CAST($1 AS BIGINT)) AS locked', [77n]);
      const waited = waiter.query('SELECT pg_advisory_lock(CAST($1 AS BIGINT)) AS locked', [77n]);
      const watcher = await open_pg_session(connection);
      try {
        for (let tries = 0; ; tries += 1) {
          const rows = await watcher.query('SELECT COUNT(*) AS n FROM pg_locks WHERE NOT granted AND pid = $1', [waiter.pid]);
          if (Number(rows[0]?.['n']) > 0) break;
          if (tries >= 2_000) throw new Error('the waiter did not wait for the lock');
          await real_wait(10);
        }
      } finally {
        watcher.close();
      }
      holder.close();
      await waited;
      expect(await waiter.query('SELECT pg_advisory_unlock(CAST($1 AS BIGINT)) AS unlocked', [77n])).toEqual([{ unlocked: true }]);
    } finally {
      holder.close();
      waiter.close();
    }
  });

  it('a failed statement rejects and the connection takes the next one', async () => {
    const session = await open_pg_session(await pg_connection());
    try {
      await expect(session.query('SELECT * FROM no_such_table')).rejects.toThrow();
      expect(await session.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    } finally {
      session.close();
    }
  });

  it('a failed connect rejects', async () => {
    const url = new URL(await pg_connection());
    url.pathname = '/ogw_no_such_database';
    await expect(open_pg_session(url.toString())).rejects.toThrow();
  });
});
