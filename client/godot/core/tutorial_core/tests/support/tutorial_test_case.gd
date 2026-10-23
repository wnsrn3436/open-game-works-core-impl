extends UnitTestCase
## Base of the TutorialCore core tests: settings, test resources, the module start with the core test data, a dev
## login, the `can_start_tutorial` allow list, the scene UI stage with anchors, fake responses and view helpers.

const TestScene := preload("res://core/tutorial_core/tests/support/tutorial_test_scene.gd")
const Hooks := preload("res://core/tutorial_core/tests/support/tutorial_hooks.gd")

const TAG: String = "TutorialCore"
const ERROR: String = "error"
const WARN: String = "warn"
const RESOURCES: String = "res://core/tutorial_core/tests/resources/"
const VIEW: String = "prefab/tutorial_core_test_view"
const BROKEN_VIEW: String = "prefab/tutorial_core_test_broken_view"
## The panel and popup keys of the core test data `tutorial_step` rows.
const PANEL: String = "prefab/tutorial_core_test_panel"
const POPUP: String = "prefab/tutorial_core_test_popup"
## A modal popup without anchors.
const COVER: String = "prefab/tutorial_core_test_cover"
const SCENE_A: String = "scene/tutorial_core_test_a"
const SCENE_B: String = "scene/tutorial_core_test_b"
const LOADING: String = "prefab/tutorial_core_test_loading"
## The resource key of `[ui_button_click]` in the core test data.
const CLICK: String = "sfx/ui_button_click"
const SAVE: String = "core/SaveTutorialProgress"
const DEV_LOGIN: String = "core/cheat/DevLogin"
const REPORT_ERRORS: String = "core/ReportClientErrors"
## Fake responses for the `ReportClientErrors` requests LogCore sends for the error logs of a test after the login.
const REPORT_ERRORS_RESPONSES: int = 4
const SERVER_TIME: int = 1710000000000
const ANCHOR_WAIT_WARN_MS: int = 1000
const TIME_RECHECK_MS: int = 500
## How many frames the waits below give a condition before they give up.

## Tutorial ID values the `can_start_tutorial` hook of the test allows.
var allowed: Dictionary[int, bool] = {}
## Tutorial ID values the hook of the test was called with, in order.
var hook_calls: PackedInt64Array = PackedInt64Array()
## Tutorial ID values the hook of the test throws for: it stops on a GDScript runtime error.
var throwing: Dictionary[int, bool] = {}
## `started:<ID name>:<step>` and `completed:<ID name>:<skipped>` in order.
var events: PackedStringArray = PackedStringArray()
## Clicks of the scene UI stage buttons: their anchor names, in order.
var clicks: PackedStringArray = PackedStringArray()
## `TutorialCore.current` read in a stage button click callback: `<ID name>:<step>`.
var current_in_click: PackedStringArray = PackedStringArray()
## When true, a stage button click calls `TutorialCore.skip`.
var skip_in_click: bool = false
## Full-screen `Control` on the `SceneUI` layer that holds the anchors the tests make.
var stage: Control = null
var _blocks: Array[ActiveBlockInfo] = []
var _touches: int = 0
## Gamepad button `a` as the engine accept input. The engine default `ui_accept` has no gamepad button.
var _pad_accept: InputEventJoypadButton = null


func before_each() -> void:
	super()
	allowed = {}
	hook_calls = PackedInt64Array()
	throwing = {}
	events = PackedStringArray()
	clicks = PackedStringArray()
	current_in_click = PackedStringArray()
	skip_in_click = false
	stage = null
	_blocks.resize(32)
	_pad_accept = null
	if not _has_pad_accept():
		_pad_accept = InputEventJoypadButton.new()
		_pad_accept.button_index = JOY_BUTTON_A
		_pad_accept.device = -1
		InputMap.action_add_event(&"ui_accept", _pad_accept)
	TestScene.reset()
	Hooks.reset()
	set_value("tutorialView", VIEW)
	set_value("gamepadSupported", false)
	set_value("TutorialCore.anchorWaitWarnMs", ANCHOR_WAIT_WARN_MS)
	set_value("RequirementCore.timeRecheckMs", TIME_RECHECK_MS)
	set_value("UICore.buttonClickIntervalMs", 0)
	set_value("UICore.dimResource", "")
	set_value("UICore.loadingIconResource", "")
	set_value("UICore.systemPopupResource", "")
	set_value("loadingScreen", LOADING)
	set_value("SceneCore.loadingMinDisplayMs", 0)
	set_value("TimeCore.reachMarginMs", 0)
	set_value("TimeCore.jumpThresholdMs", 1000000000000)
	set_value("InputBlockCore.maxDurationMs", 3600000)
	set_value("LogCore.sendIntervalMs", 3600000)


