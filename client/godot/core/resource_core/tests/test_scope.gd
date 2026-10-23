extends "res://core/resource_core/tests/support/resource_test_case.gd"
## Scope release order, release listeners, owner scopes and scope errors.

var _calls: Array[String] = []
var _seen_released: Array[bool] = []
var _seen_fallback: Array[bool] = []
var _seen_reference_count: Array[int] = []
var _scope_a: Scope = null
var _scope_b: Scope = null


func before_each() -> void:
	super()
	_calls = []
	_seen_released = []
	_seen_fallback = []
	_seen_reference_count = []
	_scope_a = null
	_scope_b = null


func test_listeners_run_in_order_before_the_references_drop() -> void:
	start()
	var scope: Scope = new_scope("lobby")
	assert_not_null(await load_animation(ANIM_A, scope))
	ResourceCore.add_scope_release_listener(_first_listener)
	ResourceCore.add_scope_release_listener(_second_listener)
	ResourceCore.add_scope_release_listener(_removed_listener)
	ResourceCore.remove_scope_release_listener(_removed_listener)
	ResourceCore.release_scope(scope)
	assert_eq(_calls, ["first:lobby", "second:lobby"] as Array[String])
	assert_eq(_seen_released, [true] as Array[bool], "released is true in the listener")
	assert_eq(_seen_fallback, [true] as Array[bool], "get_loaded of the releasing scope is the fallback")
	assert_eq(_seen_reference_count, [1] as Array[int], "the reference is still there in the listener")
	assert_errors(1, "the get_loaded with the releasing scope")
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION))


func test_listener_releasing_another_scope() -> void:
	start()
	_scope_a = new_scope("a")
	_scope_b = new_scope("b")
	assert_not_null(await load_animation(ANIM_A, _scope_a))
	assert_not_null(await load_animation(ANIM_B, _scope_b))
	ResourceCore.add_scope_release_listener(_nesting_listener)
	ResourceCore.add_scope_release_listener(_second_listener)
	ResourceCore.add_scope_release_listener(_removed_listener)
	ResourceCore.release_scope(_scope_a)
	assert_eq(
		_calls,
		["nesting:a", "nesting:b", "second:b", "removed:b", "second:a"] as Array[String],
		"b releases inside the listener; a keeps its list; the removed and added listeners skip a"
	)
	assert_eq(_seen_released, [true] as Array[bool], "b is released before the listener returns")
	assert_eq(_seen_fallback, [true] as Array[bool], "the resource only b held left the cache")
	assert_true(_scope_a.released)
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION))
	_calls = []
	ResourceCore.release_scope(new_scope("c"))
	assert_eq(_calls, ["nesting:c", "second:c", "added:c"] as Array[String], "the added listener runs later")


func test_registered_listener_again_is_ignored() -> void:
	start()
	ResourceCore.add_scope_release_listener(_first_listener)
	ResourceCore.add_scope_release_listener(_first_listener)
	assert_errors(1)
	ResourceCore.release_scope(new_scope("lobby"))
	assert_eq(_calls, ["first:lobby"] as Array[String])
	assert_errors(1, "the get_loaded in the listener")


func test_owner_scope() -> void:
	start()
	var owner_node: Node = Node.new()
	owner_node.name = "Hero"
	add_child(owner_node)
	var scope: Scope = ResourceCore.get_owner_scope(owner_node)
	assert_false(scope.released)
	assert_eq(scope.kind, ResourceCore.ScopeKind.OWNER)
	assert_eq(scope.name, "Hero")
	assert_true(ResourceCore.get_owner_scope(owner_node) == scope, "the same scope for the same owner")
	assert_eq(owner_node.get_children().size(), 0, "the watcher is an internal child")
	assert_not_null(await load_animation(ANIM_A, scope))
	ResourceCore.add_scope_release_listener(_count_listener)
	owner_node.free()
	assert_true(scope.released, "destroying the owner releases the scope")
	assert_eq(_calls, ["count:Hero"] as Array[String])
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION))


