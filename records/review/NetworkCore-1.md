# NetworkCore review round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 85f6b36d..1591f51a changes no file under `client/godot/core/network_core/` and no NetworkCore spec (`## spec changes` is `none`). The changes that NetworkCore reaches were checked:
  - `client/godot/core/time_core/time_core.gd`: the new frame step replaces the real frame increase only when `_frame_step_fps` > 0, and `get_monotonic_time`, `get_device_time` and `get_server_time`, which NetworkCore uses for `first_monotonic`, `first_device`, `sent_monotonic`, `received_monotonic` and `X-Ogw-Timestamp` (`client/godot/core/network_core/network_core.gd:459`, `:565`, `:617`, `:632`), do not follow it. `get_real_time`, which NetworkCore uses for the request timeout, the retry delay and the loading icon delay (`network_core.gd:616`, `:669`, `:737`), follows the frame step as `time-core.md` sets, and the retry delay is set in real elapsed time of `TimeCore` by `network-core.md` (retry delay). The new frame step state and random seed state are reset in `TimeCore._reset`, so the NetworkCore tests that release and init TimeCore see no frame step
  - `client/godot/core/log_core/log_core.gd`: only comments changed; `LogCore.set_sender` and `LogCore.clear_sender`, which NetworkCore calls, are unchanged
  - `client/godot/generated/contract/core_contract.gd`: the new `LogoutOtherDevicesRequest` is a `ContractRequest` of service Core with `is_retry` true and `new_response`, so `NetworkCore.send` and `send_auth` accept it through `_is_contract_request`; no `CoreError` value was added, so the failure flow table of `network-core.md` is unchanged. The `MatchmakerFrame` fields `forfeit` and `platform` are not used by NetworkCore
  - `server/core/routing/pipeline.ts`: only the clock of the `duration_ms` log field changed; the headers, signature and response envelope that NetworkCore follows are unchanged
- Not checked by a run: whether a movie maker run of `ogw instance` (`--write-movie` with `--fixed-fps`, which turns on the TimeCore frame step) that renders faster than real time makes `NetworkCore.requestTimeoutMs`, measured in real elapsed time, pass before the same wall time passes. `network-core.md` does not say in which time the request timeout is measured, and no instance was started in this review
- `ogw core test godot NetworkCore` on this checkout gave `pass`
- The NetworkCore code and tests that the range does not reach were not reviewed again in this round, because the range does not change them