func after_each() -> void:
	var modules: Array[Callable] = [
		TutorialCore.release, SceneCore.release, RequirementCore.release, AuthCore.release, NetworkCore.release,
		UserStateCore.release, MessageCore.release, ScreenEffectCore.release, UICore.release, TweenCore.release,
		SoundCore.release, LocalizationCore.release, InputCore.release, InputBlockCore.release, SafeAreaCore.release,
		ResolutionCore.release, DataCore.release, PoolCore.release, ResourceCore.release, LocalDataCore.release,
		TimeCore.release, EventCore.release,
	]
	for release: Callable in modules:
		release.call()
	if is_instance_valid(stage):
		stage.free()
	stage = null
	if _pad_accept != null:
		InputMap.action_erase_event(&"ui_accept", _pad_accept)
	_pad_accept = null
	LogCore.release()
	super()


func _has_pad_accept() -> bool:
	for event: InputEvent in InputMap.action_get_events(&"ui_accept"):
		var pad: InputEventJoypadButton = event as InputEventJoypadButton
		if pad != null and pad.button_index == JOY_BUTTON_A:
			return true
	return false


# ogw:input_boundary
func set_value(key: String, value: Variant) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


static func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		VIEW: RESOURCES + "tutorial_view.tscn",
		BROKEN_VIEW: RESOURCES + "broken_view.tscn",
		PANEL: RESOURCES + "panel.tscn",
		POPUP: RESOURCES + "popup.tscn",
		COVER: RESOURCES + "cover_popup.tscn",
		SCENE_A: RESOURCES + "scene.tscn",
		SCENE_B: RESOURCES + "scene.tscn",
		LOADING: RESOURCES + "loading.tscn",
		CLICK: "res://core/ui_core/tests/resources/test_click.tres",
	}
	return keys


## Starts the modules TutorialCore depends on in module list order with the core test data and translation, the
## test resources, the requirement judges, the scene UI stage and TutorialCore, registers the allow list hook when
## `hook` is true and logs in when `login` is true. Settings are set before. Async.
func start(login: bool = true, hook: bool = true) -> bool:
	ResourceCoreDev.set_test_key_list(resource_keys())
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and ResolutionCore.init() and SafeAreaCore.init()
		and InputBlockCore.init() and InputCore.init() and LocalizationCore.init() and SoundCore.init()
		and TweenCore.init() and UICore.init() and ScreenEffectCore.init() and MessageCore.init()
		and UserStateCore.init() and NetworkCore.init() and AuthCore.init() and RequirementCore.init()
		and SceneCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	var loaded: bool = await DataCore.load(null)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	assert_true(await load_resources(), "load the test resources")
	assert_true(NetworkCore.set_server_info("http://127.0.0.1", "", CoreBuildInfo.platform), "set_server_info")
	var ui_ready: bool = await UICore.prepare()
	assert_true(ui_ready, "UICore.prepare")
	var message_ready: bool = await MessageCore.prepare()
	assert_true(message_ready, "MessageCore.prepare")
	# The judges read the `TutorialProgressUserState` kind so `touch_user_state` raises their `UserStateChanged` trigger.
	var kinds: Array[GDScript] = [CoreContract.TutorialProgressUserState]
	assert_true(RequirementCore.register_judge(GameData.RequirementType.FLAG_A, Hooks.judge_flag_a, kinds, ""), "FlagA judge")
	assert_true(
		RequirementCore.register_judge(GameData.RequirementType.FLAG_B, Hooks.judge_flag_b, kinds, "", Callable(), true), "FlagB judge"
	)
	make_stage()
	assert_true(EventCore.subscribe(TutorialStepStartedEvent, _on_step_started), "subscribe TutorialStepStartedEvent")
	assert_true(EventCore.subscribe(TutorialCompletedEvent, _on_completed), "subscribe TutorialCompletedEvent")
	var initialized: bool = TutorialCore.init()
	assert_true(initialized, "TutorialCore.init")
	if not (loaded and translated and ui_ready and message_ready and initialized):
		return false
	if hook:
		assert_true(TutorialCore.register_can_start_tutorial(_can_start), "register_can_start_tutorial")
	if login:
		return await log_in()
	return true


