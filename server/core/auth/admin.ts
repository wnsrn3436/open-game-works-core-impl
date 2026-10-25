/**
 * auth's admin operations (`## API` admin operation), in the TypeScript form of `admin-api`'s admin operation:
 * name, role, body form, input fields, `user_target` and the handler function.
 */
import type { AuthState } from './context.ts';
import { normalize_public_code } from '../storage/index.ts';
import type { Ctx, GameTx } from './deps.ts';
import { find_social_link } from './tables.ts';
import { withdraw } from './withdraw.ts';

export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** A field type of an admin operation input (`admin-api` `## API`). */
export type AdminFieldType = { readonly kind: 'int64' } | { readonly kind: 'string' } | { readonly kind: 'enum'; readonly elements: readonly string[] };

export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops' | 'economy' | 'release';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: AdminFieldType; readonly optional: boolean }>>;
  readonly user_target: string | null;
  /** The transaction is the target user's out-of-request ctx when `user_target` is set, else a game tx. */
  readonly handler: (input: Readonly<Record<string, unknown>>, transaction: Ctx | GameTx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

/** `withdraw_user`: the withdrawal in the target user's out-of-request change. */
export function withdraw_user(a: AuthState, ctx: Ctx): Record<string, unknown> | AdminFailure {
  return withdraw(a, ctx) === 'FAILED' ? 'internal' : {};
}

/** `find_user_by_social_account`: the linked user and `linked_at` of `(provider, provider_account_id)`. */
export function find_user_by_social_account(a: AuthState, input: Readonly<Record<string, unknown>>, tx: GameTx): Record<string, unknown> | AdminFailure {
  const { provider, provider_account_id } = input;
  if (typeof provider_account_id !== 'string' || provider_account_id === '') return 'bad_request';
  if (provider !== 'APPLE' && provider !== 'GOOGLE') return 'bad_request';
  const link = find_social_link(a.modules.storage.db(tx), `LOGIN_PROVIDER_${provider}`, provider_account_id);
  if (link === null) return 'not_found';
  return { user_id: link.user_id, linked_at: link.linked_at };
}

/** `find_user_by_public_code`: the user of a public code input and its `withdrawn_at` (a withdrawn user's included). */
export function find_user_by_public_code(a: AuthState, input: Readonly<Record<string, unknown>>, tx: GameTx): Record<string, unknown> | AdminFailure {
  const { storage } = a.modules;
  if (normalize_public_code(input.public_code) === null) return 'bad_request';
  const db = storage.db(tx);
  const user_id = storage.find_user_by_public_code(db, input.public_code as string);
  if (user_id === null) return 'not_found';
  return { user_id, withdrawn_at: storage.get_user_record(db, user_id)?.withdrawn_at ?? null };
}

export function admin_operations(a: AuthState): { withdraw_user: AdminOperation; find_user_by_social_account: AdminOperation; find_user_by_public_code: AdminOperation } {
  return {
    withdraw_user: {
      name: 'withdraw_user',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: { user_id: { type: { kind: 'int64' }, optional: false } },
      user_target: 'user_id',
      handler: (_input, ctx) => withdraw_user(a, ctx as Ctx),
      prepare: null,
      audit_args: null,
    },
    find_user_by_social_account: {
      name: 'find_user_by_social_account',
      role: 'read',
      body: 'json',
      max_body_bytes: null,
      input: { provider: { type: { kind: 'enum', elements: ['APPLE', 'GOOGLE'] }, optional: false }, provider_account_id: { type: { kind: 'string' }, optional: false } },
      user_target: null,
      handler: (input, tx) => find_user_by_social_account(a, input, tx),
      prepare: null,
      audit_args: null,
    },
    find_user_by_public_code: {
      name: 'find_user_by_public_code',
      role: 'read',
      body: 'json',
      max_body_bytes: null,
      input: { public_code: { type: { kind: 'string' }, optional: false } },
      user_target: null,
      handler: (input, tx) => find_user_by_public_code(a, input, tx),
      prepare: null,
      audit_args: null,
    },
  };
}
