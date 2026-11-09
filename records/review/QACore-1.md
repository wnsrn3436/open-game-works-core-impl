# QACore review round 1

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

- Commit range 625ae189..33de588d changes QACore in one place only: `client/godot/core/qa_core/dev/qa_core.gd:233-237` (commit ad967246). When `release` runs and QACore is not initialized, it now clears `_test_launch_values` and `_has_test_launch_values`. It calls no other module, leaves no log and ends no operation. That matches `## lifecycle` of the `core` skill (`skills/core/SKILL.md:73`) and `shutdown` step 3 of the BootstrapCore spec. Every QACore DEV operation (`run_command`, `register_command`, `set_content_state`, `mark`, `register_invariant`) fails before `init` through `_check_initialized`, and `is_headless` keeps no state (`qa_core.gd:358-447`). So QACore has no value set by an operation before `init`, and the test launch values are the only state left in that branch.
- Nothing in the defining documents requires a QACore test for the not-initialized `release` branch. The test launch values are private core test state that tests set directly; no spec operation sets them. The only QACore test that asserts these values are cleared, `test_release_clears_every_static_var` (`qa_core/tests/test_lifecycle.gd:177-178`), runs after an initialized `release`. I did not write this as a finding because no defining document makes it an observable behavior.
- The callers that this change reaches were checked: `before_each`/`after_each` of `qa_core/tests/support/qa_test_case.gd:60-96`, and the release-then-set-then-`init` order in `test_input.gd:302-306`, `test_render_capture.gd:72-78`, `test_channel.gd:48-51` and `test_frame_interval.gd:220`. No test sets the launch values and then reaches a not-initialized `release` before its `init`.
- `ogw core test godot QACore --file client/godot/core/qa_core/tests/test_lifecycle.gd` gave `pass`. The other QACore test files were not run, because this change reaches no code path in them except the order checked above.
- QACore code outside the commit range was not reviewed (the commit range is not `none`). The BootstrapCore side of commit ad967246 (`_shutdown`, `_release_entry`, `before_shutdown_release`, `test_boot_shutdown_pre_init.gd`) belongs to the BootstrapCore target and was read only to trace the call into `QACore.release`.
