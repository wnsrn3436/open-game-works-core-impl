extends "res://core/resource_core/tests/support/resource_test_case.gd"
## `init`, `release`, the core node, the resource key list file and `set_test_key_list`.


## State of `ResourceCore` seen by `_on_typed_array_parse` when `init` parsed a typed array.
class _Parse:
	var is_int_array: bool = false
	var on_main_thread: bool = false
	var initialized: bool = false
	var has_node: bool = false
	var engine_loads: int = 0
	var loading: int = 0


var _parses: Array[_Parse] = []


func test_init_and_release() -> void:
	assert_false(ResourceCore.is_initialized())
	start()
	assert_true(ResourceCore.is_initialized())
	var node: Node = ResourceCore._node
	assert_true(node.is_inside_tree())
	var scope: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, scope))
	ResourceCore.add_scope_release_listener(_ignore_scope)
	assert_ne(ResourceCore.register_kind(Gradient, Gradient.new()), ResourceCore.INVALID_KIND)
	ResourceCore.release()
	assert_false(ResourceCore.is_initialized())
	assert_false(is_instance_valid(node) and node.is_inside_tree(), "core node left the tree")
	assert_eq(ResourceCore._session, null)
	assert_eq(ResourceCore._node, null)
	assert_eq(ResourceCore._warmup_holder, null)
	assert_true(ResourceCore._kinds.is_empty())
	assert_true(ResourceCore._key_list.is_empty())
	assert_true(ResourceCore._bundle_keys.is_empty())
	assert_true(ResourceCore._test_key_list.is_empty())
	assert_true(ResourceCore._test_variants.is_empty())
	assert_false(ResourceCore._has_test_key_list)
	assert_eq(ResourceCore._global_scope, null)
	assert_true(ResourceCore._scopes.is_empty())
	assert_true(ResourceCore._owner_scopes.is_empty())
	assert_true(ResourceCore._owner_watchers.is_empty())
	assert_true(ResourceCore._listeners.is_empty())
	assert_true(ResourceCore._cache.is_empty())
	assert_true(ResourceCore._loading.is_empty())
	assert_false(ResourceCore._run_loading_call.is_valid())
	assert_true(ResourceCore._waits.is_empty())
	assert_true(ResourceCore._warmups.is_empty())
	assert_true(ResourceCore._running_preloads.is_empty())
	assert_false(ResourceCore._bundles_applied)
	assert_false(ResourceCore._load_requested)
	assert_true(ResourceCore._logged.is_empty())
	assert_eq(ResourceCore._engine_load_count, 0)
	assert_false(ResourceCore._test_typed_array_parse_observer.is_valid())
	assert_true(ResourceCore._leaks.is_empty())
	assert_false(ResourceCore._leak_check_queued)
	assert_false(ResourceCore._leak_check.is_valid())
	assert_true(ResourceCore._cached_resources.is_empty())
	assert_true(ResourceCore._cached_dependencies.is_empty())
	assert_true(scope.released, "release leaves every scope released")
	start()
	var again: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, again))
	assert_eq(ResourceCore._engine_load_count, 1, "init after release works as the first init")
	assert_eq(ResourceCore._kinds.size(), ResourceCore.BaseKind.size(), "registered kinds are gone")


func test_init_of_an_initialized_module_fails() -> void:
	start()
	assert_false(ResourceCore.init())
	assert_errors(1)
	assert_true(ResourceCore.is_initialized())


func test_operations_before_init_and_after_release_fail() -> void:
	var scope: Scope = ResourceCore.get_global_scope()
	assert_true(scope.released)
	assert_null(await ResourceCore.load(ANIM_A, ANIMATION, scope))
	assert_null(ResourceCore.get_loaded(ANIM_A, ANIMATION, scope))
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION))
	assert_eq(ResourceCore.register_kind(Gradient, Gradient.new()), ResourceCore.INVALID_KIND)
	assert_false(await ResourceCore.preload_resources(PreloadRequest.new(), scope))
	var bundles: Array[DownloadedBundle] = []
	assert_false(ResourceCore.apply_bundles(bundles))
	assert_true(ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "lobby").released)
	var owner_node: Node = Node.new()
	assert_true(ResourceCore.get_owner_scope(owner_node).released)
	owner_node.free()
	assert_errors(8)
	start()
	ResourceCore.release()
	assert_null(ResourceCore.get_loaded(ANIM_A, ANIMATION, scope))
	assert_errors(1)


