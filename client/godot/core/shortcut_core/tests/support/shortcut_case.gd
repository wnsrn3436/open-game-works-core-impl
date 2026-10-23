extends UnitTestCase
## Base of the ShortcutCore core tests: test resources, settings, module start and helpers.

const Trace := preload("res://core/shortcut_core/tests/support/shortcut_trace.gd")
const Gate := preload("res://core/shortcut_core/tests/support/gate.gd")
const Hooks := preload("res://core/shortcut_core/tests/support/shortcut_hooks.gd")
const TestScene := preload("res://core/shortcut_core/tests/support/shortcut_test_scene.gd")
const TestPanel := preload("res://core/shortcut_core/tests/support/shortcut_test_panel.gd")
const Probe := preload("res://core/shortcut_core/tests/support/shortcut_probe.gd")

const TAG: String = "ShortcutCore"
const RESOURCES: String = "res://core/shortcut_core/tests/resources/"
## Scene whose root panel is `PANEL_R`.
const SCENE_ROOT: String = "scene/shortcut_test_root"
## Another scene whose root panel is `PANEL_R`.
const SCENE_ROOT_OTHER: String = "scene/shortcut_test_root_other"
## Scene without a root panel.
const SCENE_PLAIN: String = "scene/shortcut_test_plain"
const LOADING: String = "prefab/shortcut_test_loading"
const PANEL_R: String = "prefab/shortcut_test_r"
const PANEL_A: String = "prefab/shortcut_test_a"
const PANEL_B: String = "prefab/shortcut_test_b"
const PANEL_C: String = "prefab/shortcut_test_c"
const PANEL_D: String = "prefab/shortcut_test_d"
const PANEL_X: String = "prefab/shortcut_test_x"
## Panel whose `prepare` fails.
const PANEL_F: String = "prefab/shortcut_test_f"
const POPUP: String = "prefab/shortcut_test_popup"
const POPUP_2: String = "prefab/shortcut_test_popup_2"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const ERROR: String = "error"
const WARN: String = "warn"

## Subscriber of the events a navigation makes. Subscribed by `start_modules`.
var probe: Probe = null
## Results of `navigate_later` calls, in end order: 1 for `true`, 0 for `false`.
var results: PackedInt32Array = PackedInt32Array()


func before_each() -> void:
	super()
	Trace.clear()
	Hooks.reset()
	TestScene.reset()
	TestPanel.reset()
	results = PackedInt32Array()
	probe = Probe.new()
	add_child_autofree(probe)
	assert_true(UnitTestCore.set_test_settings("loadingScreen", LOADING))
	assert_true(UnitTestCore.set_test_settings("SceneCore.loadingMinDisplayMs", 0))
	assert_true(UnitTestCore.set_test_settings("SceneCore.prepareRetryCount", 0))


static func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		SCENE_ROOT: RESOURCES + "scene_root.tscn",
		SCENE_ROOT_OTHER: RESOURCES + "scene_root_other.tscn",
		SCENE_PLAIN: RESOURCES + "scene_plain.tscn",
		LOADING: RESOURCES + "loading.tscn",
		PANEL_R: RESOURCES + "panel_r.tscn",
		PANEL_A: RESOURCES + "panel_a.tscn",
		PANEL_B: RESOURCES + "panel_b.tscn",
		PANEL_C: RESOURCES + "panel_c.tscn",
		PANEL_D: RESOURCES + "panel_d.tscn",
		PANEL_X: RESOURCES + "panel_x.tscn",
		PANEL_F: RESOURCES + "panel_f.tscn",
		POPUP: RESOURCES + "popup.tscn",
		POPUP_2: RESOURCES + "popup.tscn",
		CLICK: RESOURCES + "click.tres",
	}
	return keys


## Starts the modules ShortcutCore depends on in dependency order with the core test data and translation, prepares
## `UICore` and `MessageCore`, registers the test judge hooks, and inits ShortcutCore unless `init_shortcut` is false.
## Async.
func start_modules(init_shortcut: bool = true) -> bool:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and UserStateCore.init() and ResolutionCore.init()
		and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init() and LocalizationCore.init()
		and SoundCore.init() and TweenCore.init() and UICore.init() and ScreenEffectCore.init() and MessageCore.init()
		and NetworkCore.init() and RequirementCore.init() and SceneCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	probe.subscribe()
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	var message_ready: bool = await MessageCore.prepare()
	assert_true(message_ready, "MessageCore.prepare")
	if not (loaded and translated and ui_ready and message_ready and _register_judges()):
		return false
	if not init_shortcut:
		return true
	var initialized: bool = ShortcutCore.init()
	assert_true(initialized, "ShortcutCore.init")
	return initialized


