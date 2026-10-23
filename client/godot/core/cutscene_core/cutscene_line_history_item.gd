class_name CutsceneLineHistoryItem
extends PoolObject
## Root script of the item prefab of the line history list. Its root node is a `Control`.

@export var speaker_label: Label = null
@export var text_label: RichTextLabel = null
## A `Button` with a `UIButton` child. `null`: the item has no voice button.
@export var voice_button: Button = null

## Set by `CutsceneCore` when it binds the item: the playback number and the line voice of the bound entry.
var _history_serial: int = 0
var _history_voice: String = ""
## Click callback of the voice button. Made once here, so binding the item in frame code makes no `Callable`.
var _voice_click: Callable = Callable()


func _init() -> void:
	_voice_click = _on_voice_click


func on_borrow() -> void:
	pass


func on_return() -> void:
	pass


func _on_voice_click() -> void:
	CutsceneCore._on_history_voice_click(_history_serial, _history_voice)