## Loads every resource of the test key list into the global scope and waits for the result. The threaded loads end
## before a test flow starts, so the tutorial view, the scenes, panels and popups come from the cache and the frames a
## test waits for are the frames of those flows, not of the engine load threads.
func load_resources() -> bool:
	var request: PreloadRequest = PreloadRequest.new()
	for key: String in resource_keys():
		var kind: int = ResourceCore.BaseKind.AUDIO_STREAM if key == CLICK else ResourceCore.BaseKind.PACKED_SCENE
		request.add_item(key, kind)
	return await ResourceCore.preload_resources(request, ResourceCore.get_global_scope())


## Dev login with a fake `DevLogin` response. Async.
func log_in() -> bool:
	var response: CoreCheatContract.DevLoginResponse = CoreCheatContract.DevLoginResponse.new()
	var result: CoreContract.AuthResult = CoreContract.AuthResult.new()
	result.user_id = 7001
	result.user_created_at = SERVER_TIME - 1000
	result.login_token = "tutorial-login"
	result.access_token = "tutorial-access"
	result.access_token_expires_at = SERVER_TIME + 86400000
	result.session_signing_key = "tutorial-key"
	result.consent = CoreContract.ConsentUserState.new()
	response.result = result
	respond(DEV_LOGIN, response)
	var login: LoginResult = await AuthCoreDev.dev_login("tutorial")
	assert_eq(login.status, AuthCore.LoginStatus.SUCCESS, "dev login")
	# LogCore sends the error logs of a test through NetworkCore once a session is open.
	for i: int in REPORT_ERRORS_RESPONSES:
		respond(REPORT_ERRORS, null)
	return AuthCore.is_logged_in()


## The ID value of an ID name of the core test data.
func id_of(id_name: String) -> int:
	var value: int = GameDataDev.find_id_value(id_name)
	assert_ne(value, 0, "ID value of %s" % id_name)
	return value


## Lets the allow list hook allow the tutorials of `id_names` only.
func allow(id_names: PackedStringArray) -> void:
	allowed = {}
	for id_name: String in id_names:
		allowed[id_of(id_name)] = true


func _can_start(tutorial_id: int) -> bool:
	hook_calls.append(tutorial_id)
	if throwing.has(tutorial_id):
		var none: PackedInt32Array = PackedInt32Array()
		return none[tutorial_id] > 0
	return allowed.has(tutorial_id)


func _on_step_started(event: TutorialStepStartedEvent) -> void:
	events.append("started:%s:%d" % [GameDataDev.find_id_name(event.tutorial_id), event.step])


func _on_completed(event: TutorialCompletedEvent) -> void:
	events.append("completed:%s:%s" % [GameDataDev.find_id_name(event.tutorial_id), event.skipped])


# --- scene UI stage and anchors ---


func make_stage() -> void:
	stage = Control.new()
	stage.name = "TutorialTestStage"
	stage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(stage)
	stage.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


## A button on the stage at `rect` with a `UIButton` (unless `ui_button` is false) and a `UIAnchor` named
## `anchor_name` with `anchor_key`. Its click is recorded in `clicks`.
func add_anchor(anchor_name: String, rect: Rect2, anchor_key: int = 0, ui_button: bool = true) -> Button:
	var button: Button = Button.new()
	button.name = anchor_name
	button.position = rect.position
	button.size = rect.size
	stage.add_child(button)
	if ui_button:
		var click: UIButton = UIButton.new()
		button.add_child(click)
		click.set_on_click(_on_stage_click.bind(anchor_name))
	var anchor: UIAnchor = UIAnchor.new()
	anchor.anchor_name = anchor_name
	button.add_child(anchor)
	if anchor_key != 0:
		anchor.set_anchor_key(anchor_key)
	return button


func _on_stage_click(anchor_name: String) -> void:
	clicks.append(anchor_name)
	var current: CurrentResult = TutorialCore.current()
	current_in_click.append("%s:%d" % [GameDataDev.find_id_name(current.tutorial_id), current.step])
	if skip_in_click:
		TutorialCore.skip()


