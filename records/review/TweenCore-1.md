# review TweenCore round 1

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

- The range changes TweenCore only by removing `TweenCoreDev.set_finite_skip` and the finite skip (`client/godot/core/tween_core/tween_core.gd`, `client/godot/core/tween_core/tween_record.gd`, `client/godot/core/tween_core/tests/test_lifecycle.gd`, deleted `client/godot/core/tween_core/dev/` and `client/godot/core/tween_core/tests/test_finite_skip.gd`). `git diff 049dad61^ HEAD -- client/godot/core/tween_core/` is empty, and the commits 049dad61, e48141c2, f72b656a, f1de528b, c2eb4436 between them changed only the finite skip and its tests, so no fix of another behavior was reverted. The deleted tests check only the finite skip, which the spec no longer has (`## DEV` is `none`). No file in the checkout outside `records/` refers to `TweenCoreDev`, `set_finite_skip`, `finite_skip` or `skip_due`
- `ogw core test godot TweenCore` passed; its result was reused from the cache for the same key, so the tests were not run again in this review
- Code of TweenCore outside the range and unrelated to the removal was not checked as a whole, as the commit range limits findings to problems the changes cause or reveal
- The browser run (`--web`) of TweenCore was not run