func test_core_node_freed_by_the_tree_cleans_up_like_release() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, scope))
	var owner_node: Node = Node.new()
	add_child_autofree(owner_node)
	var owner_scope: Scope = ResourceCore.get_owner_scope(owner_node)
	ResourceCore._node.free()
	assert_false(ResourceCore.is_initialized())
	assert_eq(ResourceCore._node, null)
	assert_true(ResourceCore._cache.is_empty())
	assert_true(scope.released)
	assert_true(owner_scope.released)
	assert_eq(owner_node.get_child_count(true), 0, "the watcher is gone")
	start()
	assert_true(ResourceCore.is_initialized())


func test_init_parses_a_typed_array_before_the_first_threaded_load() -> void:
	observe_parses()
	start()
	assert_eq(_parses.size(), 1, "init parsed a typed array once")
	assert_first_in_init(_parses[0])
	var scope: Scope = new_scope("lobby")
	var request: PreloadRequest = PreloadRequest.new()
	request.add_item(ANIM_A, ANIMATION)
	request.add_item(ANIM_B, ANIMATION)
	assert_true(await ResourceCore.preload_resources(request, scope))
	assert_eq(ResourceCore._engine_load_count, 2, "two threaded loads ran after the parse")
	assert_eq(_parses.size(), 1, "loads do not parse")
	ResourceCore.release()
	assert_false(ResourceCore._test_typed_array_parse_observer.is_valid(), "release clears the observer")
	observe_parses()
	start()
	assert_eq(_parses.size(), 1, "init after release parses again")
	assert_first_in_init(_parses[0])


func test_init_without_test_key_list_and_key_list_file_fails() -> void:
	assert_false(FileAccess.file_exists(KEY_LIST_FILE), "the core project has no resource key list file")
	observe_parses()
	assert_false(ResourceCore.init())
	assert_errors(1)
	assert_false(ResourceCore.is_initialized())
	assert_eq(ResourceCore._node, null)
	assert_eq(_parses.size(), 1, "init parsed a typed array before it read the key list file")
	assert_first_in_init(_parses[0])
	ResourceCore.release()
	assert_false(ResourceCore._test_typed_array_parse_observer.is_valid(), "release before init clears the observer")


func test_malformed_key_list_files_are_not_read() -> void:
	var cases: Dictionary[String, String] = {
		"not_json": "{",
		"not_object": "[]",
		"value_not_object": "{\"a\": 1}",
		"no_path": "{\"a\": {\"variants\": 1}}",
		"path_not_string": "{\"a\": {\"path\": 1, \"variants\": 1}}",
		"no_variants": "{\"a\": {\"path\": \"res://a.tres\"}}",
		"zero_variants": "{\"a\": {\"path\": \"res://a.tres\", \"variants\": 0}}",
		"fraction_variants": "{\"a\": {\"path\": \"res://a.tres\", \"variants\": 1.5}}",
	}
	for case_name: String in cases:
		var path: String = TEST_FOLDER + "/" + case_name + ".json"
		write_storage_file(path, cases[case_name])
		var keys: Dictionary[String, ResourceCore._KEY] = {}
		assert_false(ResourceCore._read_key_list(CoreBuildInfo.storage_root + path, keys), case_name)
	var valid_path: String = TEST_FOLDER + "/valid.json"
	write_storage_file(valid_path, "{\"a\": {\"path\": \"res://a.tres\", \"variants\": 1}, \"b\": {\"path\": \"res://b.ogg\", \"variants\": 3}}")
	var read: Dictionary[String, ResourceCore._KEY] = {}
	assert_true(ResourceCore._read_key_list(CoreBuildInfo.storage_root + valid_path, read))
	assert_eq(read.size(), 2)
	assert_false(ResourceCore._read_key_list(CoreBuildInfo.storage_root + TEST_FOLDER + "/none.json", read))


