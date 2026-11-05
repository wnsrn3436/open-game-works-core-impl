# review RealtimeCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit c3dbc93 added `test_match_rejoined_after_a_failed_connect_peer_offers_again_without_peer_lost` (client/godot/core/realtime_core/tests/test_p2p.gd:888): itself at index 0, `connect_peer`(1) fails at start through `_FailingTransport.fails_start`, the next `poll` reads `MATCH_REJOINED` `ok` `true` of the same match, and the test asserts no peer lost, no warn log, one peer connected of index 1 and one offer with attempt number 2. Defect restored in a temporary git worktree of HEAD 752a9a4 outside the target checkout (worktrees/_core/review-r2-proof-rt, removed afterwards): `_restart_offers` condition in client/godot/core/realtime_core/p2p_realtime_transport.gd:457 changed from `_my_index > index` back to `not peer.is_offerer`. `ogw core test godot RealtimeCore --file client/godot/core/realtime_core/tests/test_p2p.gd` then failed only on the new test (`[1] expected to equal [0]` peer lost, `[1] expected to equal [0]` warn log, `ARRAY([]) != ARRAY([2])` offer attempts, `test time limit 30000 ms passed`). With the condition restored in the same copy, the same run passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The `--web` run of the new test was not run in this review; only the native Godot run was run (with and without the restored defect).
- client/godot/dev/generated/data/game_data_dev.gd (two added IAP ID names of the core test data) is in the commit range but is a generated file of the core test data build, not RealtimeCore code; it was only read.
- The other changes in the commit range (UICore, LocalizationCore, ShortcutCore tests, mailbox, iap) belong to modules outside RealtimeCore and are not in its dependencies; they were not reviewed.
