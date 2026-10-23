extends SceneBase
## Scene of the BootstrapCore core tests whose `on_prepare` waits until `gate` opens, so a transition to it keeps
## running.

const _GATE := preload("res://core/bootstrap_core/tests/resources/boot_test_gate.gd")

## When set, `on_prepare` waits for it. A test sets it and clears it.
static var gate: _GATE = null


func on_prepare() -> bool:
	var waiting: _GATE = gate
	if waiting != null:
		await waiting.opened
	return true
