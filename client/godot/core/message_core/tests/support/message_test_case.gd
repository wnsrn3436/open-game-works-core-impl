extends UnitTestCase
## Base of the MessageCore core tests: test resources, module start and helpers.

const RESOURCES: String = "res://core/message_core/tests/resources/"
const TOAST: String = "prefab/message_test_toast"
const TOAST_NO_VIEW: String = "prefab/message_test_toast_no_view"
const TOAST_NOT_POOLED: String = "prefab/message_test_toast_not_pooled"
## A pool object prefab whose root is a `Node2D`, not a `Control`.
const TOAST_NODE2D_ROOT: String = "prefab/message_test_toast_node2d_root"
const BLACK_BOX: String = "prefab/message_test_black_box"
const BLACK_BOX_NO_LABEL: String = "prefab/message_test_black_box_no_label"
const FADE_IN: String = "tween/message_test_fade_in"
const FADE_OUT: String = "tween/message_test_fade_out"
const FADE_FOREVER: String = "tween/message_test_fade_forever"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
## Not in the test key list.
const MISSING_TWEEN: String = "tween/message_test_missing"
## Length of every test tween preset: one 100 ms change, repeat count 1.
const TWEEN_MS: int = 100
const TOAST_MS: int = 1000
const BLACK_BOX_MS: int = 1500
const ERROR: String = "error"


func before_each() -> void:
	super()
	set_int("MessageCore.toastDurationMs", TOAST_MS)
	set_int("MessageCore.blackBoxDurationMs", BLACK_BOX_MS)


func set_string(key: String, value: String) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Settings of prefab toasts and black boxes with fade in and fade out presets.
func use_prefabs_with_tweens() -> void:
	set_string("MessageCore.toastResource", TOAST)
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	set_tweens(FADE_IN, FADE_OUT, FADE_IN, FADE_OUT)


func set_tweens(toast_enter: String, toast_exit: String, black_box_enter: String, black_box_exit: String) -> void:
	set_string("MessageCore.toastEnterTween", toast_enter)
	set_string("MessageCore.toastExitTween", toast_exit)
	set_string("MessageCore.blackBoxEnterTween", black_box_enter)
	set_string("MessageCore.blackBoxExitTween", black_box_exit)


## Starts the modules MessageCore depends on in dependency order, with the device file, the core test data and
## translation, and then MessageCore unless `init_message` is false. Settings are set before. Async.
func start_modules(init_message: bool = true) -> bool:
	var keys: Dictionary[String, String] = {
		TOAST: RESOURCES + "test_toast.tscn",
		TOAST_NO_VIEW: RESOURCES + "test_toast_no_view.tscn",
		TOAST_NOT_POOLED: RESOURCES + "test_toast_not_pooled.tscn",
		TOAST_NODE2D_ROOT: RESOURCES + "test_toast_node2d_root.tscn",
		BLACK_BOX: RESOURCES + "test_black_box.tscn",
		BLACK_BOX_NO_LABEL: RESOURCES + "test_black_box_no_label.tscn",
		FADE_IN: RESOURCES + "test_fade_in.tres",
		FADE_OUT: RESOURCES + "test_fade_out.tres",
		FADE_FOREVER: RESOURCES + "test_fade_forever.tres",
		CLICK: RESOURCES + "test_click.tres",
	}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init()
		and LocalDataCore.load_device_file() and ResourceCore.init() and PoolCore.init() and DataCore.init()
		and InputBlockCore.init() and ResolutionCore.init() and InputCore.init() and LocalizationCore.init()
		and SoundCore.init() and SafeAreaCore.init() and TweenCore.init() and UICore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	if not init_message:
		return loaded and translated and ui_ready
	var initialized: bool = MessageCore.init()
	assert_true(initialized, "MessageCore.init")
	return loaded and translated and ui_ready and initialized


## `start_modules` and a successful `MessageCore.prepare`. Async.
func start_prepared() -> bool:
	if not await start_modules():
		return false
	var prepared: bool = await MessageCore.prepare()
	assert_true(prepared, "MessageCore.prepare")
	return prepared


## Moves the test clock and lets the modules process it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


func errors(tag: String) -> int:
	return UnitTestCore.check_logs(ERROR, tag)


func toast() -> MessageCore._KIND_STATE:
	return MessageCore._toast


func black_box() -> MessageCore._KIND_STATE:
	return MessageCore._black_box


## Translation key of a reserved string: a message text without format arguments.
func key_a() -> String:
	return ReservedString.ui_exit_confirm()


func key_b() -> String:
	return ReservedString.ui_exit_quit()


func key_c() -> String:
	return ReservedString.ui_exit_cancel()


## Translation key of text `{count} items for you`.
func count_key() -> String:
	return GameData.MailTemplateTable.get_row(GameDataDev.find_id_value("[mail_mailbox_notice]")).body


## Translation key of text `{text}`.
func text_key() -> String:
	return GameData.MailTemplateTable.get_row(GameDataDev.find_id_value("[mail_admin_notice]")).body


## Text of the message object on screen of `state`.
func shown_text(state: MessageCore._KIND_STATE) -> String:
	if state.object == null:
		return ""
	var label: Label = MessageCore._find_label(state.object)
	if label == null and state.object == MessageCore._code_toast_object:
		label = MessageCore._code_toast_label
	if label == null and state.object == MessageCore._black_box_object:
		label = MessageCore._black_box_label
	return label.text if label != null else ""


## Number of toast objects in the toast holder: the borrowed toast objects on screen.
func borrowed_toasts() -> int:
	return MessageCore._toast_holder.get_child_count()


func assert_nothing_shown(state: MessageCore._KIND_STATE) -> void:
	assert_eq(state.phase, MessageCore._KIND_STATE.Phase.IDLE)
	assert_eq(state.waiting_count(), 0)


## Opens a system popup with one button. Async.
func open_system_popup() -> bool:
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = key_a()
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = key_b()
	param.buttons = [button]
	return await UICore.open_system_popup(param, Callable())
