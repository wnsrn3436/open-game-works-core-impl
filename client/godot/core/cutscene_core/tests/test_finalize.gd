extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Finalize: the skip input finalizes each in-progress command into its end state, and a new command of the same
## target finalizes the one in progress.

## The built translation key of a choice text of the core test data, for the choice of the cutscenes of `ROWS`.
const CHOICE_TEXT: String = "cutscene_choice.text.%d.3.1"

var _rows: ROWS = null
## Move of `hero` to `spot` without waiting, then to `spot_b`.
var _two_moves: int = 0
## Staging with an end, waiting, then a Choice.
var _staging_choice: int = 0


func before_each() -> void:
	super()
	_rows = ROWS.new()
	_two_moves = _rows.new_id()
	_rows.step(_two_moves, 1, GameData.CutsceneCommand.MOVE, false, "hero", "spot", MOVE)
	_rows.step(_two_moves, 2, GameData.CutsceneCommand.MOVE, true, "hero", "spot_b", MOVE)
	_rows.step(_two_moves, 3, GameData.CutsceneCommand.END)
	_staging_choice = _rows.new_id()
	_rows.step(_staging_choice, 1, GameData.CutsceneCommand.STAGING, true, "", "", STAGING)
	_rows.step(_staging_choice, 2, GameData.CutsceneCommand.CHOICE)
	_rows.step(_staging_choice, 3, GameData.CutsceneCommand.END)
	_rows.choice(_staging_choice, 2, 1, 3, 0, CHOICE_TEXT % id("[cut_skip_choice]"))


## The instances under the staging parent of the view.
func staged() -> Array[Node]:
	var found: Array[Node] = []
	for child: Node in view().staging_parent.get_children():
		if not child is SafeAreaIgnore:
			found.append(child)
	return found


func test_skip_during_a_waiting_move_puts_the_actor_at_the_target() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_move]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	var target: Vector2 = spot.global_position
	await advance(STEP_MS)
	assert_ne(hero.global_position, target, "the Move runs")
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_almost_eq(hero.global_position, target, Vector2(0.01, 0.01), "the Move is at its end")
	assert_eq(errors(), 0)


func test_skip_during_a_waiting_animate_applies_the_animation_end_state() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_animate]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	var player: AnimationPlayer = player_of(hero)
	assert_eq(player.current_animation, &"wave")
	assert_true(player.current_animation_position < WAVE_S)
	await press_skip()
	assert_true(call.done)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_almost_eq(player.current_animation_position, WAVE_S, 0.001, "the animation is at its end")
	assert_eq(cue_steps, PackedInt64Array([2]))
	await finish(call)
	assert_eq(errors(), 0)


func test_skip_during_a_waiting_staging_destroys_its_instance() -> void:
	assert_true(await start(true, true, _rows.tables()))
	var call: PLAY = await play_id(_staging_choice)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	var instances: Array[Node] = staged()
	assert_eq(instances.size(), 1, "the staging runs")
	await press_skip()
	await UnitTestCore.wait_frames(1)
	assert_true(choice_running(), "the skip stops at the Choice")
	assert_false(is_instance_valid(instances[0]), "the staging instance is destroyed")
	assert_eq(staged().size(), 0)
	assert_eq(shown_choices()[0].text, "Continue")
	await tap(shown_choices()[0])
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_skip_during_a_waiting_screen_effect_completes_it_at_its_end() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_stop]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND, "the ScreenEffect runs")
	var effect: ScreenEffectHandle = CutsceneCore._hold_command.effect
	assert_false(effect._done)
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_true(effect._done)
	assert_eq(effect._result, ScreenEffectCore.ScreenEffectResult.COMPLETED, "finalized, not cancelled at the end")
	assert_almost_eq(hero.global_position, spot.global_position, Vector2(0.01, 0.01), "the Move after it")
	assert_eq(errors(), 0)


func test_skip_during_a_waiting_camera_puts_the_camera_on_the_target() -> void:
	assert_true(await start())
	var camera: Camera2D = Camera2D.new()
	get_tree().root.add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	var call: PLAY = await play("[cut_camera]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND)
	await press_skip()
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.SKIPPED)
	assert_eq(cue_steps, PackedInt64Array([2]))
	var center: Vector3 = CameraCore.get_view_center()
	assert_almost_eq(Vector2(center.x, center.y), spot.global_position, Vector2(0.01, 0.01))
	assert_eq(errors(), 0)


func test_a_move_of_the_same_actor_finalizes_the_move_in_progress() -> void:
	assert_true(await start(true, true, _rows.tables()))
	var first_target: Vector2 = spot.global_position
	var call: PLAY = await play_id(_two_moves)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND, "the second Move runs")
	assert_almost_eq(hero.global_position, first_target, Vector2(0.01, 0.01), "the first Move is at its end")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	assert_almost_eq(hero.global_position, spot_b.global_position, Vector2(0.01, 0.01))
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_a_move_of_another_actor_does_not_finalize_the_move_in_progress() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_order]")
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_COMMAND, "the Move of sidekick runs")
	assert_almost_eq(hero.global_position, HERO_AT, Vector2(0.01, 0.01), "the Move of hero is not finalized")
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)
