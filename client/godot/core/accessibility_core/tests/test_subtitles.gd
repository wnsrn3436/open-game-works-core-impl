extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Voice subtitles: showing with `play_voice`, hiding when the play ends, subtitles off, replacing and the box layout.

## Length of `VOICE_SHORT`: 400 samples at 8000 Hz.
const VOICE_SHORT_MS: int = 50
const LAYOUT_EPSILON: float = 0.01

## Buses of the `SoundPlayedEvent`s since `test_play_voice_plays_on_the_voice_bus` subscribed.
var played_buses: PackedInt32Array = PackedInt32Array()


func test_subtitle_shows_in_the_frame_of_play_voice_and_hides_when_the_play_ends() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_SHORT)
	var handle: int = AccessibilityCore.play_voice(VOICE_SHORT, scope, subtitle_key())
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	assert_true(subtitle_visible(), "shown in the frame of the request")
	assert_eq(subtitle_text(), LocalizationCore.get_text(subtitle_key()))
	# The play ends at its length of real elapsed time, if the engine has not ended it before.
	await advance(VOICE_SHORT_MS)
	assert_false(SoundCore.is_playing(handle), "the voice ended")
	await UnitTestCore.wait_frames(1)
	assert_false(subtitle_visible(), "hidden by the frame check after the end")
	assert_eq(AccessibilityCore._subtitle_handle, SoundCore.INVALID_HANDLE)


func test_subtitle_hides_in_the_frame_after_its_voice_is_stopped() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	var handle: int = AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	await UnitTestCore.wait_frames(2)
	assert_true(subtitle_visible(), "a looping voice keeps its subtitle")
	SoundCore.stop(handle)
	await UnitTestCore.wait_frames(1)
	assert_false(subtitle_visible())


func test_with_subtitles_off_the_voice_plays_without_a_subtitle() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	AccessibilityCore.set_subtitles(false)
	var handle: int = AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	assert_true(SoundCore.is_playing(handle), "the voice plays")
	assert_false(subtitle_visible())
	await UnitTestCore.wait_frames(1)
	assert_false(subtitle_visible())


func test_turning_subtitles_off_hides_the_subtitle_on_screen() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	var handle: int = AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	assert_true(subtitle_visible())
	AccessibilityCore.set_subtitles(false)
	assert_false(subtitle_visible(), "hidden in the call")
	assert_true(SoundCore.is_playing(handle), "the voice goes on")
	AccessibilityCore.set_subtitles(true)
	await UnitTestCore.wait_frames(1)
	assert_false(subtitle_visible(), "turning subtitles on shows only the subtitles of later play_voice calls")


func test_second_play_voice_replaces_the_subtitle() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_SHORT)
	await load_voice(VOICE_LOOP)
	var first: int = AccessibilityCore.play_voice(VOICE_SHORT, scope, subtitle_key())
	var second: int = AccessibilityCore.play_voice(VOICE_LOOP, scope, other_subtitle_key())
	assert_true(subtitle_visible())
	assert_eq(subtitle_text(), LocalizationCore.get_text(other_subtitle_key()))
	assert_eq(AccessibilityCore._subtitle_handle, second)
	assert_eq(AccessibilityCore._subtitle_box.get_parent().get_children().count(AccessibilityCore._subtitle_box), 1)
	SoundCore.stop(first)
	await UnitTestCore.wait_frames(2)
	assert_true(subtitle_visible(), "the end of the first voice leaves the second subtitle")
	assert_eq(subtitle_text(), LocalizationCore.get_text(other_subtitle_key()))


func test_subtitle_with_format_args_is_the_format_result() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", 3)
	AccessibilityCore.play_voice(VOICE_LOOP, scope, count_subtitle_key(), args)
	var expected: String = LocalizationCore.format(count_subtitle_key(), args)
	assert_eq(expected, "3 items for you")
	assert_eq(subtitle_text(), expected)


func test_empty_subtitle_key_plays_the_voice_without_a_subtitle_and_logs_an_error() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	var handle: int = AccessibilityCore.play_voice(VOICE_LOOP, scope, "")
	assert_true(SoundCore.is_playing(handle), "the voice plays")
	assert_false(subtitle_visible())
	assert_eq(errors(), 1)


func test_play_voice_that_does_not_start_shows_no_subtitle() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	var gone: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "accessibility_test_gone")
	ResourceCore.release_scope(gone)
	var handle: int = AccessibilityCore.play_voice(VOICE_LOOP, gone, subtitle_key())
	assert_eq(handle, SoundCore.INVALID_HANDLE)
	assert_false(subtitle_visible())
	assert_eq(UnitTestCore.check_logs(ERROR, "SoundCore"), 1, "SoundCore logs the released scope")


func test_play_voice_plays_on_the_voice_bus() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	played_buses = PackedInt32Array()
	assert_true(EventCore.subscribe(SoundPlayedEvent, _on_sound_played))
	AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	var expected: PackedInt32Array = [SoundCore.SoundBus.VOICE]
	assert_eq(played_buses, expected)


func test_subtitle_box_is_centered_on_the_safe_area_above_its_bottom_edge() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	ResolutionCoreDev.set_test_screen(Vector2i(1280, 720), Vector2i(1280, 720), ResolutionCore.FillMode.LETTERBOX, false)
	SafeAreaCoreDev.set_virtual_notch(120, 30, 40, 90)
	AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	_assert_layout("in the frame of play_voice")
	await UnitTestCore.wait_frames(1)
	_assert_layout("a frame later")
	SafeAreaCoreDev.set_virtual_notch(0, 0, 200, 10)
	await UnitTestCore.wait_frames(1)
	_assert_layout("after the safe area changed")
	assert_eq(AccessibilityCore._subtitle_box.get_parent(), UICore.get_layer(UICore.UILayer.MESSAGE))
	assert_eq(AccessibilityCore._subtitle_box.color, Color(0.0, 0.0, 0.0, 0.5))
	assert_eq(AccessibilityCore._subtitle_label.get_theme_color(&"font_color"), Color.WHITE)
	assert_ne(AccessibilityCore._subtitle_label.autowrap_mode, TextServer.AUTOWRAP_OFF)


func _assert_layout(text: String) -> void:
	var area: Rect2 = SafeAreaCore.get_safe_area()
	var box: Rect2 = AccessibilityCore._subtitle_box.get_rect()
	var label: Rect2 = AccessibilityCore._subtitle_label.get_rect()
	assert_almost_eq(box.get_center().x, area.get_center().x, LAYOUT_EPSILON, "center " + text)
	assert_almost_eq(box.end.y, area.end.y - SUBTITLE_BOTTOM_MARGIN, LAYOUT_EPSILON, "bottom " + text)
	assert_almost_eq(box.size.x, area.size.x * SUBTITLE_WIDTH_PERMILLE / 1000.0, LAYOUT_EPSILON, "width " + text)
	assert_almost_eq(label.position.x, SUBTITLE_PADDING, LAYOUT_EPSILON, "padding " + text)
	assert_almost_eq(label.position.y, SUBTITLE_PADDING, LAYOUT_EPSILON, "padding " + text)
	assert_almost_eq(label.end.y + SUBTITLE_PADDING, box.size.y, LAYOUT_EPSILON, "padding below " + text)


func _on_sound_played(event: SoundPlayedEvent) -> void:
	played_buses.append(event.bus)
