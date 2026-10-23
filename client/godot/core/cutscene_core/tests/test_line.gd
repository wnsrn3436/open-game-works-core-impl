extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Line progress: typing, advance input, text conversion, auto advance, fast forward and line voice.

const TYPING_MS: int = 100

## `SoundPlayedEvent`s of the `Voice` bus.
var voices_played: int = 0


func before_each() -> void:
	super()
	voices_played = 0


func _on_sound(event: SoundPlayedEvent) -> void:
	if event.bus == SoundCore.SoundBus.VOICE:
		voices_played += 1


## The number of characters the text element shows.
func shown() -> int:
	var label: RichTextLabel = text_label()
	return label.get_total_character_count() if label.visible_characters < 0 else label.visible_characters


## The `text` translation key of `step` of the cutscene `id_name`.
func text_key(id_name: String, step: int) -> String:
	for row: GameData.CutsceneStepRow in GameData.CutsceneStepTable.get_rows(id(id_name)):
		if row.step == step:
			return row.text
	return ""


func font_size() -> int:
	return text_label().get_theme_font_size(&"normal_font_size")


func test_typing_shows_one_more_character_every_interval() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	assert_eq(CutsceneCore._line_total, 5)
	assert_eq(shown(), 0)
	for k: int in range(1, 5):
		await advance(TYPING_MS)
		assert_eq(shown(), k, "%d intervals" % k)
	await advance(TYPING_MS)
	assert_eq(shown(), 5)
	assert_true(line_running())
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_typing_interval_zero_shows_the_whole_text_at_the_start() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	assert_eq(shown(), 5)
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_advance_input_during_typing_shows_the_whole_text_and_the_next_one_ends_the_line() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await advance(TYPING_MS)
	assert_eq(shown(), 1)
	await tap(view().advance_button)
	assert_eq(shown(), 5)
	assert_true(line_running(), "the line does not end")
	await tap(view().advance_button)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_one_frame_of_cutscene_advance_during_typing_shows_the_whole_text_without_ending_the_line() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await press_advance()
	assert_eq(shown(), 5)
	await UnitTestCore.wait_frames(2)
	assert_true(line_running())
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_an_advance_button_click_while_the_cutscene_advance_key_is_held_is_not_a_second_advance_input() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	var press: InputEventKey = InputEventKey.new()
	press.keycode = KEY_SPACE
	press.physical_keycode = KEY_SPACE
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	await UnitTestCore.wait_frames(1)
	assert_eq(shown(), 5, "the key press is one advance input")
	await tap(view().advance_button)
	await UnitTestCore.wait_frames(1)
	assert_true(line_running(), "the click while the key is held is not an advance input")
	var release: InputEventKey = press.duplicate() as InputEventKey
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	await UnitTestCore.wait_frames(2)
	assert_true(line_running(), "the key release is not an advance input")
	await tap(view().advance_button)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED, "a click after the release is an advance input")
	assert_eq(errors(), 0)


func test_an_advance_button_click_after_the_cutscene_advance_key_release_in_the_same_frame_is_an_advance_input() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(2)
	var next: int = CutsceneCore._next
	var press: InputEventKey = InputEventKey.new()
	press.keycode = KEY_SPACE
	press.physical_keycode = KEY_SPACE
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	await UnitTestCore.wait_frames(3)
	assert_eq(CutsceneCore._next, next + 1, "the key press is one advance input")
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	var release: InputEventKey = press.duplicate() as InputEventKey
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	assert_false(InputCore.is_pressed(&"cutscene_advance"), "the key is released before the click")
	UnitTestCore.tap(center_of(view().advance_button))
	await UnitTestCore.wait_frames(3)
	assert_eq(CutsceneCore._next, next + 2, "the click after the release is an advance input")
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_advance_input_outside_a_line_does_not_change_the_step_run() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_wait]")
	await press_advance()
	await tap(view().advance_button)
	assert_eq(CutsceneCore._hold, CutsceneCore._HOLD_WAIT)
	assert_eq(CutsceneCore._next, 2)
	await advance(MOVE_MS)
	await UnitTestCore.wait_frames(1)
	await advance(200)
	await finish(call)
	assert_eq(cue_steps, PackedInt64Array([3]))
	assert_eq(errors(), 0)


func test_the_text_is_the_conversion_with_the_format_args_and_keeps_the_input_prompt_of_the_line_start() -> void:
	assert_true(await start())
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", 3)
	var call: PLAY = await play("[cut_format]", args)
	assert_eq(text_label().text, LocalizationCore.format(text_key("[cut_format]", 1), args, font_size()))
	assert_true(text_label().text.contains("3"))
	await press_advance()
	var prompt_text: String = LocalizationCore.format(text_key("[cut_format]", 2), args, font_size())
	assert_eq(text_label().text, prompt_text)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(1)
	assert_ne(LocalizationCore.format(text_key("[cut_format]", 2), args, font_size()), prompt_text,
			"the input prompt changed")
	assert_eq(text_label().text, prompt_text, "the line keeps the input prompt of its start")
	await tap(view().advance_button)
	await finish(call)
	assert_eq(errors(), 0)


