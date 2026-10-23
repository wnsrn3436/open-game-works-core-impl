extends UnitTestCase
## Base of the BadgeCore core tests: settings, the module start with the core test data, the badges of the core test
## data, the `BadgeChangedEvent`s received and helpers.

const Hooks := preload("res://core/badge_core/tests/support/badge_test_hooks.gd")
const RESOURCES: String = "res://core/badge_core/tests/resources/"
const DOT: String = "prefab/badge_test_dot"
const DOT_NODE2D: String = "prefab/badge_test_dot_node2d"
## Not in the test key list.
const MISSING_DOT: String = "prefab/badge_test_missing"
const MAX_DISPLAY_COUNT: int = 99
const USER_ID: int = 1001
const ITEMS_KEY: String = "BadgeCore.items"
## A badge ID value that is not in the `badge` table.
const UNKNOWN_BADGE: int = 987654321

## Badge ID values of the core test data. Root has the children A, B and Locked; Locked has the child LockedChild and
## the requirement `ItemAtLeast([potion], 1)`, like Gated, which has no parent. Saved and SavedDot persist.
var root_badge: int = 0
var a_badge: int = 0
var b_badge: int = 0
var locked_badge: int = 0
var locked_child_badge: int = 0
var gated_badge: int = 0
var dot_badge: int = 0
var saved_badge: int = 0
var saved_dot_badge: int = 0

## Every `BadgeChangedEvent` received: `<badge ID>|<item key>|<count>`, in order.
var events: PackedStringArray = PackedStringArray()


func before_each() -> void:
	super()
	Hooks.reset()
	events = PackedStringArray()
	set_int("BadgeCore.refreshIntervalMs", 0)
	set_int("BadgeCore.maxDisplayCount", MAX_DISPLAY_COUNT)
	set_string("BadgeCore.dotResource", "")


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_string(key: String, value: String) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Starts the modules BadgeCore depends on in module list order, loads the `device` file, the core test data and
## translation, registers the `ItemAtLeast` judge, and then starts BadgeCore unless `init_badge` is false. Settings are
## set before. Async.
func start_modules(init_badge: bool = true) -> bool:
	var keys: Dictionary[String, String] = {
		DOT: RESOURCES + "test_dot.tscn",
		DOT_NODE2D: RESOURCES + "test_dot_node2d.tscn",
	}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and UserStateCore.init() and ResolutionCore.init()
		and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init() and LocalizationCore.init()
		and SoundCore.init() and TweenCore.init() and UICore.init() and MessageCore.init() and NetworkCore.init()
		and RequirementCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translations: Array[DownloadedTranslation] = []
	var translated: bool = await LocalizationCore.load_translation(translations)
	assert_true(translated, "LocalizationCore.load_translation")
	root_badge = id_of("[badge_test_root]")
	a_badge = id_of("[badge_test_a]")
	b_badge = id_of("[badge_test_b]")
	locked_badge = id_of("[badge_test_locked]")
	locked_child_badge = id_of("[badge_test_locked_child]")
	gated_badge = id_of("[badge_test_gated]")
	dot_badge = id_of("[badge_test_dot]")
	saved_badge = id_of("[badge_test_saved]")
	saved_dot_badge = id_of("[badge_test_saved_dot]")
	register_item_judge()
	assert_true(EventCore.subscribe(BadgeChangedEvent, _on_badge_changed))
	if not init_badge:
		return loaded and translated
	var initialized: bool = BadgeCore.init()
	assert_true(initialized, "BadgeCore.init")
	return loaded and translated and initialized


## `start_modules`, the `user` file of `USER_ID` and `BadgeCore.load_saved`. Async.
func start_saving() -> bool:
	if not await start_modules():
		return false
	assert_true(LocalDataCore.load_user_file(USER_ID), "LocalDataCore.load_user_file")
	var ok: bool = BadgeCore.load_saved()
	assert_true(ok, "BadgeCore.load_saved")
	await frame_end()
	return ok


## Lets the frame end of this frame and the next frame run.
func frame_end() -> void:
	await UnitTestCore.wait_frames(2)


## Moves the test clock and lets the modules process it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


func id_of(id_name: String) -> int:
	var value: int = GameDataDev.find_id_value(id_name)
	assert_ne(value, 0, "ID value of %s" % id_name)
	return value


func errors() -> int:
	return UnitTestCore.check_logs("error", BadgeCore._TAG)


func warns() -> int:
	return UnitTestCore.check_logs("warn", BadgeCore._TAG)


## Registers the `ItemAtLeast` judge with `RequirementCore`.
func register_item_judge() -> void:
	var kinds: Array[GDScript] = [CoreContract.ItemBalanceUserState]
	assert_true(RequirementCore.register_judge(
			GameData.RequirementType.ITEM_AT_LEAST, Hooks.item_at_least, kinds, ReservedString.badge_count_over()))


## Applies a delta that upserts the `ItemBalanceUserState` of `item_id`. `UserStateCore` publishes
## `UserStateChangedEvent`.
func put_balance(item_id: int, amount: int) -> void:
	var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
	state.id = item_id
	state.amount = amount
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = "ItemBalanceUserState"
	entry.id = item_id
	entry.value = state.encode()
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(entry)
	assert_true(UserStateCoreDev.apply_test_delta(delta), "apply ItemBalanceUserState %d" % item_id)


func saved_items() -> PackedStringArray:
	return LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, ITEMS_KEY)


func element(badge_id: int, item_key: int, count: int) -> String:
	return "%d:%d=%d" % [badge_id, item_key, count]


static func event_text(badge_id: int, item_key: int, count: int) -> String:
	return "%d|%d|%d" % [badge_id, item_key, count]


## A UI element under the root with a `BadgeView` child. The test frees the UI element.
func make_view() -> BadgeView:
	var element_control: Control = Control.new()
	element_control.size = Vector2(100, 40)
	(Engine.get_main_loop() as SceneTree).root.add_child(element_control)
	var view: BadgeView = BadgeView.new()
	element_control.add_child(view)
	return view


func free_view(view: BadgeView) -> void:
	var element_control: Node = view.get_parent()
	element_control.get_parent().remove_child(element_control)
	element_control.free()


## Whether the display of `view` is visible.
func shown(view: BadgeView) -> bool:
	return is_instance_valid(view._display) and view._display.visible


## The count text of `view`. Empty when it shows no text.
func shown_text(view: BadgeView) -> String:
	if not shown(view) or view._label == null or not view._label.visible:
		return ""
	return view._label.text


func _on_badge_changed(event: BadgeChangedEvent) -> void:
	events.append(event_text(event.badge_id, event.item_key, event.count))