## Game coordinates of the center of `control`.
func center_of(control: Control) -> Vector2:
	var center: Vector2 = control.get_global_rect().get_center()
	var node: Node = control
	while node != null:
		var layer: CanvasLayer = node as CanvasLayer
		if layer != null:
			return center + layer.offset
		node = node.get_parent()
	return center


# --- waits ---


## Waits `frames` engine frames.
func frames(count: int = 1) -> void:
	await UnitTestCore.wait_frames(count)


## Waits until the tutorial view is made or failed, checking once a frame: the view has no event. The wait ends when
## TutorialCore is released, as the test time limit does, so that a failing test ends.
func wait_view_settled() -> void:
	while TutorialCore._view_state != TutorialCore._VIEW_READY and TutorialCore._view_state != TutorialCore._VIEW_FAILED:
		if not TutorialCore.is_initialized():
			fail_test("TutorialCore was released while waiting for the tutorial view")
			return
		await frames()


## Waits until the tutorial view shows, checking once a frame. False when TutorialCore was released first, as at the
## test time limit.
func wait_shown() -> bool:
	while not view_visible():
		if not TutorialCore.is_initialized():
			return false
		await frames()
	return true


## Waits until no tutorial runs, checking once a frame. False when TutorialCore was released first, as at the test time
## limit.
func wait_not_running() -> bool:
	while TutorialCore.is_initialized() and TutorialCore.is_running():
		await frames()
	return TutorialCore.is_initialized()


## Starts a tutorial of the allow list with `check_start` and waits until the view is made. Async.
func start_tutorials(id_names: PackedStringArray) -> bool:
	allow(id_names)
	var started: bool = TutorialCore.check_start()
	await wait_view_settled()
	await frames(2)
	return started


## Moves the test clock and lets the modules process it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await frames(2)


# --- state ---


func view_visible() -> bool:
	return is_instance_valid(TutorialCore._view_root) and TutorialCore._view_root.visible


func view() -> TutorialView:
	return TutorialCore._view


func has_block() -> bool:
	var count: int = InputBlockCoreDev.list_active(_blocks)
	for i: int in count:
		if _blocks[i].reason == "tutorial":
			return true
	return false


## `<ID name>:<step>` of `TutorialCore.current`.
func current_text() -> String:
	var current: CurrentResult = TutorialCore.current()
	if current.tutorial_id == 0:
		return "none"
	return "%s:%d" % [GameDataDev.find_id_name(current.tutorial_id), current.step]


## `<ID name>` of the `Shown` tutorial, or `none`.
func shown_text() -> String:
	var run: RefCounted = TutorialCore._shown
	if run == null:
		return "none"
	return GameDataDev.find_id_name(TutorialCore._shown.def.id)


func errors(tag: String = TAG) -> int:
	return UnitTestCore.check_logs(ERROR, tag)


func warns(tag: String = TAG) -> int:
	return UnitTestCore.check_logs(WARN, tag)


# --- network ---


static func respond(request_name: String, message: ContractMessage, delta: CoreContract.UserStateDelta = null) -> void:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	envelope.user_state = delta
	if message != null:
		envelope.body = message.encode()
	UnitTestCore.add_result(request_name, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope))


## A success of `SaveTutorialProgress` whose UserState delta stores `step` for `tutorial_id`.
func respond_saved(tutorial_id: int, step: int) -> void:
	respond(SAVE, CoreContract.SaveTutorialProgressResponse.new(), progress_delta(tutorial_id, step))


## A server error of `SaveTutorialProgress`.
static func respond_save_error() -> void:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = SERVER_TIME
	var error: CoreContract.ServerError = CoreContract.ServerError.new()
	error.code = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST
	envelope.error = error
	UnitTestCore.add_result(SAVE, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(envelope))


func progress_delta(tutorial_id: int, step: int) -> CoreContract.UserStateDelta:
	var state: CoreContract.TutorialProgressUserState = CoreContract.TutorialProgressUserState.new()
	state.id = tutorial_id
	state.step = step
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = "TutorialProgressUserState"
	entry.id = tutorial_id
	entry.value = state.encode()
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(entry)
	return delta


## Stores the progress step `step` of `tutorial_id` in the UserState cache.
func put_progress(tutorial_id: int, step: int) -> void:
	assert_true(UserStateCoreDev.apply_test_delta(progress_delta(tutorial_id, step)), "TutorialProgressUserState")


