# review RemoteConfigCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | bcbab79 changed client/godot/core/remote_config_core/tests/test_values.gd:83 (`test_getters_do_not_allocate`): a `PackedByteArray` ballast is resized to `MEMORY_STATIC_MAX - MEMORY_STATIC + 1` after the warm-up, so static memory is at its peak before the 1000 measured reads, and the new assert `peak_after <= peak` fails on any allocation made inside the loop, even one freed before it ends. I restored the defect in a temporary copy of the Godot core project outside the checkout (a copy of `client/godot` of `open-game-works-core-impl/` at 80e5f7c, which has GUT installed). I ran GUT headless on Godot 4.7.2 with `-gtest=res://core/remote_config_core/tests/test_values.gd -gunit_test_name=test_getters_do_not_allocate`. The unchanged code passed 8 runs out of 8, and the whole `test_values.gd` passed (8/8 tests). Each of three restorations failed the test with `[Failed]: static memory peak: no allocation freed inside the loop` (asserts 34/35, the two current-value asserts still passed): (a) `var _tmp: String = "a" + str(key_id)` added to `get_int` before the `_ints` lookup; (b) `var _tmp: RefCounted = RefCounted.new()` added there instead; (c) `get_string` returning `_strings[key_id] + ""` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The test at client/godot/core/remote_config_core/tests/test_values.gd:83 now also checks the `MEMORY_STATIC_MAX` peak over the measured loop. Per-call temporary string and `RefCounted` allocations in a getter, which the debt item's reproduction let pass, now fail the test (see R1-1 in `## previous`) |

## must fix

none

## unknown

- The restoration runs used a stub test host that answers every request with HTTP 200 and `{}`. UnitTestCore logged `test host request ... failed` for `PUT /started`, `/result` and `/released`, and the process exit code was 1 in every run. I judged pass or fail from the GUT output (`Passing Tests`, `[Failed]` lines), not from the result file the tool's test host receives
- The browser run (`--web`) was not run for the restorations. Only the native headless run was checked
- A release export was not measured. Static memory tracking exists only in builds with `DEBUG_ENABLED`, so the peak assert works only in the editor binary and DEV exports. The test's `memory > 0` assert makes such a build fail instead of passing
- Whether another engine thread can allocate during the measured loop and make the peak assert flaky was not checked beyond 8 consecutive native passing runs
