import { create_server, type CreateServerInput, type ServerInstance } from '../../routing/index.ts';

export type { CreateServerInput, KeySource, ServerInstance } from '../../routing/index.ts';

/** The environments a test server runs as (`### isolation`). */
export type TestEnvironment = 'LOCAL' | 'STG';

/** A key source failure (`server-core` `## adapter`). */
export type KeySourceFailure = 'timeout' | 'communication_failure';

/** Makes a server instance that has not started. */
export function new_server_instance(input: CreateServerInput): ServerInstance {
  return create_server(input);
}

/** A fake adapter and its fake adapter controller, as the module that defines the adapter makes them. */
export interface FakeAdapterPair {
  readonly adapter: unknown;
  readonly controller: unknown;
}

/** The adapter keys (`server-core` `## adapter`) and the module that defines their adapters. */
export const ADAPTER_OWNERS: Readonly<Record<string, string>> = {
  'login-apple': 'auth',
  'login-google': 'auth',
  'iap-apple': 'iap',
  'iap-google': 'iap',
  ads: 'ads-reward',
  'push-fcm': 'push',
  'push-apns': 'push',
  turn: 'p2p-signaling',
  cdn: 'game-update',
  analytics: 'logging',
};

interface FakeModule {
  create_fake_adapter(adapter_key: string): FakeAdapterPair;
}

/**
 * The fake adapter module of the module that owns an adapter key (`server-core` `## adapter`:
 * `<module>/dev/adapters/fake.ts`). It is loaded only for a module of the server module list.
 */
async function fake_module(owner: string): Promise<FakeModule> {
  return (await import(new URL(`../../${owner}/dev/adapters/fake.ts`, import.meta.url).href)) as FakeModule;
}

/** A new fake adapter of `adapter_key` and its controller. */
export async function new_fake_adapter(adapter_key: string): Promise<FakeAdapterPair> {
  const owner = ADAPTER_OWNERS[adapter_key];
  if (owner === undefined) throw new Error(`testing: ${adapter_key} is not an adapter key`);
  return (await fake_module(owner)).create_fake_adapter(adapter_key);
}
