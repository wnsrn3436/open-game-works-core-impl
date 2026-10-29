class_name BenchBot
extends RefCounted
## The bot of the benchmark cycle and the `open_<screen>` commands. One cycle: lobby, tick panel (one recorded tick),
## lobby, arena, notice popup, lobby. The bot reads the screen state each call and taps the anchor of the next step.
## A tap the UI dropped is tapped again on the next call; the screens ignore a tap that repeats one in progress.
## The bot leaves a scene only after it was in it for `_SCENE_HOLD_MS`, so that the fps sampler of the performance
## judgement, which drops the ticks of a scene load and the tick after it, gets samples of each scene.

const _ANCHOR_INFO_OPEN: String = "bench_info_open"
const _ANCHOR_ARENA_OPEN: String = "bench_arena_open"
const _ANCHOR_TICK_SEND: String = "bench_tick_send"
const _ANCHOR_INFO_CLOSE: String = "bench_info_close"
const _ANCHOR_NOTICE_OPEN: String = "bench_notice_open"
const _ANCHOR_NOTICE_CLOSE: String = "bench_notice_close"
const _ANCHOR_LOBBY_BACK: String = "bench_lobby_back"
## The least time in a scene before the step that leaves it, in ms.
const _SCENE_HOLD_MS: int = 6000

## The tick count the tick panel step waits for; 0 before its first record tap of the cycle.
var _tick_target: int = 0
## The tick panel step of this cycle ended.
var _info_done: bool = false
## The notice popup was open in this cycle.
var _notice_seen: bool = false
## The scene of the last call and when the bot first saw it, in `Time.get_ticks_msec()`.
var _scene_seen: String = ""
var _scene_seen_ms: int = 0


## `bench.bot_next_input`: the next input command, or `null` while a transition runs or a request is awaited.
func next_input(_args: PackedStringArray) -> RunCommandResult:
	var anchor: String = _next_anchor()
	if anchor.is_empty():
		return _result(true, "null")
	return _result(true, JSON.stringify({"command": "tap_anchor", "args": [anchor]}))


## Clears the cycle state and records the `Goal` mark of the cycle.
func on_cycle_completed(_event: BenchCycleCompletedEvent) -> void:
	_tick_target = 0
	_info_done = false
	_notice_seen = false
	QACore.mark(QACore.MarkKind.GOAL)


func tick_count_in_range() -> bool:
	var count: int = BenchTicks.current()
	return count >= 0 and count <= GameSetting.tick_count_max()


func content_state() -> String:
	return JSON.stringify({"tick_count": BenchTicks.current()})


func open_title(_args: PackedStringArray) -> RunCommandResult:
	return _result(await _go_to_scene(ResourceKey.SCENE__BENCH__TITLE), "")


func open_lobby(_args: PackedStringArray) -> RunCommandResult:
	if not await _go_to_scene(ResourceKey.SCENE__BENCH__LOBBY):
		return _result(false, "")
	UICore.close_all_popups()
	var ok: bool = await UICore.close_panels_to(ResourceKey.PREFAB__BENCH__LOBBY_PANEL)
	return _result(ok, "")


func open_info(args: PackedStringArray) -> RunCommandResult:
	var lobby: RunCommandResult = await open_lobby(args)
	if not lobby.ok:
		return lobby
	return _result(await UICore.open_panel(ResourceKey.PREFAB__BENCH__INFO_PANEL, null, false), "")


func open_option(args: PackedStringArray) -> RunCommandResult:
	var lobby: RunCommandResult = await open_lobby(args)
	if not lobby.ok:
		return lobby
	return _result(await UICore.open_panel(ResourceKey.PREFAB__BENCH__OPTION_PANEL, null, false), "")


func open_arena(_args: PackedStringArray) -> RunCommandResult:
	if not await _go_to_scene(ResourceKey.SCENE__BENCH__ARENA):
		return _result(false, "")
	UICore.close_all_popups()
	return _result(true, "")


func open_notice(args: PackedStringArray) -> RunCommandResult:
	var arena: RunCommandResult = await open_arena(args)
	if not arena.ok:
		return arena
	var opened: UICore.PopupOpenResult = await UICore.open_popup(ResourceKey.PREFAB__BENCH__NOTICE_POPUP, null, Callable())
	return _result(opened == UICore.PopupOpenResult.OPENED, "")


func _next_anchor() -> String:
	if SceneCore.is_transitioning() or UICore.is_panel_transitioning() or UICore.is_system_popup_visible():
		return ""
	var scene: String = SceneCore.current_scene_key()
	if scene != _scene_seen:
		_scene_seen = scene
		_scene_seen_ms = Time.get_ticks_msec()
	if scene == ResourceKey.SCENE__BENCH__LOBBY:
		return _lobby_anchor()
	if scene == ResourceKey.SCENE__BENCH__ARENA:
		return _arena_anchor()
	return ""


func _lobby_anchor() -> String:
	var panel: String = UICore.get_current_panel_key()
	if panel == ResourceKey.PREFAB__BENCH__INFO_PANEL:
		var count: int = BenchTicks.current()
		if _tick_target == 0:
			_tick_target = count + 1
		if count < _tick_target:
			return _ANCHOR_TICK_SEND
		_info_done = true
		return _ANCHOR_INFO_CLOSE
	if panel == ResourceKey.PREFAB__BENCH__LOBBY_PANEL:
		if not _info_done:
			return _ANCHOR_INFO_OPEN
		return _ANCHOR_ARENA_OPEN if _held() else ""
	return ""


func _arena_anchor() -> String:
	if UICore.get_open_popups().has(ResourceKey.PREFAB__BENCH__NOTICE_POPUP):
		_notice_seen = true
		return _ANCHOR_NOTICE_CLOSE
	if UICore.get_open_popup_count() > 0:
		return ""
	if not _notice_seen:
		return _ANCHOR_NOTICE_OPEN
	return _ANCHOR_LOBBY_BACK if _held() else ""


func _held() -> bool:
	return Time.get_ticks_msec() - _scene_seen_ms >= _SCENE_HOLD_MS


func _go_to_scene(scene_key: String) -> bool:
	if SceneCore.current_scene_key() == scene_key:
		return true
	return await SceneCore.change_scene(scene_key, null)


func _result(ok: bool, result: String) -> RunCommandResult:
	var out: RunCommandResult = RunCommandResult.new()
	out.ok = ok
	out.result = result
	return out
