# review RequirementCore round 1

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

- The commit range 85f6b36d..6d910083 changes no file of `client/godot/core/requirement_core/`, `core-spec/RequirementCore.json`, `fixtures/requirement-evaluation.json`, the `requirement` code of the data tool or `server/core/validation/requirement.ts`, and the `RequirementCore.*` keys of `settings/core-settings.json` are unchanged. Input `## spec changes` is `none`.
- Changes in the range to modules RequirementCore depends on were checked for their effect on it: `client/godot/core/time_core/time_core.gd` (`make_random_seed`, the DEV frame step that changes the real increment of `_on_engine_frame` when no test clock is set) and `client/godot/core/log_core/log_core.gd` (comments only). RequirementCore reads elapsed time only through `TimeCore.get_real_time` (`client/godot/core/requirement_core/requirement_core.gd:770`, `:818`), so under the frame step the `RequirementCore.timeRecheckMs` recheck follows TimeCore real time, as the spec says. No problem found.
- The RequirementCore Godot core tests were not run: no finding needed a reproduction.
