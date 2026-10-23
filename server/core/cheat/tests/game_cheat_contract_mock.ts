/**
 * The game cheat contract of cheat's test server tests: the core test data has no `service Cheat` `rpc`, so the tests
 * mock the generated game cheat contract with the `rpc`s `Touch`, `Grant` and `Break` (request `SetTimeOffsetRequest`,
 * response `SetTimeOffsetResponse`), `SetMode` (request `SetModeRequest`, an enum field and an `int64` field), and
 * `SetTimeOffset` and `SetItemBalance`, which have the names of core cheats. `Break` lists `GAME_ERROR_CORE_TEST`.
 */
import type * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as Wire from '../../../generated/contract/wire.ts';

export const GAME_ERROR_CORE_TEST = 1000;

export const Mode = {
  MODE_NONE: 0,
  MODE_FAST: 1,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

/** A game cheat request with an enum and an `int64` field, as the contract tool makes it. */
export class SetModeRequest {
  mode: Mode = 0;
  count: bigint = 0n;

  encode(): Uint8Array {
    return Wire.encode(this, schema_SetModeRequest);
  }

  static decode(bytes: Uint8Array): SetModeRequest | null {
    return Wire.decode(bytes, schema_SetModeRequest);
  }

  to_json(): unknown {
    return Wire.to_json(this, schema_SetModeRequest);
  }

  static from_json(json: unknown): SetModeRequest | null {
    return Wire.from_json(json, schema_SetModeRequest);
  }
}

const schema_SetModeRequest: Wire.Schema<SetModeRequest> = {
  create: () => new SetModeRequest(),
  fields: [
    { no: 1, name: 'mode', kind: 'enum', repeated: false, values: Mode },
    { no: 2, name: 'count', kind: 'int64', repeated: false },
  ],
};

function rpc(name: string, core_name: string, errors: number[] = []): CoreContract.RpcInfo {
  const base = CoreCheatContract.RPCS.find((r) => r.name === core_name);
  if (base === undefined) throw new Error(`base proto has no ${core_name}`);
  return { ...base, name: `cheat/${name}`, errors, validate: null };
}

export const GAME_CHEAT_RPCS: readonly CoreContract.RpcInfo[] = [
  rpc('Touch', 'core/cheat/SetTimeOffset'),
  rpc('Grant', 'core/cheat/SetTimeOffset'),
  rpc('Break', 'core/cheat/SetTimeOffset', [GAME_ERROR_CORE_TEST]),
  { ...rpc('SetMode', 'core/cheat/SetTimeOffset'), request_class: SetModeRequest },
  rpc('SetTimeOffset', 'core/cheat/SetTimeOffset'),
  rpc('SetItemBalance', 'core/cheat/SetItemBalance'),
];

export function mock_game_cheat_contract(): Record<string, unknown> {
  return { RPCS: GAME_CHEAT_RPCS };
}
