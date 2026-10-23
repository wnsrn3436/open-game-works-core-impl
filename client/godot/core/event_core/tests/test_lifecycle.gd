extends EventCoreTestCase
## `init`, `release`, teardown without `release`, calls outside `init`, and the boot event types.

const BOOT_EVENTS: PackedStringArray = [
	"RestartRequestedEvent",
	"FatalErrorRequestedEvent",
	"BootCompletedEvent",
	"AppQuitEvent",
]
const EVENT_CORE_FOLDER: String = "res://core/event_core/"


func test_release_puts_every_static_var_back_and_removes_the_core_node() -> void:
	EventCore.release()
	assert_false(EventCore.is_initialized())
	# Registered before init, the listener stays registered until the release.
	EventCoreDev.register_init_listener(init_listener().on_first)
	assert_true(EventCore.init())
	assert_true(EventCore.is_initialized())
	var node: Node = EventCore._node
	assert_true(is_instance_valid(node) and node.is_inside_tree())
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	publish_a(1)
	EventCore.release()
	assert_false(EventCore.is_initialized())
	_assert_initial_state()
	assert_false(node.is_inside_tree())


func test_tree_teardown_without_release_clears_like_release() -> void:
	EventCore.release()
	EventCoreDev.register_init_listener(init_listener().on_first)
	assert_true(EventCore.init())
	var target: EventCoreTestSubscriber = subscriber()
	assert_true(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	publish_a(1)
	var node: Node = EventCore._node
	node.free()
	assert_false(EventCore.is_initialized())
	_assert_initial_state()
	assert_true(EventCore.init())
	assert_eq(EventCore.count_subscriptions(target), 0)


func test_init_of_an_initialized_module_fails() -> void:
	assert_false(EventCore.init())
	assert_eq(error_logs(), 1)
	assert_true(EventCore.is_initialized())


func test_operations_outside_init_return_failure_values() -> void:
	var target: EventCoreTestSubscriber = subscriber()
	EventCore.release()
	assert_false(EventCore.subscribe(EventCoreTestAEvent, target.on_a))
	EventCore.unsubscribe(EventCoreTestAEvent, target.on_a)
	assert_eq(EventCore.unsubscribe_all(target), 0)
	assert_eq(EventCore.count_subscriptions(target), 0)
	assert_null(EventCore.acquire(EventCoreTestAEvent))
	EventCore.publish(EventCoreTestAEvent.new())
	assert_eq(error_logs(), 6)
	assert_eq(target.a_values.size(), 0)


func test_boot_event_types_are_defined_only_by_event_core() -> void:
	var classes: Dictionary[String, String] = _global_classes()
	for event_name: String in BOOT_EVENTS:
		assert_true(classes.has(event_name), event_name)
		if classes.has(event_name):
			assert_true(classes[event_name].begins_with(EVENT_CORE_FOLDER + "events/"), classes[event_name])
	assert_eq(_global_class_bases()["RestartRequestedEvent"], "EventBase")
	assert_eq(_global_class_bases()["FatalErrorRequestedEvent"], "EventBase")
	assert_eq(_global_class_bases()["BootCompletedEvent"], "EventBase")
	assert_eq(_global_class_bases()["AppQuitEvent"], "EventBase")
	var restart: RestartRequestedEvent = EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	assert_eq(restart.module, "")
	var fatal: FatalErrorRequestedEvent = EventCore.acquire(FatalErrorRequestedEvent) as FatalErrorRequestedEvent
	assert_eq(fatal.module + fatal.reason, "")
	var completed: BootCompletedEvent = EventCore.acquire(BootCompletedEvent) as BootCompletedEvent
	assert_eq(completed.duration_ms, 0)
	assert_not_null(EventCore.acquire(AppQuitEvent))
	# No other core code declares a type of the same name, as a global class or an inner class.
	for path: String in _core_scripts("res://core"):
		if path.begins_with(EVENT_CORE_FOLDER):
			continue
		for line: String in FileAccess.get_file_as_string(path).split("\n"):
			var words: PackedStringArray = line.strip_edges().split(" ", false)
			if words.size() >= 2 and (words[0] == "class_name" or words[0] == "class"):
				var declared: String = words[1].trim_suffix(":")
				assert_false(BOOT_EVENTS.has(declared), "%s declares %s" % [path, declared])


func _assert_initial_state() -> void:
	assert_null(EventCore._node)
	assert_null(EventCore._session)
	assert_true(EventCore._types.is_empty())
	assert_true(EventCore._type_list.is_empty())
	assert_true(EventCore._heads.is_empty())
	assert_eq(EventCore._subscriber_count, 0)
	assert_eq(EventCore._next_serial, 0)
	assert_eq(listeners_not_of_unit_test_core(), 0)


## Script path of each global class name.
func _global_classes() -> Dictionary[String, String]:
	return _global_class_field("path")


## Base class name of each global class name.
func _global_class_bases() -> Dictionary[String, String]:
	return _global_class_field("base")


# ogw:input_boundary
func _global_class_field(field: String) -> Dictionary[String, String]:
	var out: Dictionary[String, String] = {}
	for entry: Dictionary in ProjectSettings.get_global_class_list():
		var class_value: Variant = entry.get("class")
		var value: Variant = entry.get(field)
		if (class_value is String or class_value is StringName) and (value is String or value is StringName):
			out[str(class_value)] = str(value)
	return out


## Every `.gd` under `folder` outside core tests.
func _core_scripts(folder: String) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for file: String in DirAccess.get_files_at(folder):
		if file.ends_with(".gd"):
			out.append(folder + "/" + file)
	for child: String in DirAccess.get_directories_at(folder):
		if child != "tests":
			out.append_array(_core_scripts(folder + "/" + child))
	return out
