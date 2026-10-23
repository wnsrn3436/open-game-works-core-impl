extends SceneBase
## Root script of the TutorialCore test scenes. When `register_hook` is set, `_ready` registers its own method as the
## `can_start_tutorial` owner hook; the hook counts its calls and returns `hook_result`. While `hold_prepare` is set,
## `on_prepare` waits for `open_prepare`.

## A point where `on_prepare` waits until the test opens it.
class Gate extends RefCounted:
	signal opened

static var register_hook: bool = false
static var hook_result: bool = false
static var hook_calls: int = 0
static var hold_prepare: bool = false
static var gate: Gate = Gate.new()


static func reset() -> void:
	register_hook = false
	hook_result = false
	hook_calls = 0
	hold_prepare = false
	gate = Gate.new()


static func open_prepare() -> void:
	hold_prepare = false
	gate.opened.emit()


func _ready() -> void:
	if register_hook:
		TutorialCore.register_can_start_tutorial(_can_start_tutorial)


func on_prepare() -> bool:
	if hold_prepare:
		await gate.opened
	return true


func _can_start_tutorial(_tutorial_id: int) -> bool:
	hook_calls += 1
	return hook_result
