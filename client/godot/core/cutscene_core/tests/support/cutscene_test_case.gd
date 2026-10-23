extends UnitTestCase
## Base of the CutsceneCore core tests: settings, test resources, module start, actors, playback calls and input.

const FLAGS := preload("res://core/cutscene_core/tests/support/cutscene_test_flags.gd")
const PLAY := preload("res://core/cutscene_core/tests/support/cutscene_play_call.gd")
const ROWS := preload("res://core/cutscene_core/tests/support/cutscene_test_rows.gd")

const RESOURCES: String = "res://core/cutscene_core/tests/resources/"
const VIEW: String = "prefab/cutscene_test_view"
const VIEW_ACTION: String = "prefab/cutscene_test_view_action"
const HISTORY_ITEM: String = "prefab/cutscene_test_history_item"
const STAGING: String = "prefab/cutscene_test_staging"
const STAGING_ENDLESS: String = "prefab/cutscene_test_staging_endless"
const MOVE: String = "tween/cutscene_test_move"
const MOVE_TWO: String = "tween/cutscene_test_move_two"
const SCALE: String = "tween/cutscene_test_scale"
const FADE: String = "tween/cutscene_test_fade"
## A tween preset with no step, one whose step 0 has no change and a Position change in step 1 (`MOVE_MS`), one whose
## first change lasts `MOVE_MS` + 1, one whose first change lasts -1 ms, and a tween preset key that is not in the test
## key list.
const EMPTY: String = "tween/cutscene_test_empty"
const EMPTY_STEP: String = "tween/cutscene_test_empty_step"
const LONG: String = "tween/cutscene_test_long"
const NEGATIVE: String = "tween/cutscene_test_negative"
const MISSING_TWEEN: String = "tween/cutscene_test_missing"
const PORTRAIT: String = "image/cutscene_test_portrait"
const VOICE_HELLO: String = "voice/cutscene_test_hello"
const VOICE_H1: String = "voice/cutscene_test_h1"
const VOICE_H3: String = "voice/cutscene_test_h3"
const VOICE_SKIP: String = "voice/cutscene_test_skip"
const VOICE_STOP: String = "voice/cutscene_test_stop"
const HIT: String = "sfx/cutscene_test_hit"
const LOOP: String = "sfx/cutscene_test_loop"
const BGM_A: String = "bgm/cutscene_test_a"
const BGM_B: String = "bgm/cutscene_test_b"
## The resource key of `[ui_button_click]` in the core test data.
const CLICK: String = "sfx/ui_button_click"
## The `input_prompt` icons of the core test data.
const ICONS: PackedStringArray = ["icon/key_escape", "icon/key_j", "icon/pad_b", "icon/ps_circle"]

## Length of `tween/cutscene_test_move`, and of each step of `tween/cutscene_test_move_two`.
const MOVE_MS: int = 100
const STEP_MS: int = 50
## Length of the `burst` animation of the staging with an end, and of the `wave` animation of the actors, in seconds.
const BURST_S: float = 0.5
const WAVE_S: float = 1.0
const AUTO_MS: int = 300
## Length of the test voice: 4000 samples at 1000 Hz.
const VOICE_MS: int = 4000
const FAST_FORWARD_MS: int = 100
const HISTORY_MAX: int = 10
const TAG: String = "CutsceneCore"
const ERROR: String = "error"

## Positions of the actors the tests make.
const HERO_AT: Vector2 = Vector2(10, 20)
const SIDEKICK_AT: Vector2 = Vector2(-30, 40)
const SPOT_AT: Vector2 = Vector2(200, 120)
const SPOT_B_AT: Vector2 = Vector2(-80, 300)

## `step` and `cue` of every `CutsceneCueEvent`, in order.
var cue_steps: PackedInt64Array = PackedInt64Array()
var cue_values: Array[GameData.CutsceneCue] = []
var cue_ids: PackedInt64Array = PackedInt64Array()
var scope: Scope = null
var hero: Node2D = null
var sidekick: Node2D = null
var spot: Node2D = null
var spot_b: Node2D = null
## Variant count of `LOOP` in the test key list: 2 loads `test_loop.1.tres` and `test_loop.2.tres`, both repeating.
var loop_variants: int = 1


func before_each() -> void:
	super()
	FLAGS.reset()
	cue_steps = PackedInt64Array()
	cue_values = []
	cue_ids = PackedInt64Array()
	scope = null
	hero = null
	sidekick = null
	spot = null
	spot_b = null
	loop_variants = 1
	set_setting("UICore.buttonClickIntervalMs", 0)
	set_setting("cutsceneView", VIEW)
	set_setting("CutsceneCore.typingIntervalMs", 0)
	set_setting("CutsceneCore.autoAdvanceDelayMs", AUTO_MS)
	set_setting("CutsceneCore.fastForwardDelayMs", FAST_FORWARD_MS)
	set_setting("CutsceneCore.lineHistoryMaxCount", HISTORY_MAX)


