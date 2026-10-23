extends VirtualPadTestCase
## `open_layout` and `close_layout`: abandoned waits, the same layout, another layout, scope release, layout format.

## A second `open_layout` of `start_open_retrying` ended.
signal retried

## Suffix of the result key of a second `open_layout` of `start_open_retrying`.
const RETRY: String = "#retry"

## Results of the `open_layout` calls `start_open` started, by resource key.
var results: Dictionary[String, String] = {}


## Starts `open_layout` of `key` with `open_scope`; `results[key]` gets `true` or `false` when it ends. Call without
## `await`.
func start_open(key: String, open_scope: Scope) -> void:
	results[key] = "pending"
	var ok: bool = await VirtualPadCore.open_layout(key, open_scope)
	results[key] = str(ok)


## Starts `open_layout` of `key` with the test scope; when it ends with `false`, its caller opens `retry_key` (`key`
## when empty) at once, inside the call that abandoned it. `results[key]` gets the first result,
## `results[key + RETRY]` the second. Call without `await`.
func start_open_retrying(key: String, retry_key: String = "") -> void:
	results[key] = "pending"
	var ok: bool = await VirtualPadCore.open_layout(key, scope)
	results[key] = str(ok)
	if ok:
		return
	results[key + RETRY] = "pending"
	ok = await VirtualPadCore.open_layout(key if retry_key.is_empty() else retry_key, scope)
	results[key + RETRY] = str(ok)
	retried.emit()


## Starts `open_layout` of `key` with the test scope; when it ends with `false`, its caller calls `close_layout` at
## once, inside the call that abandoned it. `results[key]` gets the result. Call without `await`.
func start_open_closing(key: String) -> void:
	results[key] = "pending"
	var ok: bool = await VirtualPadCore.open_layout(key, scope)
	results[key] = str(ok)
	if not ok:
		VirtualPadCore.close_layout()


func test_open_during_a_load_abandons_the_load() -> void:
	start_open(LAYOUT_FIXED, scope)
	assert_eq(results[LAYOUT_FIXED], "pending", "the load waits")
	var ok: bool = await VirtualPadCore.open_layout(LAYOUT_OTHER, scope)
	assert_true(ok)
	assert_eq(results[LAYOUT_FIXED], "false", "the abandoned open is false")
	assert_eq(VirtualPadCore._pad_key, LAYOUT_OTHER)
	await run_frames(5)
	assert_eq(VirtualPadCore._pad_key, LAYOUT_OTHER, "the abandoned load makes no virtual pad")
	assert_eq(safe_root().get_child_count(), 1)


func test_open_again_inside_the_abandoning_open_makes_one_virtual_pad() -> void:
	start_open_retrying(LAYOUT_FIXED)
	var ok: bool = await VirtualPadCore.open_layout(LAYOUT_OTHER, scope)
	assert_eq(results[LAYOUT_FIXED], "false", "the abandoned open is false")
	assert_false(ok, "the later open of the abandoned caller replaces this one")
	assert_eq(results[LAYOUT_FIXED + RETRY], "pending", "the retry waits for its load")
	await retried
	assert_eq(results[LAYOUT_FIXED + RETRY], "true", "the latest open makes the virtual pad")
	assert_eq(VirtualPadCore._pad_key, LAYOUT_FIXED)
	assert_eq(safe_root().get_child_count(), 1, "one virtual pad")
	assert_null(VirtualPadCore._waiter, "no load waits")
	VirtualPadCore.close_layout()
	await run_frames(5)
	assert_null(VirtualPadCore._pad)
	assert_eq(safe_root().get_child_count(), 0, "close_layout removes every layout")


func test_open_during_a_load_after_an_abandoned_retry_abandons_the_retry() -> void:
	start_open_retrying(LAYOUT_FIXED)
	assert_false(await VirtualPadCore.open_layout(LAYOUT_OTHER, scope))
	assert_eq(results[LAYOUT_FIXED + RETRY], "pending", "the retry waits for its load")
	VirtualPadCore.close_layout()
	assert_eq(results[LAYOUT_FIXED + RETRY], "false", "close_layout abandons the retry")
	await run_frames(5)
	assert_null(VirtualPadCore._pad, "the abandoned retry makes no virtual pad")
	assert_eq(safe_root().get_child_count(), 0)


func test_close_during_a_load_abandons_the_load() -> void:
	start_open(LAYOUT_FIXED, scope)
	VirtualPadCore.close_layout()
	assert_eq(results[LAYOUT_FIXED], "false")
	await run_frames(5)
	assert_null(VirtualPadCore._pad)


