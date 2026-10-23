extends Node
## Core node of `SoundCore`: the players, the BGM scope owners, the frame processing, app focus, the background
## events and the tree signal for content positional players.

## Physics processing after every other node, so the sweep sees the playbacks that players started in this tick.
const _PHYSICS_PRIORITY: int = 1 << 30

var _tree: SceneTree = null


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_physics_priority = _PHYSICS_PRIORITY


func _process(_delta: float) -> void:
	SoundCore._on_frame()


func _physics_process(_delta: float) -> void:
	SoundCore._on_physics_frame()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		SoundCore._on_focus_changed(false)
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN:
		SoundCore._on_focus_changed(true)


func _exit_tree() -> void:
	SoundCore._on_node_exit(self)


## Connects `SceneTree.node_added`. False when the connection fails.
func connect_tree() -> bool:
	_tree = get_tree()
	if _tree == null:
		return false
	return _tree.node_added.connect(_on_node_added) == OK


func disconnect_tree() -> void:
	if _tree != null and _tree.node_added.is_connected(_on_node_added):
		_tree.node_added.disconnect(_on_node_added)
	_tree = null


## Connects the `finished` signal of the sfx player of `slot`.
func watch_sfx_player(player: AudioStreamPlayer, slot: int) -> void:
	if player.finished.connect(_on_sfx_finished.bind(slot)) != OK:
		LogCore.log_error(SoundCore._TAG, "could not connect the finished signal of an sfx player")


func _on_sfx_finished(slot: int) -> void:
	SoundCore._on_sfx_finished(slot)


func _on_node_added(node: Node) -> void:
	SoundCore._on_node_added(node)


func _on_deferred_positional_pause() -> void:
	SoundCore._on_deferred_positional_pause()


func _on_deferred_settle() -> void:
	SoundCore._on_deferred_settle()


func _on_deferred_load() -> void:
	SoundCore._on_deferred_load()


func _on_app_background_entered(_event: AppBackgroundEnteredEvent) -> void:
	SoundCore._on_background_changed(true)


func _on_app_foreground_returned(_event: AppForegroundReturnedEvent) -> void:
	SoundCore._on_background_changed(false)
