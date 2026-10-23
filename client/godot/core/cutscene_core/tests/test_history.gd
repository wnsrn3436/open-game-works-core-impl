extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## Line history: the items, the limit, the window and its input, back input and replay voice.


## The bound items of the line history list, from index 0.
func items() -> Array[CutsceneLineHistoryItem]:
	var found: Array[CutsceneLineHistoryItem] = []
	for child: Node in view().line_history_list.get_children():
		var item: CutsceneLineHistoryItem = child as CutsceneLineHistoryItem
		if item != null and (child as Control).visible:
			found.append(item)
	found.sort_custom(func(a: CutsceneLineHistoryItem, b: CutsceneLineHistoryItem) -> bool:
		return (a as Node as Control).position.y < (b as Node as Control).position.y)
	return found


## Opens the line history window and waits for the list. Async.
func open_history() -> void:
	await click(view().line_history_button)
	await UnitTestCore.wait_frames(3)
	assert_true(CutsceneCore._history_open)
	assert_true(view().line_history_window.visible)


func test_the_line_history_keeps_the_latest_lines_up_to_its_limit_with_the_oldest_at_index_zero() -> void:
	set_setting("CutsceneCore.lineHistoryMaxCount", 2)
	assert_true(await start())
	var call: PLAY = await play("[cut_history]")
	assert_eq(CutsceneCore._history.size(), 1)
	await press_advance()
	assert_eq(CutsceneCore._history.size(), 2)
	await press_advance()
	assert_eq(CutsceneCore._history.size(), 2, "the limit")
	assert_eq(CutsceneCore._history[0].text, "Second", "the oldest line is gone")
	assert_eq(CutsceneCore._history[1].text, "Third")
	await open_history()
	var shown: Array[CutsceneLineHistoryItem] = items()
	assert_eq(shown.size(), 2)
	assert_eq(shown[0].text_label.text, "Second")
	assert_false(shown[0].speaker_label.visible, "no speaker")
	assert_false(shown[0].voice_button.visible, "no voice")
	assert_eq(shown[1].text_label.text, "Third")
	assert_true(shown[1].speaker_label.visible)
	assert_eq(shown[1].speaker_label.text, "Hero")
	assert_true(shown[1].voice_button.visible)
	assert_true(shown[1].text_label.bbcode_enabled)
	await click(view().line_history_close_button)
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_the_open_window_ignores_input_and_auto_advance_and_closing_restarts_the_wait() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await tap(view().auto_advance_button)
	await open_history()
	await advance(AUTO_MS * 2)
	assert_true(line_running(), "auto advance does not end the line")
	await press_advance()
	await click(view().advance_button)
	await press_skip()
	await click(view().skip_button)
	assert_true(line_running(), "advance and skip input are ignored")
	await click(view().line_history_close_button)
	assert_false(view().line_history_window.visible)
	await advance(AUTO_MS - 1)
	assert_true(line_running())
	await advance(1)
	await finish(call)
	assert_eq(call.status(), CutsceneCore.CutsceneStatus.COMPLETED)
	assert_eq(errors(), 0)


func test_the_open_window_ignores_choice_input() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_choice_box]")
	await open_history()
	await click(shown_choices()[0])
	assert_true(choice_running())
	await click(view().line_history_button)
	assert_false(CutsceneCore._history_open, "the history button closes the open window")
	await click(shown_choices()[0])
	await finish(call)
	assert_eq(errors(), 0)


func test_back_input_with_the_window_open_closes_it_without_the_pause_popup() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_plain]")
	await open_history()
	await press_back()
	assert_false(CutsceneCore._history_open)
	assert_false(view().line_history_window.visible)
	assert_false(CutsceneCore._paused)
	assert_null(system_button(ReservedString.cutscene_pause_resume()))
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)


func test_a_voice_button_replays_its_voice_and_closing_the_window_stops_it() -> void:
	assert_true(await start())
	var call: PLAY = await play("[cut_history]")
	await press_advance()
	await press_advance()
	await UnitTestCore.wait_frames(1)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_H3]))
	await open_history()
	var shown: Array[CutsceneLineHistoryItem] = items()
	assert_eq(shown.size(), 3)
	assert_false(shown[1].voice_button.visible, "the line without voice has no voice button")
	await click(shown[0].voice_button)
	await UnitTestCore.wait_frames(1)
	assert_eq(playing(SoundCore.SoundBus.VOICE), PackedStringArray([VOICE_H1]), "the line voice stopped")
	await click(view().line_history_close_button)
	await UnitTestCore.wait_frames(1)
	assert_eq(playing(SoundCore.SoundBus.VOICE).size(), 0)
	await press_advance()
	await finish(call)
	assert_eq(errors(), 0)
