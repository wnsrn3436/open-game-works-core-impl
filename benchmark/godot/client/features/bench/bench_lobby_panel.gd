class_name BenchLobbyPanel
extends UIPanel
## Root panel of the lobby: the buttons to the tick panel, the arena and the option panel.

@export var title_label: Label
@export var info_button: Button
@export var arena_button: Button
@export var option_button: Button
@export var info_click: UIButton
@export var arena_click: UIButton
@export var option_click: UIButton


func prepare(_reason: UICore.PanelOpenReason, _cache: UIPanelCache) -> bool:
	LocalizationCore.bind_text(title_label, ReservedString.bench_lobby_title())
	LocalizationCore.bind_text(info_button, ReservedString.bench_info_open())
	LocalizationCore.bind_text(arena_button, ReservedString.bench_arena_open())
	LocalizationCore.bind_text(option_button, ReservedString.bench_option_open())
	info_click.set_on_click(_on_info)
	arena_click.set_on_click(_on_arena)
	option_click.set_on_click(_on_option)
	return true


func _on_info() -> void:
	UICore.open_panel(ResourceKey.PREFAB__BENCH__INFO_PANEL, null, false)


func _on_arena() -> void:
	SceneCore.change_scene(ResourceKey.SCENE__BENCH__ARENA, null)


func _on_option() -> void:
	UICore.open_panel(ResourceKey.PREFAB__BENCH__OPTION_PANEL, null, false)