func test_open_of_a_cached_layout_inside_the_abandoning_close_keeps_its_virtual_pad() -> void:
	var cached: Resource = await ResourceCore.load(LAYOUT_OTHER, ResourceCore.BaseKind.PACKED_SCENE, scope)
	assert_true(ResourceCore.is_loaded(LAYOUT_OTHER, ResourceCore.BaseKind.PACKED_SCENE), "the retry key is cached")
	assert_not_null(cached)
	start_open_retrying(LAYOUT_FIXED, LAYOUT_OTHER)
	assert_eq(results[LAYOUT_FIXED], "pending", "the load waits")
	VirtualPadCore.close_layout()
	assert_eq(results[LAYOUT_FIXED], "false", "close_layout abandons the load")
	assert_eq(results[LAYOUT_FIXED + RETRY], "true", "the cached open inside close_layout ends at once")
	assert_eq(VirtualPadCore._pad_key, LAYOUT_OTHER, "close_layout leaves the virtual pad of the later open")
	assert_eq(safe_root().get_child_count(), 1, "one virtual pad")
	assert_ne(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	await run_frames(5)
	assert_eq(VirtualPadCore._pad_key, LAYOUT_OTHER, "the abandoned load makes no virtual pad")
	assert_eq(safe_root().get_child_count(), 1)
	assert_null(VirtualPadCore._waiter, "no load waits")


func test_open_of_an_uncached_layout_inside_the_abandoning_close_makes_its_virtual_pad() -> void:
	start_open_retrying(LAYOUT_FIXED, LAYOUT_OTHER)
	VirtualPadCore.close_layout()
	assert_eq(results[LAYOUT_FIXED], "false", "close_layout abandons the load")
	assert_eq(results[LAYOUT_FIXED + RETRY], "pending", "the retry waits for its load")
	await retried
	assert_eq(results[LAYOUT_FIXED + RETRY], "true", "the later open makes the virtual pad")
	assert_eq(VirtualPadCore._pad_key, LAYOUT_OTHER)
	assert_eq(safe_root().get_child_count(), 1, "one virtual pad")


func test_close_inside_the_abandoning_open_ends_that_open_with_false() -> void:
	start_open_closing(LAYOUT_FIXED)
	var ok: bool = await VirtualPadCore.open_layout(LAYOUT_OTHER, scope)
	assert_eq(results[LAYOUT_FIXED], "false", "the abandoned open is false")
	assert_false(ok, "the later close_layout of the abandoned caller replaces this open")
	await run_frames(5)
	assert_null(VirtualPadCore._pad, "no virtual pad")
	assert_eq(safe_root().get_child_count(), 0)
	assert_null(VirtualPadCore._waiter, "no load waits")


func test_same_key_and_scope_keeps_the_virtual_pad() -> void:
	await open(LAYOUT_FIXED)
	var pad: VirtualPadLayout = VirtualPadCore._pad
	touch(0, true, center_of(FIRE))
	assert_true(await VirtualPadCore.open_layout(LAYOUT_FIXED, scope))
	assert_eq(VirtualPadCore._pad, pad, "the same virtual pad")
	assert_true(InputCore.is_pressed(FIRE_ACTION), "the pressed action stays")
	assert_true(await VirtualPadCore.open_layout(LAYOUT_OTHER, scope))
	assert_false(InputCore.is_pressed(FIRE_ACTION), "release handling before the new virtual pad")
	assert_ne(VirtualPadCore._pad, pad)
	assert_eq(VirtualPadCore._pad_key, LAYOUT_OTHER)
	assert_eq(safe_root().get_child_count(), 1, "one virtual pad")


func test_another_scope_makes_a_new_virtual_pad() -> void:
	await open(LAYOUT_FIXED)
	var pad: VirtualPadLayout = VirtualPadCore._pad
	var other: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "virtual_pad_test_other")
	assert_true(await VirtualPadCore.open_layout(LAYOUT_FIXED, other))
	assert_ne(VirtualPadCore._pad, pad)
	assert_eq(VirtualPadCore._pad_scope, other)


func test_scope_release_closes_the_virtual_pad() -> void:
	var own: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "virtual_pad_test_own")
	assert_true(await VirtualPadCore.open_layout(LAYOUT_FIXED, own))
	touch(0, true, center_of(FIRE))
	touch(1, true, stick_point(Vector2(RADIUS, 0.0)))
	ResourceCore.release_scope(own)
	assert_null(VirtualPadCore._pad, "no virtual pad")
	assert_eq(safe_root().get_child_count(), 0)
	assert_false(InputCore.is_pressed(FIRE_ACTION))
	assert_true(no_direction())
	assert_eq(VirtualPadCore.get_state(), VirtualPadCore.VirtualPadState.HIDDEN)
	assert_eq(errors(), 0, "no VirtualPadCore error log")


func test_scope_release_during_the_load_ends_it_with_false() -> void:
	var own: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "virtual_pad_test_own")
	start_open(LAYOUT_FIXED, own)
	ResourceCore.release_scope(own)
	assert_eq(results[LAYOUT_FIXED], "false")
	await run_frames(5)
	assert_null(VirtualPadCore._pad)
	assert_eq(errors(), 0, "no VirtualPadCore error log")
	UnitTestCore.check_logs("warn", "ResourceCore")


func test_layout_prefab_elements() -> void:
	await open(LAYOUT_FIXED)
	var pad: VirtualPadLayout = VirtualPadCore._pad
	assert_eq(pad.get_parent(), safe_root(), "under the safe area root of the VirtualPad layer")
	assert_eq(pad.mouse_filter, Control.MOUSE_FILTER_IGNORE)
	assert_eq(element(STICK).mouse_filter, Control.MOUSE_FILTER_STOP, "an active element stops pointers")
	assert_eq(stick_base().mouse_filter, Control.MOUSE_FILTER_IGNORE, "the pictures do not take pointers")
	assert_eq((element(FIRE).get_child(0) as Control).mouse_filter, Control.MOUSE_FILTER_IGNORE)
	assert_almost_eq(area_of(element(FIRE)).end, safe_root().get_global_rect().end - Vector2(200.0, 200.0),
		Vector2(EPSILON, EPSILON), "the element area is anchored to the root over the safe area")
