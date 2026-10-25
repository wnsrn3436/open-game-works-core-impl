import { is_public_code_input as module_is_public_code_input, type Storage } from '../index.ts';
import { PUBLIC_CODE_CHARS } from '../public_code.ts';
import { new_db, new_user, request, started, stop_all, type DbTarget } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const CODE = new RegExp(`^[${PUBLIC_CODE_CHARS}]{8}$`);

function public_code(storage: Storage, user_id: bigint): string | null {
  const row = storage.read_db().query('SELECT public_code FROM "user" WHERE user_id = $1', [user_id])[0];
  return row === undefined ? null : (row.public_code as string | null);
}

async function set_public_code(storage: Storage, user_id: bigint, code: string | null): Promise<void> {
  await storage.run_game_transaction((tx) => storage.db(tx).query('UPDATE "user" SET public_code = $1 WHERE user_id = $2', [code, user_id]));
}

/** Starts on `db`, runs `fn`, stops. */
async function with_instance<T>(db: DbTarget, fn: (storage: Storage) => Promise<T> | T): Promise<T> {
  const i = started({ db });
  try {
    return await fn(i.storage);
  } finally {
    i.stop();
  }
}

describe('create_user', () => {
  it('1000 calls give different user IDs of 1 or more and below 2^53, no two of them 1 apart, and different 8-character public codes', async () => {
    const db = await new_db();
    await with_instance(db, async (s) => {
      const made = await s.run_game_transaction((tx) => ({ users: Array.from({ length: 1000 }, () => s.create_user(tx)) }));
      if (made === 'FAILED') throw new Error('create_user transaction failed');
      const ids = made.users.map((u) => u.user_id);
      for (const id of ids) {
        expect(id >= 1n).toBe(true);
        expect(id < 2n ** 53n).toBe(true);
      }
      expect(new Set(ids).size).toBe(1000);
      const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (let i = 1; i < sorted.length; i += 1) expect((sorted[i] as bigint) - (sorted[i - 1] as bigint)).not.toBe(1n);
      const codes = made.users.map((u) => u.public_code);
      for (const code of codes) expect(code).toMatch(CODE);
      expect(new Set(codes).size).toBe(1000);
      for (const user of made.users.slice(0, 10)) {
        expect(public_code(s, user.user_id)).toBe(user.public_code);
        expect(s.get_user_record(s.read_db(), user.user_id)?.public_code).toBe(user.public_code);
      }
    });
  });
});

describe('find_user_by_public_code', () => {
  it('finds a user by its code, in lowercase with -, with O, I, L for 0, 1, and a withdrawn user; none for 7 characters, a U and a code no user has', async () => {
    const db = await new_db();
    await with_instance(db, async (s) => {
      const user = await new_user(s);
      const withdrawn = await new_user(s);
      await set_public_code(s, user, 'AB01CD1Z');
      await request(s, withdrawn, (ctx) => {
        s.delete_user(ctx);
      });
      const withdrawn_code = public_code(s, withdrawn) as string;
      const db_handle = s.read_db();
      expect(s.find_user_by_public_code(db_handle, 'AB01CD1Z')).toBe(user);
      expect(s.find_user_by_public_code(db_handle, 'ab01-cd1z')).toBe(user);
      expect(s.find_user_by_public_code(db_handle, ' abOI-cdLz\n')).toBe(user);
      expect(s.find_user_by_public_code(db_handle, withdrawn_code.toLowerCase())).toBe(withdrawn);
      expect(s.get_user_record(db_handle, withdrawn)?.withdrawn_at).not.toBeNull();
      expect(s.find_user_by_public_code(db_handle, 'AB01CD1')).toBeNull();
      expect(s.find_user_by_public_code(db_handle, 'AB01CD1U')).toBeNull();
      expect(s.find_user_by_public_code(db_handle, 'AB01CD1Y')).toBeNull();
      // Only the characters the public code input names are changed: a full-width letter is not a code character.
      expect(s.find_user_by_public_code(db_handle, 'AB01CD1Ｚ')).toBeNull();
    });
  });
});

describe('is_public_code_input', () => {
  it('is true for a code, in lowercase with - and whitespace, and with O, I, L; false for 7 or 9 characters, a U, a full-width letter, the empty text and a non-text', async () => {
    const db = await new_db();
    await with_instance(db, (s) => {
      for (const text of ['AB01CD1Z', 'ab01-cd1z', ' abOI-cdLz\n', '\tAB01\r-CD1Z ']) expect(s.is_public_code_input(text)).toBe(true);
      for (const text of ['AB01CD1', 'AB01CD1ZZ', 'AB01CD1U', 'AB01CD1Ｚ', '', '--------', 'AB01_CD1Z']) expect(s.is_public_code_input(text)).toBe(false);
      expect(module_is_public_code_input(12345678)).toBe(false);
      expect(module_is_public_code_input(null)).toBe(false);
    });
  });
});

describe('get_user_record public_code', () => {
  it('is the empty string for a row whose public_code is null', async () => {
    const db = await new_db();
    await with_instance(db, async (s) => {
      const user = await new_user(s);
      await set_public_code(s, user, null);
      const record = s.get_user_record(s.read_db(), user);
      expect(record).not.toBeNull();
      expect(record?.public_code).toBe('');
      expect(s.find_user_by_public_code(s.read_db(), '')).toBeNull();
    });
  });
});

describe('public code fill at server start', () => {
  it('a user row whose public_code is null has a public code after server start, and a row with one keeps it', async () => {
    const db = await new_db();
    const users = await with_instance(db, async (s) => {
      const filled = await new_user(s);
      const empty = await new_user(s);
      await set_public_code(s, empty, null);
      expect(public_code(s, empty)).toBeNull();
      return { filled, empty, code: public_code(s, filled) };
    });
    await with_instance(db, (s) => {
      expect(public_code(s, users.filled)).toBe(users.code);
      expect(public_code(s, users.empty)).toMatch(CODE);
    });
  });

  it('two server starts give each null row one public code, the code stays after the second start, and the codes are different', async () => {
    const db = await new_db();
    const ids = await with_instance(db, async (s) => {
      const out: bigint[] = [];
      for (let i = 0; i < 20; i += 1) out.push(await new_user(s));
      await s.run_game_transaction((tx) => s.db(tx).query('UPDATE "user" SET public_code = NULL', []));
      return out;
    });
    const a = started({ db });
    const first = ids.map((id) => public_code(a.storage, id));
    const b = started({ db });
    try {
      const second = ids.map((id) => public_code(b.storage, id));
      for (const code of first) expect(code).toMatch(CODE);
      expect(second).toEqual(first);
      expect(new Set(first).size).toBe(ids.length);
    } finally {
      a.stop();
      b.stop();
    }
  });
});
