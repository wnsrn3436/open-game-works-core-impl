# review GameUpdateCore round 3

## findings

none

## previous

none (round 2 has no findings and no open rows)

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | fixed | none | `client/godot/core/game_update_core/tests/test_web_downloader.gd:35-36`, `:75-76` and `:97-98` now read `if not UnitTestCore.require_platform(PackedStringArray(["web"])): return`, so the web-only body (`_page_eval` of `window.ogwGameUpdateFetch`, the fetch downloader asserts) does not run outside `web`. `require_platform` returns `bool` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1531`, `false` and a skip reason when the platform is not in the list), as `open-game-works-core/skills/client-core/modules/unit-test-core.md:135` sets. Fixed in commit `8de72a8`. A native run `ogw core test godot GameUpdateCore --file client/godot/core/game_update_core/tests/test_web_downloader.gd` in this checkout ends with exit code 0 and 4 tests, none failed |

## must fix

none

## unknown

- The commit range `5434503..5434503` is empty and `## spec changes` is `none`, so no changed code was reviewed and the rest of the module was not reviewed again as a whole
- The job summary of the native run gives `tests: 4, passed: 4` and does not separate skips from passes. I did not open the run's result file to see the three web tests recorded as `skip`. I did not do a browser (`--web`) run of this file in this round
- I did not run `ogw core test` for the whole module or for the dependent modules (`BootstrapCore`, `QACore`, `UnitTestCore`)