func test_set_test_key_list_before_init() -> void:
	var keys: Dictionary[String, String] = {"custom/key": RESOURCES + "test_animation_b.tres"}
	ResourceCoreDev.set_test_key_list(keys)
	assert_true(ResourceCore.init())
	var scope: Scope = new_scope("lobby")
	var animation: Animation = await load_animation("custom/key", scope)
	assert_eq(animation.resource_path, RESOURCES + "test_animation_b.tres")
	animation = null
	var other: Dictionary[String, String] = {"other/key": RESOURCES + "test_animation_a.tres"}
	ResourceCoreDev.set_test_key_list(other)
	assert_errors(1, "set_test_key_list after init")
	assert_true(ResourceCore._test_key_list.has("custom/key"), "the list did not change")
	assert_false(ResourceCore._key_list.has("other/key"))
	ResourceCore.release()
	assert_false(ResourceCore._has_test_key_list, "release clears the list")
	assert_false(ResourceCore.init(), "no list and no key list file")
	assert_errors(1)


func test_release_before_init_clears_the_test_key_list() -> void:
	var variants: Dictionary[String, int] = {ANIM_A: 2}
	ResourceCoreDev.set_test_key_list(key_paths(), variants)
	assert_true(ResourceCore._test_variants.has(ANIM_A))
	observe_parses()
	ResourceCore.release()
	assert_false(ResourceCore._test_typed_array_parse_observer.is_valid())
	assert_false(ResourceCore._has_test_key_list)
	assert_true(ResourceCore._test_key_list.is_empty())
	assert_true(ResourceCore._test_variants.is_empty())


func test_dev_lists() -> void:
	assert_true(ResourceCoreDev.list_loaded_resources().is_empty())
	assert_true(ResourceCoreDev.list_scopes().is_empty())
	assert_errors(2, "DEV lists before init")
	start()
	var scene: Scope = new_scope("lobby")
	var panel: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "shop")
	assert_not_null(await load_animation(ANIM_A, scene))
	assert_not_null(await load_animation(ANIM_A, panel))
	assert_not_null(await load_animation(ANIM_B, panel))
	var loaded: Dictionary[String, int] = ResourceCoreDev.list_loaded_resources()
	assert_eq(loaded.size(), 2)
	assert_eq(loaded[ANIM_A], 2)
	assert_eq(loaded[ANIM_B], 1)
	var scopes: Array[Scope] = ResourceCoreDev.list_scopes()
	assert_eq(scopes.size(), 3)
	assert_true(scopes[0] == ResourceCore.get_global_scope())
	assert_true(scopes[1] == scene)
	assert_true(scopes[2] == panel)
	ResourceCore.release_scope(panel)
	assert_eq(ResourceCoreDev.list_scopes().size(), 2, "released scopes are not listed")


func _ignore_scope(_scope: Scope) -> void:
	pass


## Records each typed array parse of `init` in `_parses`.
func observe_parses() -> void:
	_parses = []
	ResourceCore._test_typed_array_parse_observer = _on_typed_array_parse


## Checks that `parse` was a typed `int` array parsed on the main thread before any other step of `init` and before
## any engine load.
func assert_first_in_init(parse: _Parse) -> void:
	assert_true(parse.is_int_array, "the parsed value is an Array[int]")
	assert_true(parse.on_main_thread, "the parse ran on the main thread")
	assert_false(parse.initialized, "the parse ran before init finished")
	assert_false(parse.has_node, "the parse ran before init made the core node")
	assert_eq(parse.engine_loads, 0, "the parse ran before any engine load")
	assert_eq(parse.loading, 0, "no threaded load was in progress")


func _on_typed_array_parse(parsed: Array[int]) -> void:
	var parse: _Parse = _Parse.new()
	parse.is_int_array = parsed.is_typed() and parsed.get_typed_builtin() == TYPE_INT
	parse.on_main_thread = OS.get_thread_caller_id() == OS.get_main_thread_id()
	parse.initialized = ResourceCore._is_initialized
	parse.has_node = ResourceCore._node != null
	parse.engine_loads = ResourceCore._engine_load_count
	parse.loading = ResourceCore._loading.size()
	_parses.append(parse)
