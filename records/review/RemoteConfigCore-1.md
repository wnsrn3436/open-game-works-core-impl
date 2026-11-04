# review RemoteConfigCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/remote_config_core/tests/test_values.gd:83 | Input debt D1, still present: the test file is unchanged since the initial commit (`git log -- client/godot/core/remote_config_core/` shows only 301b3dd). `test_getters_do_not_allocate` compares only the current values of `Performance.OBJECT_COUNT` and `Performance.MEMORY_STATIC` before and after `_read_values(1000)`, so an allocation that is freed before the second read is not seen and the spec behavior `Getters do not allocate memory` is not checked. Reproduced on Godot 4.7.2 headless with the same measurement (warm-up 100 calls, read monitors, 1000 calls, read monitors) in a temporary project outside the checkout: a getter that returns `"x".repeat(1000).length()` on each call and a getter that makes a `RefCounted` and a `Dictionary` on each call both pass (objects 1480 -> 1480, static memory 24110893 -> 24110893) | Measure allocations that are freed within the read loop, e.g. compare `Performance.MEMORY_STATIC_MAX` (peak) before and after the loop or count allocations with a measurement that sees transient allocations, and show the test fails when a getter allocates a temporary string or object per call | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The test at client/godot/core/remote_config_core/tests/test_values.gd:83 is unchanged and still uses current-value monitors only; the allocating getters of the reproduction still pass on Godot 4.7.2 headless |

## must fix

none

## unknown

- The commit range e5585d8..e5585d8 is empty, so no changed code was reviewed; the review covered only input debt D1
- Whether `Performance.MEMORY_STATIC_MAX` or another monitor detects a transient per-call allocation in a release export of Godot was not checked; the suggested fix direction is not verified
