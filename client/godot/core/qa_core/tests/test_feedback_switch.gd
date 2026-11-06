extends "res://core/qa_core/tests/support/qa_test_case.gd"
## The feedback switch: `set_feedback_off` and `set_reward_presentation_off`, the reward window, the module states both
## hold, `CameraCore` outside the module list, and `release`. Each module state is read from what its module does.

const WORLD: ScreenEffectCore.ScreenEffectChannel = ScreenEffectCore.ScreenEffectChannel.WORLD
const SFX: SoundCore.SoundBus = SoundCore.SoundBus.SFX
const UI: SoundCore.SoundBus = SoundCore.SoundBus.UI
const VOICE: SoundCore.SoundBus = SoundCore.SoundBus.VOICE
## Engine bus names of `Sfx`, `Ui` and `Voice`.
const SFX_BUS: StringName = &"Sfx"
const UI_BUS: StringName = &"Ui"
const VOICE_BUS: StringName = &"Voice"
const EFFECT_PREFILL: int = 32
const OFF: Array[bool] = [false, false, false, false, false, false]
const ALL_ON: Array[bool] = [true, true, true, true, true, true]
## Feedback off alone: DEV mute, shake skip, World skip, effect skip.
const FEEDBACK_OFF: Array[bool] = [true, false, true, true, true, false]
## A reward window alone: every state but DEV mute.
const REWARD_WINDOW: Array[bool] = [false, true, true, true, true, true]

## Feedback events received since `count_events`.
var sounds: int = 0
var shakes: int = 0
var screen_effects: int = 0
var tweens: int = 0
var effects: int = 0
var camera: Camera2D = null


func after_each() -> void:
	QACore.release()
	CameraCore.release()
	super()
	if is_instance_valid(camera):
		camera.queue_free()
	camera = null


## `start` with `CameraCore` in the module list and a camera attached when `with_camera`, then QACore, the click sound,
## the pool effects and the event counts.
func start_switch(with_camera: bool = true) -> bool:
	var ok: bool = await start(false)
	if with_camera:
		assert_true(CameraCore.init(), "CameraCore.init")
		camera = Camera2D.new()
		add_child(camera)
		assert_true(CameraCore.attach_camera(camera), "attach_camera")
	assert_true(QACore.init(), "QACore.init")
	var loaded: Resource = await ResourceCore.load(CLICK, ResourceCore.BaseKind.AUDIO_STREAM,
		ResourceCore.get_global_scope())
	assert_true(loaded is AudioStream, "the click sound loaded")
	var item: PrefillItem = PrefillItem.new()
	item.resource_key = EFFECT
	item.pool_scope = ResourceCore.get_global_scope()
	item.count = EFFECT_PREFILL
	assert_true(await PoolCore.prefill([item]), "PoolCore.prefill")
	count_events()
	return ok


func count_events() -> void:
	assert_true(EventCore.subscribe(SoundPlayedEvent, _on_sound_played))
	assert_true(EventCore.subscribe(ScreenEffectStartedEvent, _on_screen_effect_started))
	assert_true(EventCore.subscribe(TweenStartedEvent, _on_tween_started))
	assert_true(EventCore.subscribe(EffectSpawnedEvent, _on_effect_spawned))
	if CameraCore.is_initialized():
		assert_true(EventCore.subscribe(CameraShakeStartedEvent, _on_camera_shake_started))


func _on_sound_played(_event: SoundPlayedEvent) -> void:
	sounds += 1


func _on_screen_effect_started(_event: ScreenEffectStartedEvent) -> void:
	screen_effects += 1


func _on_tween_started(_event: TweenStartedEvent) -> void:
	tweens += 1


func _on_effect_spawned(_event: EffectSpawnedEvent) -> void:
	effects += 1


func _on_camera_shake_started(_event: CameraShakeStartedEvent) -> void:
	shakes += 1


func play_sound(bus: SoundCore.SoundBus) -> int:
	return SoundCore.play(CLICK, bus, ResourceCore.get_global_scope())


func bus_muted(bus_name: StringName) -> bool:
	return AudioServer.is_bus_mute(AudioServer.get_bus_index(bus_name))


## A `Position` x tween from 0 to 100 over 100 ms with `repeat_count` on a new node.
func play_tween(repeat_count: int) -> int:
	var change: TweenChange = TweenChange.new()
	change.property = TweenCore.TweenProperty.POSITION
	change.use_start_value = true
	change.start_value = Vector4.ZERO
	change.target_value = Vector4(100, 0, 0, 0)
	change.duration = 100
	var step: TweenStep = TweenStep.new()
	step.changes.append(change)
	var definition: TweenDefinition = TweenDefinition.new()
	definition.steps.append(step)
	definition.repeat_count = repeat_count
	var target: Node2D = Node2D.new()
	add_child_autofree(target)
	return TweenCore.play(definition, target)


