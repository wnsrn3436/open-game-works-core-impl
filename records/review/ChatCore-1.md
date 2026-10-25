# ChatCore review round 1

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

- The commit range 47b588d21afa1b2b68d070043d1523a0555507d3..bcdb38694a4ab234ebac674ecbfa5abdaeaaf8bb changes no ChatCore code, test or spec, and none of the modules in `## dependency` of the ChatCore spec (LogCore, EventCore, TimeCore, LocalDataCore, NetworkCore, BadgeCore). It changes only `client/godot/core/requirement_core/requirement_core.gd` (owner watch slots), `client/godot/core/qa_core/dev/qa_builtins.gd` (DEV `step` fails when game time is paused), `client/godot/core/bootstrap_core/bootstrap_core.gd:1125` (fatal screen font), their tests, and the records of agent runs mvnj8lgs4dacb1, mvnj8mijc042a0 and mvnjcqof1af8ae. No core settings, core spec or generated file is changed
- ChatCore source refers to none of the changed modules except a comment naming `BootstrapCore` (`client/godot/core/chat_core/chat_core.gd:172`). The ChatCore tests reach RequirementCore through `RequirementCore.init` (`client/godot/core/chat_core/tests/support/chat_test_case.gd:131`) and BadgeCore's `RequirementCore.evaluate` (`client/godot/core/badge_core/badge_core.gd:473`). The range changes only the owner watch path (`watch`, `_store_watch`, `_remove_watch_at`, `_on_frame`, `_reset`); BadgeCore and ChatCore do not call `RequirementCore.watch`, so `_owner_slots` stays empty in the ChatCore tests and the changed `_on_frame` loop does no work there. The expected RequirementCore error log in `client/godot/core/chat_core/tests/test_channel_poll.gd:154` comes from `evaluate`, which the range does not change. Read only, not checked by running the ChatCore tests
- ChatCore code and tests were not otherwise reviewed: they are not changed in the range and are not reached by the changes, so their pre-existing problems are outside this review