func test_end_owner_scope() -> void:
	start()
	var owner_node: Node = Node.new()
	owner_node.name = "Pooled"
	add_child_autofree(owner_node)
	var scope: Scope = ResourceCore.get_owner_scope(owner_node)
	ResourceCore.add_scope_release_listener(_count_listener)
	ResourceCore.end_owner_scope(owner_node)
	assert_true(scope.released)
	assert_eq(_calls, ["count:Pooled"] as Array[String], "the listener ran once")
	assert_eq(owner_node.get_child_count(true), 0, "the watcher is gone")
	ResourceCore.end_owner_scope(owner_node)
	assert_eq(_calls.size(), 1, "end_owner_scope without an owner scope does nothing")
	var next: Scope = ResourceCore.get_owner_scope(owner_node)
	assert_false(next.released)
	assert_false(next == scope, "a new scope after the release")
	remove_child(owner_node)
	owner_node.free()
	assert_true(next.released)
	assert_eq(_calls.size(), 2)


func test_get_owner_scope_in_a_listener_of_the_owner_scope_release_is_the_releasing_scope() -> void:
	start()
	var seen: Array[Scope] = []
	for destroy: bool in [false, true]:
		var owner_node: Node = Node.new()
		add_child(owner_node)
		var scope: Scope = ResourceCore.get_owner_scope(owner_node)
		var listener: Callable = func(released: Scope) -> void:
			if released == scope:
				ResourceCore.end_owner_scope(owner_node)
				seen.append(ResourceCore.get_owner_scope(owner_node))
		ResourceCore.add_scope_release_listener(listener)
		_calls = []
		ResourceCore.add_scope_release_listener(_count_listener)
		if destroy:
			owner_node.free()
		else:
			ResourceCore.end_owner_scope(owner_node)
		ResourceCore.remove_scope_release_listener(listener)
		ResourceCore.remove_scope_release_listener(_count_listener)
		assert_eq(seen.size(), 1, "destroy %s" % destroy)
		assert_true(seen[0] == scope and scope.released, "the releasing scope, destroy %s" % destroy)
		assert_eq(_calls.size(), 1, "end_owner_scope of the releasing scope does nothing, destroy %s" % destroy)
		seen.clear()
		if not destroy:
			var next: Scope = ResourceCore.get_owner_scope(owner_node)
			assert_false(next.released, "a new scope after the release ends")
			assert_eq(owner_node.get_child_count(true), 1, "one watcher")
			remove_child(owner_node)
			owner_node.free()
	assert_true(ResourceCore._owner_scopes.is_empty())
	assert_true(ResourceCore._owner_watchers.is_empty())
	assert_errors(0)


func test_owner_scope_of_a_missing_or_non_node_object() -> void:
	start()
	assert_true(ResourceCore.get_owner_scope(null).released)
	assert_true(ResourceCore.get_owner_scope(RefCounted.new()).released)
	assert_errors(2)
	var owner_node: Node = Node.new()
	add_child_autofree(owner_node)
	assert_false(ResourceCore.get_owner_scope(owner_node).released)
	assert_eq(owner_node.get_children().size(), 0)


func test_owner_scope_of_a_destroyed_object() -> void:
	start()
	var freed: Node = Node.new()
	freed.free()
	var scope: Scope = ResourceCore.get_owner_scope(freed)
	assert_not_null(scope, "a destroyed object reaches the body")
	assert_true(scope.released)
	assert_eq(scope.kind, ResourceCore.ScopeKind.OWNER)
	assert_errors(1)
	ResourceCore.end_owner_scope(freed)
	assert_errors(0, "end_owner_scope of a destroyed object does nothing")
	var owner_node: Node = Node.new()
	add_child(owner_node)
	var owned: Scope = ResourceCore.get_owner_scope(owner_node)
	ResourceCore.add_scope_release_listener(_count_listener)
	remove_child(owner_node)
	owner_node.free()
	assert_true(owned.released)
	ResourceCore.end_owner_scope(owner_node)
	assert_eq(_calls.size(), 1, "the destruction released the owner scope once")
	assert_true(ResourceCore.get_owner_scope(owner_node).released)
	assert_errors(1)
	assert_true(ResourceCore._owner_scopes.is_empty())