# ogw:input_boundary
func set_setting(key: String, value: Variant) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## The test key list (`loop_variants` sets the variants of `LOOP`): every test resource, `[ui_button_click]` and the `input_prompt` icons.
func resource_keys() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		VIEW: RESOURCES + "test_view.tscn",
		VIEW_ACTION: RESOURCES + "test_view_action.tscn",
		HISTORY_ITEM: RESOURCES + "test_history_item.tscn",
		STAGING: RESOURCES + "test_staging.tscn",
		STAGING_ENDLESS: RESOURCES + "test_staging_endless.tscn",
		MOVE: RESOURCES + "test_move.tres",
		MOVE_TWO: RESOURCES + "test_move_two.tres",
		SCALE: RESOURCES + "test_scale.tres",
		FADE: RESOURCES + "test_fade.tres",
		EMPTY: RESOURCES + "test_empty.tres",
		EMPTY_STEP: RESOURCES + "test_empty_step.tres",
		LONG: RESOURCES + "test_long.tres",
		NEGATIVE: RESOURCES + "test_negative.tres",
		PORTRAIT: RESOURCES + "test_portrait.tres",
		VOICE_HELLO: RESOURCES + "test_voice.tres",
		VOICE_H1: RESOURCES + "test_voice.tres",
		VOICE_H3: RESOURCES + "test_voice.tres",
		VOICE_SKIP: RESOURCES + "test_voice.tres",
		VOICE_STOP: RESOURCES + "test_voice.tres",
		HIT: RESOURCES + "test_hit.tres",
		LOOP: RESOURCES + "test_loop.tres",
		BGM_A: RESOURCES + "test_bgm.tres",
		BGM_B: RESOURCES + "test_bgm.tres",
		CLICK: RESOURCES + "test_hit.tres",
	}
	for icon: String in ICONS:
		keys[icon] = RESOURCES + "test_icon.tres"
	return keys


## Starts CutsceneCore and the modules it depends on in module list order, with the core test data and translation,
## the test resources unless `load_all` is false, `UICore.prepare`, the judge hooks of `FlagA` to `FlagC`, a playback
## scope and the actors `hero`, `sidekick`, `spot` and `spot_b`. Settings are set before. `tables` replaces built-in
## table binaries: the data loads as downloaded data with them (`ROWS.tables`). Async.
func start(
	init_cutscene: bool = true, load_all: bool = true, tables: Dictionary[String, PackedByteArray] = {}
) -> bool:
	var variants: Dictionary[String, int] = {}
	if loop_variants > 1:
		variants[LOOP] = loop_variants
	ResourceCoreDev.set_test_key_list(resource_keys(), variants)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and UserStateCore.init() and ResolutionCore.init()
		and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init() and LocalizationCore.init()
		and SoundCore.init() and TweenCore.init() and CameraCore.init() and UICore.init()
		and ScreenEffectCore.init() and MessageCore.init() and NetworkCore.init() and RequirementCore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	LocalDataCore.load_device_file()
	var downloaded: DownloadedData = null
	if not tables.is_empty():
		downloaded = DataCoreTestSupport.write_downloaded("cutscene_core_test/data",
				DataCoreTestSupport.other_version(str(tables.keys())), tables)
	var loaded: bool = await DataCore.load(downloaded)
	assert_true(loaded, "DataCore.load")
	LocalizationCore.resolve_language()
	var translated: bool = await LocalizationCore.load_translation([])
	assert_true(translated, "LocalizationCore.load_translation")
	if load_all:
		assert_true(await load_resources(), "load the test resources")
	var prepared: bool = await UICore.prepare()
	assert_true(prepared, "UICore.prepare")
	# The flags change without a UserState change number, so the judges are time-dependent: RequirementCore keeps no
	# cache and every `evaluate` sees the flags the test set.
	var kinds: Array[GDScript] = []
	assert_true(
		RequirementCore.register_judge(GameData.RequirementType.FLAG_A, FLAGS.judge_a, kinds, "", Callable(), true), "FlagA judge"
	)
	assert_true(
		RequirementCore.register_judge(GameData.RequirementType.FLAG_B, FLAGS.judge_b, kinds, "", Callable(), true), "FlagB judge"
	)
	assert_true(
		RequirementCore.register_judge(GameData.RequirementType.FLAG_C, FLAGS.judge_c, kinds, "", Callable(), true), "FlagC judge"
	)
	assert_true(EventCore.subscribe(CutsceneCueEvent, _on_cue), "subscribe CutsceneCueEvent")
	scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, "cutscene_test")
	if not init_cutscene:
		return loaded and translated and prepared
	var initialized: bool = CutsceneCore.init()
	assert_true(initialized, "CutsceneCore.init")
	if not initialized:
		return false
	hero = make_actor("hero", HERO_AT)
	sidekick = make_actor("sidekick", SIDEKICK_AT)
	spot = make_actor("spot", SPOT_AT)
	spot_b = make_actor("spot_b", SPOT_B_AT)
	return loaded and translated and prepared