func fade() -> ScreenEffectHandle:
	return ScreenEffectCore.fade(WORLD, self, Color.BLACK, 0.0, 1.0, 100)


## The module states, in the order of the module state table, read from what each module does now: the engine mute of
## `Sfx` and `Ui`, the invalid handle of `SoundCore.play`, and no event from `CameraCore.shake`, a `World` fade, a
## `PoolCore.borrow` of an auto-return effect and a tween of repeat count 1. A state of a module outside the module
## list reads off.
func module_states() -> Array[bool]:
	var states: Array[bool] = [bus_muted(SFX_BUS) and bus_muted(UI_BUS)]
	var handle: int = play_sound(VOICE)
	states.append(handle == SoundCore.INVALID_HANDLE)
	if handle != SoundCore.INVALID_HANDLE:
		SoundCore.stop(handle)
	if CameraCore.is_initialized():
		var shaken: int = shakes
		CameraCore.shake(0.1)
		states.append(shakes == shaken)
	else:
		states.append(false)
	var faded: int = screen_effects
	ScreenEffectCore.clear_handle(fade())
	states.append(screen_effects == faded)
	var spawned: int = effects
	var borrowed: Vector4i = PoolCore.borrow(EFFECT, ResourceCore.get_global_scope())
	assert_true(PoolCore.is_valid(borrowed), "an effect was lent")
	states.append(effects == spawned)
	if effects != spawned:
		PoolCore.give_back(borrowed)
	var started: int = tweens
	TweenCore.stop(play_tween(1))
	states.append(tweens == started)
	return states


func set_mode(command_name: String, mode: String) -> void:
	await run_ok(command_name, PackedStringArray([mode]))


func test_feedback_off_mutes_and_skips_the_feedback_and_off_brings_it_back() -> void:
	assert_true(await start_switch())
	var device: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
	var saved_mute: bool = LocalDataCore.get_value_bool(device, "SoundCore.sfx_mute", false)
	var saved_volume: float = LocalDataCore.get_value_float(device, "SoundCore.sfx_volume", 1.0)
	CameraCore.set_shake_scale(500)
	CameraCore.shake(1.0)
	await advance(16, 1)
	assert_ne(camera.global_position, Vector2.ZERO, "the shake moves the camera")
	await set_mode("set_feedback_off", "on")
	assert_eq(camera.global_position, Vector2.ZERO, "turning feedback off on stops the shake")
	assert_false(SoundCore.get_mute(SFX), "get_mute of Sfx is unchanged")
	assert_false(SoundCore.get_mute(UI), "get_mute of Ui is unchanged")
	assert_false(bus_muted(VOICE_BUS), "Voice is heard")
	assert_eq(module_states(), FEEDBACK_OFF)
	sounds = 0
	shakes = 0
	screen_effects = 0
	effects = 0
	await run_ok("tap", window_args(640, 600))
	assert_ne(play_sound(SFX), SoundCore.INVALID_HANDLE, "Sfx plays, silent")
	assert_ne(play_sound(UI), SoundCore.INVALID_HANDLE, "Ui plays, silent")
	CameraCore.shake(1.0)
	var frame: int = Engine.get_process_frames()
	var flashed: ScreenEffectHandle = ScreenEffectCore.flash(WORLD, self, Color.WHITE, 1.0, 100, 100, 100)
	assert_eq(await ScreenEffectCore.wait_result(flashed), ScreenEffectCore.ScreenEffectResult.COMPLETED)
	assert_eq(Engine.get_process_frames(), frame, "the World flash is Completed when it returns")
	assert_false(ScreenEffectCoreDev.get_overlay_state(WORLD).visible, "the overlay stays hidden")
	var borrowed: Vector4i = PoolCore.borrow(EFFECT, ResourceCore.get_global_scope())
	assert_true(PoolCore.is_valid(borrowed))
	assert_eq([sounds, shakes, screen_effects, effects], [0, 0, 0, 0], "no feedback event")
	await advance(16, 1)
	assert_eq(camera.global_position, Vector2.ZERO, "no shake offset")
	var json: String = await telemetry()
	assert_eq(JSONR.keys(json, "inputs.0.feedback"), PackedStringArray(), "the tap got no feedback")
	assert_ne(play_sound(VOICE), SoundCore.INVALID_HANDLE)
	assert_eq(sounds, 1, "Voice publishes SoundPlayedEvent")
	await set_mode("set_feedback_off", "off")
	assert_eq(module_states(), OFF, "each behaves as before")
	assert_true(shakes >= 1, "the shake comes back")
	CameraCore.stop_shake()
	CameraCore.shake(1.0)
	await advance(16, 1)
	assert_ne(camera.global_position, Vector2.ZERO, "the shake scale set before applies again")
	CameraCore.stop_shake()
	sounds = 0
	play_sound(SFX)
	assert_eq(sounds, 1, "Sfx publishes again")
	assert_eq(LocalDataCore.get_value_bool(device, "SoundCore.sfx_mute", false), saved_mute, "saved mute unchanged")
	assert_eq(LocalDataCore.get_value_float(device, "SoundCore.sfx_volume", 1.0), saved_volume, "saved volume unchanged")
	assert_eq(errors() + warns(), 0)


