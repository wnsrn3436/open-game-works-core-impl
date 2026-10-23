class_name BenchArenaScene
extends SceneBase
## Arena scene: code-drawn moving shapes under a HUD with the notice button and the lobby button.

@export var title_label: Label
@export var notice_button: Button
@export var lobby_button: Button
@export var notice_click: UIButton
@export var lobby_click: UIButton


func _ready() -> void:
	LocalizationCore.bind_text(title_label, ReservedString.bench_arena_title())
	LocalizationCore.bind_text(notice_button, ReservedString.bench_notice_open())
	LocalizationCore.bind_text(lobby_button, ReservedString.bench_lobby_back())
	notice_click.set_on_click(_on_notice)
	lobby_click.set_on_click(_on_lobby)


func _on_notice() -> void:
	UICore.open_popup(ResourceKey.PREFAB__BENCH__NOTICE_POPUP, null, Callable())


func _on_lobby() -> void:
	var param: BenchLobbyParam = BenchLobbyParam.new()
	param.from_arena = true
	SceneCore.change_scene(ResourceKey.SCENE__BENCH__LOBBY, param)