## Loads every resource of the test key list into the global scope and waits for the result. The threaded loads end
## before a playback starts, so the preload of a playback and its sounds and tweens take the cached resources, and the
## frames a test waits for are the frames of the playback, not of the engine load threads.
func load_resources() -> bool:
	var request: PreloadRequest = PreloadRequest.new()
	for key: String in resource_keys():
		var kind: int = ResourceCore.BaseKind.AUDIO_STREAM
		if key.begins_with("prefab/"):
			kind = ResourceCore.BaseKind.PACKED_SCENE
		elif key.begins_with("tween/"):
			kind = TweenCore.get_preset_kind()
		elif key.begins_with("image/") or key.begins_with("icon/"):
			kind = ResourceCore.BaseKind.TEXTURE_2D
		request.add_item(key, kind)
	return await ResourceCore.preload_resources(request, ResourceCore.get_global_scope())


func _on_cue(event: CutsceneCueEvent) -> void:
	cue_ids.append(event.cutscene_id)
	cue_steps.append(event.step)
	cue_values.append(event.cue)


## A `Node2D` actor at `position` under `parent` (the tree root when `null`), with a `CutsceneActor` of `actor_key` and
## an `AnimationPlayer` that has `wave` (`WAVE_S`, no repeat) and `idle` (repeats). It registers itself.
func make_actor(actor_key: String, position: Vector2, parent: Node = null) -> Node2D:
	var actor: Node2D = Node2D.new()
	actor.name = actor_key
	actor.position = position
	var player: AnimationPlayer = AnimationPlayer.new()
	var library: AnimationLibrary = AnimationLibrary.new()
	var wave: Animation = Animation.new()
	wave.length = WAVE_S
	wave.loop_mode = Animation.LOOP_NONE
	library.add_animation(&"wave", wave)
	var idle: Animation = Animation.new()
	idle.length = 1.0
	idle.loop_mode = Animation.LOOP_LINEAR
	library.add_animation(&"idle", idle)
	player.add_animation_library(&"", library)
	actor.add_child(player)
	var component: CutsceneActor = CutsceneActor.new()
	component.actor_key = actor_key
	component.animation_player = player
	actor.add_child(component)
	if parent == null:
		get_tree().root.add_child(actor)
		autofree(actor)
	else:
		parent.add_child(actor)
	return actor


## A `Node3D` actor at `position` under `parent` (the tree root when `null`), with a `CutsceneActor` of `actor_key` and
## no animation. It registers itself.
func make_actor_3d(actor_key: String, position: Vector3, parent: Node = null) -> Node3D:
	var actor: Node3D = Node3D.new()
	actor.name = actor_key
	actor.position = position
	var component: CutsceneActor = CutsceneActor.new()
	component.actor_key = actor_key
	actor.add_child(component)
	if parent == null:
		get_tree().root.add_child(actor)
		autofree(actor)
	else:
		parent.add_child(actor)
	return actor


func player_of(actor: Node2D) -> AnimationPlayer:
	for child: Node in actor.get_children():
		if child is AnimationPlayer:
			return child as AnimationPlayer
	return null


func id(id_name: String) -> int:
	return GameDataDev.find_id_value(id_name)


## Starts `CutsceneCore.play` of `id_name` without waiting, then waits until the view is attached or the call ended.
## Async.
func play(id_name: String, args: FormatArgs = null, skippable: bool = true) -> PLAY:
	var call: PLAY = PLAY.new()
	call.play(id(id_name), scope, args, skippable)
	await wait_view(call)
	return call


## `play` of the cutscene ID value `cutscene_id`: a cutscene of `ROWS`. Async.
func play_id(cutscene_id: int) -> PLAY:
	var call: PLAY = PLAY.new()
	call.play(cutscene_id, scope, null, true)
	await wait_view(call)
	return call


## Starts `CutsceneCore.play` of `id_name` with the default skippable flag and arguments. Async.
func play_default(id_name: String) -> PLAY:
	var call: PLAY = PLAY.new()
	call.play_default(id(id_name), scope)
	await wait_view(call)
	return call


## Waits until the view is attached or the play ended, checking once a frame. The wait ends when CutsceneCore is
## released, as the test time limit does, so that a failing test ends.
func wait_view(call: PLAY) -> void:
	while not call.done and CutsceneCore._view == null and CutsceneCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	assert_true(call.done or CutsceneCore._view != null, "the view is attached or the play ended")