func test_an_inline_icon_counts_as_one_character_in_typing() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	assert_true(await LocalizationCore.load_prompt_icons())
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", 3)
	var call: PLAY = await play("[cut_format]", args)
	await press_advance()
	await press_advance()
	assert_eq(CutsceneCore._steps[CutsceneCore._next - 1].step, 2)
	assert_true(text_label().text.contains("[img="), "the line has an inline icon")
	assert_eq(CutsceneCore._line_total, "Press ".length() + 1)
	await advance(TYPING_MS * 6)
	assert_eq(shown(), 6)
	await advance(TYPING_MS)
	assert_eq(shown(), 7)
	assert_true(CutsceneCore._full_at_ms >= 0)
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_auto_advance_ends_a_line_without_voice_after_its_delay() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	assert_false(view().auto_advance_button.button_pressed)
	await tap(view().auto_advance_button)
	assert_true(view().auto_advance_button.button_pressed, "the button shows the on state")
	await advance(AUTO_MS - 1)
	assert_true(line_running())
	await advance(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_fast_forward_shows_the_whole_text_at_once_and_ends_the_line_after_its_delay() -> void:
	set_setting("CutsceneCore.typingIntervalMs", TYPING_MS)
	assert_true(await start())
	var call: PLAY = await play("[cut_history]")
	await tap(view().fast_forward_button)
	assert_true(view().fast_forward_button.button_pressed)
	assert_eq(shown(), text_label().get_total_character_count())
	await advance(FAST_FORWARD_MS)
	assert_eq(CutsceneCore._next, 2, "the second line runs")
	assert_eq(shown(), text_label().get_total_character_count(), "the whole text at the start")
	await advance(FAST_FORWARD_MS - 1)
	assert_eq(CutsceneCore._next, 2)
	await advance(1)
	assert_eq(CutsceneCore._next, 3)
	await advance(FAST_FORWARD_MS)
	await finish(call)
	assert_eq(errors(), 0)


func test_fast_forward_wins_over_auto_advance_and_both_are_off_at_the_next_playback() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await tap(view().auto_advance_button)
	await tap(view().fast_forward_button)
	await advance(FAST_FORWARD_MS)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED, "ended at the fast forward delay")
	call = await play("[cut_plain]")
	assert_false(CutsceneCore._auto_on)
	assert_false(CutsceneCore._fast_forward_on)
	assert_false(view().auto_advance_button.button_pressed)
	assert_false(view().fast_forward_button.button_pressed)
	await advance(AUTO_MS)
	assert_true(line_running(), "neither auto advance nor fast forward")
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_the_line_voice_plays_in_the_voice_bus_and_stops_in_the_frame_the_line_ends() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await UnitTestCore.wait_frames(1)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_HELLO]))
	await press_advance()
	assert_eq(playing(SoundCore.SoundBus.VOICE).size(), 0, "advance input")
	await finish(call)
	call = await play("[cut_line]")
	await UnitTestCore.wait_frames(1)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_HELLO]))
	await press_skip()
	assert_eq(playing(SoundCore.SoundBus.VOICE).size(), 0, "skip input")
	await finish(call)
	assert_eq(errors(), 0)


func test_auto_advance_waits_for_voice_end() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await tap(view().auto_advance_button)
	await advance(AUTO_MS * 2)
	assert_true(line_running(), "the voice plays")
	SoundCore.stop(CutsceneCore._voice_handle)
	await UnitTestCore.wait_frames(1)
	await advance(AUTO_MS - 1)
	assert_true(line_running())
	await advance(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_auto_advance_follows_a_voice_that_ends_at_its_length() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_line]")
	await tap(view().auto_advance_button)
	await advance(VOICE_MS - 1)
	assert_true(SoundCore.is_playing(CutsceneCore._voice_handle), "1 ms before the voice length")
	assert_true(line_running())
	await advance(1)
	assert_false(SoundCore.is_playing(CutsceneCore._voice_handle), "the voice ends at its length")
	await advance(AUTO_MS - 1)
	assert_true(line_running())
	await advance(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_lines_started_in_fast_forward_and_in_skip_application_play_no_voice() -> void:
	assert_true(await start())
	assert_true(EventCore.subscribe(SoundPlayedEvent, _on_sound))
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(1)
	assert_eq(voices_played, 1, "the first line plays its voice")
	await tap(view().fast_forward_button)
	await advance(FAST_FORWARD_MS)
	await advance(FAST_FORWARD_MS)
	assert_eq(CutsceneCore._next, 3, "the third line runs")
	await UnitTestCore.wait_frames(1)
	assert_eq(voices_played, 1, "the third line started in fast forward")
	assert_eq(playing(SoundCore.SoundBus.VOICE).size(), 0)
	await advance(FAST_FORWARD_MS)
	await finish(call)
	call = await play("[cut_skip]")
	voices_played = 0
	await press_skip()
	await finish(call)
	await UnitTestCore.wait_frames(1)
	assert_eq(voices_played, 0, "the skipped line plays no voice")
	assert_eq(errors(), 0)