## `start_modules`, a boot transition to `scene_key` and then the panels `panels` opened in order. Async.
func start_at(scene_key: String, panels: PackedStringArray = PackedStringArray()) -> bool:
	if not await start_modules():
		return false
	var booted: bool = await SceneCore.boot_change_scene(scene_key, null)
	assert_true(booted, "boot_change_scene")
	if not booted:
		return false
	for panel: String in panels:
		var opened: bool = await UICore.open_panel(panel, null, false)
		assert_true(opened, "open_panel " + panel)
		if not opened:
			return false
	Trace.clear()
	return true


## ID value of the test shortcut row `[shortcut_test_<test_name>]`.
func shortcut(test_name: String) -> int:
	var id: int = GameDataDev.find_id_value("[shortcut_test_%s]" % test_name)
	assert_ne(id, 0, "shortcut row " + test_name)
	return id


## Opens the test popups, `count` of them (at most 2). Their hidden callbacks record `popup_hidden`. Async.
func open_popups(count: int) -> void:
	var keys: PackedStringArray = [POPUP, POPUP_2]
	for i: int in mini(count, keys.size()):
		var result: UICore.PopupOpenResult = await UICore.open_popup(keys[i], null, _on_popup_hidden)
		assert_eq(result, UICore.PopupOpenResult.OPENED, "open_popup")
	Trace.clear()


## Calls `navigate` without waiting for it. `results` gets 1 or 0 when it ends.
func navigate_later(shortcut_id: int) -> void:
	var ok: bool = await ShortcutCore.navigate(shortcut_id)
	results.append(1 if ok else 0)


## Calls `UICore.open_panel` without waiting for it.
func open_panel_later(panel_key: String) -> void:
	await UICore.open_panel(panel_key, null, false)


## Waits until the trace has `entry`, checking once a frame: the code that added it runs on to its next `await` first,
## so a gate it waits for is opened only after it waits. The wait also ends when UICore is released, as the test time
## limit does, so that a failing test ends.
func wait_trace(entry: String) -> void:
	while not Trace.has(entry):
		if not UICore.is_initialized():
			fail_test("UICore was released while waiting for %s" % entry)
			return
		await UnitTestCore.wait_frames(1)


## Waits until `navigate_later` calls ended `count` times in all. Ends like `wait_trace`.
func wait_results(count: int) -> void:
	while results.size() < count:
		if not UICore.is_initialized():
			fail_test("UICore was released while waiting for %d navigate results" % count)
			return
		await UnitTestCore.wait_frames(1)


## The panel stack as short names joined with `,`, from the bottom item.
func stack() -> String:
	var names: PackedStringArray = PackedStringArray()
	for key: String in UICore.get_panel_stack():
		names.append(Trace.short(key))
	return ",".join(names)


## Entries of the panel transitions: `flow:<open|close>:<panel>:<success>`.
func flows() -> PackedStringArray:
	return Trace.with_prefix("flow:")


## Whether `entries` are in the trace once each, in this order.
func assert_in_order(entries: PackedStringArray) -> void:
	var last: int = -1
	for entry: String in entries:
		assert_eq(Trace.count(entry), 1, "once: " + entry)
		var at: int = Trace.index(entry)
		assert_gt(at, last, "order: " + entry)
		last = at


func errors(tag: String) -> int:
	return UnitTestCore.check_logs(ERROR, tag)


func warns(tag: String) -> int:
	return UnitTestCore.check_logs(WARN, tag)


## Visible text labels of the `Message` layer: the toasts and black boxes on screen.
func visible_message_texts() -> PackedStringArray:
	var texts: PackedStringArray = PackedStringArray()
	var layer: Node = UICore.get_layer(UICore.UILayer.MESSAGE)
	for node: Node in layer.find_children("*", "Label", true, false):
		var label: Label = node as Label
		if label != null and label.is_visible_in_tree():
			texts.append(label.text)
	return texts


## Translation key of the text `{count} items for you`: the guide text of `FlagB`.
func guide_key() -> String:
	return GameData.MailTemplateTable.get_row(GameDataDev.find_id_value("[mail_mailbox_notice]")).body


## `FlagA`, `FlagB` and `FlagC` judge hooks: `FlagB` has a guide text and a guide argument hook, `FlagC` has no guide
## text.
func _register_judges() -> bool:
	var kinds: Array[GDScript] = []
	var ok: bool = (
		RequirementCore.register_judge(GameData.RequirementType.FLAG_A, Hooks.judge_a, kinds, "")
		and RequirementCore.register_judge(GameData.RequirementType.FLAG_B, Hooks.judge_b, kinds, guide_key(), Hooks.guide_args)
		and RequirementCore.register_judge(GameData.RequirementType.FLAG_C, Hooks.judge_c, kinds, "")
	)
	assert_true(ok, "RequirementCore.register_judge")
	return ok


func _on_popup_hidden() -> void:
	Trace.add("popup_hidden")
