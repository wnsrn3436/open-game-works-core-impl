/**
 * auth's DEV code (`## DEV`): the core cheat `DevLogin`, table `auth_dev_account`, and the fake social adapters of
 * an instance with no fake adapter override.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { E, failure, tokenless_input, type RoutingTokenlessInput, type TokenlessOutput } from '../context.ts';
import type { Auth } from '../index.ts';
import { claim_key, complete_login, create_user } from '../login.ts';
import { DEV_ACCOUNT_TABLE, find_dev_account, insert_dev_account } from '../tables.ts';
import { create_fake_login_adapter } from './adapters/fake.ts';

export { create_fake_adapter, create_fake_login_adapter, FakeLoginAdapter, type FakeCall, type FakeFailure, type FakeOperation } from './adapters/fake.ts';

export interface AuthDev {
  DevLogin(input: RoutingTokenlessInput<CoreCheatContract.DevLoginRequest>): Promise<TokenlessOutput<CoreCheatContract.DevLoginResponse>>;
}

/** Fills auth's DEV slot and returns the `## DEV` operations. Call before server start. */
export function create_auth_dev(auth: Auth): AuthDev {
  auth.use_dev({ tables: [DEV_ACCOUNT_TABLE], fake_adapter: create_fake_login_adapter });
  const a = auth.state;
  return {
    async DevLogin(routing_input) {
      const input = tokenless_input(routing_input);
      const name = input.request.account_name;
      if (!new RegExp(`^[a-z0-9_]{1,${String(a.settings.max_dev_account_name_length)}}$`).test(name)) return failure(E.CORE_ERROR_INVALID_REQUEST);
      const { storage } = a.modules;
      let user_id = find_dev_account(storage.read_db(), name);
      let created = false;
      if (user_id === null) {
        const new_user = await create_user(a, input, 'core/cheat/DevLogin');
        if (typeof new_user !== 'bigint') return new_user;
        const owner = await claim_key(a, input, 'core/cheat/DevLogin', new_user, (db) => {
          insert_dev_account(db, new_user, name);
        }, (db) => find_dev_account(db, name));
        if (typeof owner !== 'bigint') return owner;
        user_id = owner;
        created = owner === new_user;
      }
      const output = await complete_login(a, input, {
        kind: 'core/cheat/DevLogin',
        user_id,
        created,
        provider: CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST,
        agreements: [],
        apple_refresh_token: null,
        token_hash: null,
      });
      if (!output.ok) return output;
      return { ...output, response: Object.assign(new CoreCheatContract.DevLoginResponse(), { result: output.response }) };
    },
  };
}