func test_the_shake_scale_is_the_one_set_before_feedback_off() -> void:
	assert_true(await start_switch())
	CameraCore.set_shake_scale(0)
	await set_mode("set_feedback_off", "on")
	await set_mode("set_feedback_off", "off")
	CameraCore.shake(1.0)
	await advance(16, 1)
	assert_eq(camera.global_position, Vector2.ZERO, "shake scale 0 set before on still applies after off")
	CameraCore.set_shake_scale(1000)
	CameraCore.shake(1.0)
	await advance(16, 1)
	assert_ne(camera.global_position, Vector2.ZERO)


func test_a_goal_mark_opens_the_reward_window_for_its_length_in_advanced_ms() -> void:
	assert_true(await start_switch())
	await set_mode("set_reward_presentation_off", "on")
	assert_eq(module_states(), OFF, "no window before a reward moment")
	tweens = 0
	var before: int = play_tween(1)
	QACore.mark(QACore.MarkKind.GOAL)
	assert_true(TweenCore.is_playing(before), "a tween made before the mark in the same frame plays")
	assert_eq(tweens, 1)
	var skipped: int = play_tween(1)
	var forever: int = play_tween(0)
	assert_eq(tweens, 2, "only the tween of repeat count 0 starts")
	sounds = 0
	shakes = 0
	screen_effects = 0
	effects = 0
	assert_eq(play_sound(SFX), SoundCore.INVALID_HANDLE, "SoundCore.play returns the invalid handle")
	CameraCore.shake(0.5)
	fade()
	PoolCore.borrow(EFFECT, ResourceCore.get_global_scope())
	assert_eq([sounds, shakes, screen_effects, effects], [0, 0, 0, 0], "no feedback event")
	await UnitTestCore.wait_frames(1)
	assert_false(TweenCore.is_playing(skipped), "the finite tween ended by the end of its frame")
	assert_true(TweenCore.is_playing(forever), "the tween of repeat count 0 plays")
	TweenCore.stop(forever)
	assert_eq(module_states(), REWARD_WINDOW)
	await advance(REWARD_WINDOW_MS - 1)
	assert_eq(module_states(), REWARD_WINDOW, "open before its length")
	await advance(1)
	assert_eq(module_states(), OFF, "the window ended: all of these play and publish their events")
	assert_eq(errors() + warns(), 0)


func test_a_second_reward_moment_in_the_window_keeps_it_open_from_the_second() -> void:
	assert_true(await start_switch())
	await set_mode("set_reward_presentation_off", "on")
	QACore.mark(QACore.MarkKind.GOAL)
	await advance(REWARD_WINDOW_MS / 2)
	QACore.mark(QACore.MarkKind.GOAL)
	await advance(REWARD_WINDOW_MS / 2 + 10)
	assert_eq(module_states(), REWARD_WINDOW, "open past the length from the first")
	await advance(REWARD_WINDOW_MS / 2)
	assert_eq(module_states(), OFF, "ended a length after the second")


func test_step_mode_holds_the_window_while_no_game_time_advances() -> void:
	assert_true(await start_switch())
	await set_mode("set_reward_presentation_off", "on")
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	QACore.mark(QACore.MarkKind.GOAL)
	await advance(REWARD_WINDOW_MS * 2)
	assert_eq(module_states(), REWARD_WINDOW, "time without a step is not advanced ms")
	await run_ok("set_step_mode", PackedStringArray(["off"]))
	await advance(REWARD_WINDOW_MS)
	assert_eq(module_states(), OFF)


