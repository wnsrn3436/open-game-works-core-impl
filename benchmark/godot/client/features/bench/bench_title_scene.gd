class_name BenchTitleScene
extends SceneBase
## Title scene of the boot: the game name over a code-drawn background.

@export var title_label: Label


func _ready() -> void:
	LocalizationCore.bind_text(title_label, ReservedString.bench_title())