func test_create_scope_of_another_kind_fails() -> void:
	start()
	assert_true(ResourceCore.create_scope(ResourceCore.ScopeKind.GLOBAL, "x").released)
	assert_true(ResourceCore.create_scope(ResourceCore.ScopeKind.OWNER, "x").released)
	assert_true(ResourceCore.create_scope(99 as ResourceCore.ScopeKind, "x").released)
	assert_errors(3)
	for kind: ResourceCore.ScopeKind in [ResourceCore.ScopeKind.SCENE, ResourceCore.ScopeKind.PANEL, ResourceCore.ScopeKind.POPUP]:
		var scope: Scope = ResourceCore.create_scope(kind, "lobby")
		assert_false(scope.released)
		assert_eq(scope.kind, kind)
		assert_eq(scope.name, "lobby")


func test_release_scope_of_global_owner_or_released_scope_does_nothing() -> void:
	start()
	var global_scope: Scope = ResourceCore.get_global_scope()
	assert_eq(global_scope.name, "global")
	assert_not_null(await load_animation(ANIM_A, global_scope))
	ResourceCore.release_scope(global_scope)
	var owner_node: Node = Node.new()
	add_child_autofree(owner_node)
	var owner_scope: Scope = ResourceCore.get_owner_scope(owner_node)
	ResourceCore.release_scope(owner_scope)
	var scope: Scope = new_scope("lobby")
	ResourceCore.release_scope(scope)
	ResourceCore.add_scope_release_listener(_count_listener)
	ResourceCore.release_scope(scope)
	assert_errors(3)
	assert_false(global_scope.released)
	assert_false(owner_scope.released)
	assert_true(ResourceCore.is_loaded(ANIM_A, ANIMATION))
	assert_true(_calls.is_empty())


func test_scope_released_while_loading_gets_the_fallback_and_a_warn() -> void:
	start()
	var keeper: Scope = new_scope("keeper")
	assert_not_null(await load_animation(ANIM_B, keeper))
	var scope: Scope = new_scope("lobby")
	var runner: RUNNER = start_load(ANIM_A, ANIMATION, scope)
	assert_false(runner.done)
	ResourceCore.release_scope(scope)
	await runner.wait()
	assert_true(runner.resource == fallback_of(ANIMATION))
	assert_eq(warns(), 1)
	assert_false(ResourceCore.is_loaded(ANIM_A, ANIMATION), "no reference was added")
	assert_eq(reference_count(ANIM_B), 1, "the other references are as they were")
	assert_true(scope.keys.is_empty())


func _first_listener(scope: Scope) -> void:
	_calls.append("first:" + scope.name)
	_seen_released.append(scope.released)
	_seen_reference_count.append(reference_count(ANIM_A))
	_seen_fallback.append(ResourceCore.get_loaded(ANIM_A, ANIMATION, scope) == fallback_of(ANIMATION))


func _second_listener(scope: Scope) -> void:
	_calls.append("second:" + scope.name)


func _removed_listener(scope: Scope) -> void:
	_calls.append("removed:" + scope.name)


func _added_listener(scope: Scope) -> void:
	_calls.append("added:" + scope.name)


func _count_listener(scope: Scope) -> void:
	_calls.append("count:" + scope.name)


## On scope a: releases scope b, removes `_removed_listener` and adds `_added_listener`.
func _nesting_listener(scope: Scope) -> void:
	_calls.append("nesting:" + scope.name)
	if scope != _scope_a:
		return
	ResourceCore.release_scope(_scope_b)
	_seen_released.append(_scope_b.released)
	_seen_fallback.append(not ResourceCore.is_loaded(ANIM_B, ANIMATION))
	ResourceCore.remove_scope_release_listener(_removed_listener)
	ResourceCore.add_scope_release_listener(_added_listener)