func test_item_rewards_and_reward_marks_open_the_window_and_cheats_do_not() -> void:
	assert_true(await start_switch())
	await set_mode("set_reward_presentation_off", "on")
	var gold: int = GameDataDev.find_id_value("[gold]")
	publish_change(gold, 1, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_CHEAT)
	assert_eq(module_states(), OFF, "a Cheat change is no reward moment")
	publish_change(gold, 1, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_REQUEST)
	assert_eq(module_states(), REWARD_WINDOW, "an item change of amount 1 opens the window")
	await advance(REWARD_WINDOW_MS)
	assert_eq(module_states(), OFF)
	QACore.mark(QACore.MarkKind.REWARD, 7)
	assert_eq(module_states(), REWARD_WINDOW, "a Reward mark opens the window")
	await set_mode("set_reward_presentation_off", "off")
	assert_eq(module_states(), OFF, "off closes the window")
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(module_states(), OFF, "with reward presentation off off, a Goal mark skips nothing")


func publish_change(item_id: int, delta: int, source: CoreContract.ItemChangeSource) -> void:
	var item: CoreContract.ItemChange = CoreContract.ItemChange.new()
	item.item_id = item_id
	item.delta = delta
	item.source = source
	var event: ItemChangedEvent = EventCore.acquire(ItemChangedEvent) as ItemChangedEvent
	event.changes = [item]
	EventCore.publish(event)


func test_the_states_both_switches_use_stay_on_while_either_needs_them() -> void:
	assert_true(await start_switch())
	await set_mode("set_feedback_off", "on")
	await set_mode("set_reward_presentation_off", "on")
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(module_states(), ALL_ON)
	await advance(REWARD_WINDOW_MS)
	assert_eq(module_states(), FEEDBACK_OFF, "the end of the window leaves the shake, World and effect skips on")
	QACore.mark(QACore.MarkKind.GOAL)
	await set_mode("set_feedback_off", "off")
	assert_eq(module_states(), REWARD_WINDOW, "feedback off off inside the window leaves them on")
	await advance(REWARD_WINDOW_MS)
	assert_eq(module_states(), OFF, "until the window ends")


func test_a_wrong_mode_fails_and_changes_no_module_state() -> void:
	assert_true(await start_switch())
	assert_false((await run("set_feedback_off", PackedStringArray(["yes"]))).ok)
	assert_false((await run("set_reward_presentation_off", PackedStringArray(["On"]))).ok)
	assert_eq(warns(), 2)
	assert_eq(module_states(), OFF)
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(module_states(), OFF, "reward presentation off stayed off")


func test_without_camera_core_the_commands_succeed_without_its_row() -> void:
	assert_true(await start_switch(false))
	await set_mode("set_feedback_off", "on")
	await set_mode("set_reward_presentation_off", "on")
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(module_states(), [true, true, false, true, true, true] as Array[bool])
	assert_eq(errors(), 0)
	assert_eq(UnitTestCore.check_logs(ERROR, "CameraCore"), 0, "no CameraCore operation was called")


func test_release_turns_every_module_state_off() -> void:
	assert_true(await start_switch())
	await set_mode("set_feedback_off", "on")
	await set_mode("set_reward_presentation_off", "on")
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(module_states(), ALL_ON)
	QACore.release()
	assert_eq(module_states(), OFF)
	assert_true(QACore.init())
	QACore.mark(QACore.MarkKind.GOAL)
	assert_eq(module_states(), OFF, "both switches are off at init")


func test_the_frame_code_that_ends_a_reward_window_allocates_no_memory() -> void:
	assert_true(await start_switch())
	await set_mode("set_feedback_off", "on")
	await set_mode("set_reward_presentation_off", "on")
	QACore.mark(QACore.MarkKind.GOAL)
	await advance(REWARD_WINDOW_MS)
	assert_eq(module_states(), FEEDBACK_OFF, "the window ended")
	# The ballast raises static memory to its peak, so any allocation in the loop raises the peak, even one freed before
	# the loop ends. It is made before the first read: the array object stays until the test ends.
	var ballast: PackedByteArray = PackedByteArray()
	LogCore.release()
	_end_windows(100)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	ballast.resize(int(Performance.get_monitor(Performance.MEMORY_STATIC_MAX) - memory) + 1)
	var peak: float = Performance.get_monitor(Performance.MEMORY_STATIC_MAX)
	_end_windows(1000)
	# All are read before the first assert, which allocates.
	var peak_after: float = Performance.get_monitor(Performance.MEMORY_STATIC_MAX)
	ballast.clear()
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(memory > 0.0, "static memory is measured")
	assert_true(objects_after <= objects, "object count")
	assert_true(memory_after <= memory, "static memory")
	assert_true(peak_after <= peak, "static memory peak: no allocation freed inside the loop")
	assert_eq(module_states(), FEEDBACK_OFF, "each end left the module states as they were")


## Reopens the reward window past its length and runs the frame start check that ends it, `times` times.
func _end_windows(times: int) -> void:
	for i: int in times:
		QACore._reward_window_open = true
		QACore._check_reward_window()
