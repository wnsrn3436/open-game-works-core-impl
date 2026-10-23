class_name BenchLoadingScreen
extends LoadingScreenBase
## Loading screen of every scene transition: a text and a code-drawn progress bar.

@export var label: Label
@export var bar: ColorRect


func _ready() -> void:
	LocalizationCore.bind_text(label, ReservedString.bench_loading())
	on_progress(0)


func on_progress(progress_permille: int) -> void:
	bar.anchor_right = float(clampi(progress_permille, 0, BenchConstants.PERMILLE)) / float(BenchConstants.PERMILLE)
