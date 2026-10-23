/**
 * The game contract of routing's core tests: the core test data has no `service Game` `rpc`, so the tests mock
 * the generated game contract with `rpc`s `Echo`, `Fail`, `Crash` and `Probe` (request `ResyncRequest`, response
 * `ResyncResponse`). `Echo` with `full` true fails its field validation. `GAME_ERROR_LISTED` is in the
 * `(ogw.core_errors)` of `core/ClaimMail`. `KINDS` adds the UserState kind `RoutingProbeUserState` while
 * `globalThis.routing_probe_kind` is true.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';

const GAME_ERROR_LISTED = 1001;
const GAME_ERROR_UNLISTED = 1002;

function rpc(name: string, errors: number[]): CoreContract.RpcInfo {
  return {
    name,
    request_class: CoreContract.ResyncRequest,
    response_class: CoreContract.ResyncResponse,
    silent: false,
    retry: false,
    sensitive: false,
    errors,
    validate: (message) => ((message as CoreContract.ResyncRequest).full ? { path: 'full', rule: 'routing_test' } : null),
  };
}

export const PROBE_KIND: CoreContract.KindInfo = {
  name: 'RoutingProbeUserState',
  kind_class: CoreContract.ResyncRequest,
  store: 'user_state',
  column: 'routing_probe_user_state',
  is_list: false,
  is_public: false,
};

export function mock_game_contract(actual: Record<string, unknown>): Record<string, unknown> {
  const kinds = actual.KINDS as readonly CoreContract.KindInfo[];
  return {
    ...actual,
    GameError: { GAME_ERROR_UNSPECIFIED: 0, GAME_ERROR_ROUTING_LISTED: GAME_ERROR_LISTED, GAME_ERROR_ROUTING_UNLISTED: GAME_ERROR_UNLISTED },
    RPCS: [rpc('Echo', []), rpc('Fail', [GAME_ERROR_LISTED]), rpc('Crash', []), rpc('Probe', [GAME_ERROR_LISTED])],
    CORE_ERRORS: new Map<string, readonly number[]>([['core/ClaimMail', [GAME_ERROR_LISTED]]]),
    get KINDS(): readonly CoreContract.KindInfo[] {
      return (globalThis as { routing_probe_kind?: boolean }).routing_probe_kind === true ? [...kinds, PROBE_KIND] : kinds;
    },
  };
}