## Moves the test clock by `ms` of foreground time and lets the modules process it.
func advance(ms: int, frames: int = 1) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(frames)


## Waits for the result of the play call, then one frame, so that the playback ends the call that ended the play.
## `CutsceneCore.release`, as at the test time limit, ends the play too.
func finish(call: PLAY) -> void:
	if call.done:
		return
	await call.finished
	await UnitTestCore.wait_frames(1)


func view() -> CutsceneView:
	return CutsceneCore._view


func view_root() -> Control:
	return CutsceneCore._view_root


func root() -> Control:
	return CutsceneCore._root


func text_label() -> RichTextLabel:
	return view().text_label


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, TAG)


## The `UIButton` child of `control`.
func ui_button_of(control: Control) -> UIButton:
	for child: Node in control.get_children():
		if child is UIButton:
			return child as UIButton
	return null


## Game coordinates of the center of `control`, with the offset of its UI layer.
func center_of(control: Control) -> Vector2:
	var center: Vector2 = control.get_global_rect().get_center()
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.CUTSCENE)
	if layer != null and layer.is_ancestor_of(control):
		center += layer.offset
	return center


## A pointer click on `control`, then one frame.
func tap(control: Control) -> void:
	UnitTestCore.tap(center_of(control))
	await UnitTestCore.wait_frames(1)


## A click of `button` through its `pressed` signal, as when the pointer cannot reach it, then one frame.
func click(button: Button) -> void:
	button.pressed.emit()
	await UnitTestCore.wait_frames(1)


## Presses and releases `keycode` in one frame, then one frame.
func press_key(keycode: Key) -> void:
	var press: InputEventKey = InputEventKey.new()
	press.keycode = keycode
	press.physical_keycode = keycode
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var release: InputEventKey = press.duplicate() as InputEventKey
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	await UnitTestCore.wait_frames(1)


func press_pad(button: JoyButton) -> void:
	var press: InputEventJoypadButton = InputEventJoypadButton.new()
	press.button_index = button
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var release: InputEventJoypadButton = press.duplicate() as InputEventJoypadButton
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	await UnitTestCore.wait_frames(1)


## One `cutscene_advance` input: the Space key.
func press_advance() -> void:
	await press_key(KEY_SPACE)


## One `cutscene_skip` input: the Tab key.
func press_skip() -> void:
	await press_key(KEY_TAB)


## One back input: the Escape key.
func press_back() -> void:
	await press_key(KEY_ESCAPE)


## The visible choice buttons of the view, in order.
func shown_choices() -> Array[Button]:
	var shown: Array[Button] = []
	for button: Button in view().choice_buttons:
		if button.visible:
			shown.append(button)
	return shown


## The keys of the playing `SoundCore.play` requests of `bus`.
func playing(bus: SoundCore.SoundBus) -> PackedStringArray:
	var buffer: Array[SoundPlayingRecord] = []
	buffer.resize(32)
	var count: int = SoundCoreDev.get_playing(buffer)
	var keys: PackedStringArray = PackedStringArray()
	for index: int in count:
		if buffer[index].bus == bus:
			keys.append(buffer[index].key)
	return keys


## The reasons of the active blocks.
func block_reasons() -> PackedStringArray:
	var buffer: Array[ActiveBlockInfo] = []
	buffer.resize(16)
	var count: int = InputBlockCoreDev.list_active(buffer)
	var reasons: PackedStringArray = PackedStringArray()
	for index: int in count:
		reasons.append(buffer[index].reason)
	return reasons


## The system popup root of `UICore`: the pass list element of `UICore.get_block_pass_list`.
func system_root() -> Control:
	var pass_list: BlockPassList = UICore.get_block_pass_list()
	if pass_list == null or pass_list.elements.is_empty():
		return null
	return pass_list.elements[0]


## The button of the shown system popup whose text is the translation of `label_key`, or `null`.
func system_button(label_key: String) -> Button:
	var system: Control = system_root()
	if system == null:
		return null
	var text: String = LocalizationCore.get_text(label_key)
	for node: Node in system.find_children("*", "Button", true, false):
		var button: Button = node as Button
		if button.text == text and button.is_visible_in_tree():
			return button
	return null


## Waits until the pause popup shows, checking once a frame: a system popup has no open event. The wait ends when
## CutsceneCore is released, as the test time limit does.
func wait_pause_popup() -> void:
	while system_button(ReservedString.cutscene_pause_resume()) == null and CutsceneCore.is_initialized():
		await UnitTestCore.wait_frames(1)


## Whether the playback waits on a running `Line`.
func line_running() -> bool:
	return CutsceneCore._hold == CutsceneCore._HOLD_LINE


## Whether the playback waits on a running `Choice`.
func choice_running() -> bool:
	return CutsceneCore._hold == CutsceneCore._HOLD_CHOICE