## Applies a UserState delta of the kind the judges read, with an ID that is no tutorial.
func touch_user_state() -> void:
	_touches += 1
	put_progress(900000 + _touches, 1)
	await frames(2)


## `<tutorial ID name>:<step>` of every `SaveTutorialProgress` the fake network received, in order.
func saves() -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for request: UnitTestRequest in UnitTestCore.received_requests():
		if request.name != SAVE:
			continue
		var save: CoreContract.SaveTutorialProgressRequest = CoreContract.SaveTutorialProgressRequest.new()
		if save.decode(request.body):
			out.append("%s:%d" % [GameDataDev.find_id_name(save.tutorial_id), save.step])
	return out


# --- input ---


## A tap at the center of `control`.
func click(control: Control) -> void:
	UnitTestCore.tap(center_of(control))
	await frames(2)


## A press at `from`, a move with the button held to `to` and a release at `to`, in game coordinates.
func drag_tap(from: Vector2, to: Vector2) -> void:
	_inject_left_button(true, from)
	var motion: InputEventMouseMotion = InputEventMouseMotion.new()
	motion.button_mask = MOUSE_BUTTON_MASK_LEFT
	motion.position = to
	motion.global_position = to
	InputCoreDev.inject_device_input(motion)
	_inject_left_button(false, to)
	await frames(2)


func _inject_left_button(pressed: bool, position: Vector2) -> void:
	var event: InputEventMouseButton = InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = pressed
	event.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
	event.position = position
	event.global_position = position
	InputCoreDev.inject_device_input(event)


## One press and release of a gamepad button.
func press_pad(button: JoyButton) -> void:
	for pressed: bool in [true, false]:
		var event: InputEventJoypadButton = InputEventJoypadButton.new()
		event.button_index = button
		event.pressed = pressed
		event.device = 0
		InputCoreDev.inject_device_input(event)
		await frames(1)
	await frames(1)


# --- panels and popups ---


func open_panel(panel_key: String = PANEL) -> void:
	assert_true(await UICore.open_panel(panel_key, null, false), "open_panel " + panel_key)
	await frames(2)


func open_popup(popup_key: String) -> void:
	var result: UICore.PopupOpenResult = await UICore.open_popup(popup_key, null, Callable())
	assert_eq(result, UICore.PopupOpenResult.OPENED, "open_popup " + popup_key)
	await frames(2)


## Closes the open popup of `popup_key` and waits for it.
func close_popup(popup_key: String) -> void:
	var popup: UIPopup = find_popup(popup_key)
	assert_not_null(popup, "open popup " + popup_key)
	if popup != null:
		UICore.close_popup(popup)
	while UICore.get_open_popups().has(popup_key):
		var latch: UnitTestLatch = UnitTestCore.latch_event(UIClosedEvent)
		await UnitTestCore.wait_latch(latch)
		if not latch.happened:
			break
	await frames(2)


func find_popup(popup_key: String) -> UIPopup:
	return _find_popup(UICore.get_layer(UICore.UILayer.POPUP), popup_key)


func _find_popup(node: Node, popup_key: String) -> UIPopup:
	var popup: UIPopup = node as UIPopup
	if popup != null and popup.popup_key == popup_key:
		return popup
	for child: Node in node.get_children():
		var found: UIPopup = _find_popup(child, popup_key)
		if found != null:
			return found
	return null


## Opens a system popup with one button. Async.
func open_system_popup() -> void:
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.ui_exit_confirm()
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = ReservedString.ui_exit_quit()
	param.buttons.append(button)
	assert_true(await UICore.open_system_popup(param, Callable()), "open_system_popup")
	await frames(2)


## The last button with a `UIButton` on the `Popup` layer: the button of the system popup on top.
func system_popup_button() -> Button:
	var found: Array[Button] = []
	_collect_buttons(UICore.get_layer(UICore.UILayer.POPUP), found)
	return found[found.size() - 1] if not found.is_empty() else null


func _collect_buttons(node: Node, found: Array[Button]) -> void:
	var button: Button = node as Button
	if button != null and button.is_visible_in_tree():
		for child: Node in button.get_children():
			if child is UIButton:
				found.append(button)
	for child: Node in node.get_children():
		_collect_buttons(child, found)
