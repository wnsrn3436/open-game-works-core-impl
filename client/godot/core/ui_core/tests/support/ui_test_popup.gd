extends UIPopup
## Root script of the test popup prefabs: records the panel interface calls in the test log and follows its config.

const _LOG := preload("res://core/ui_core/tests/support/ui_test_log.gd")
const _GATE := preload("res://core/ui_core/tests/support/ui_test_gate.gd")


func accepts_param(param: UIParam) -> bool:
	_LOG.add(popup_key + ":accepts")
	_LOG.params[popup_key] = param
	return not _LOG.refused.has(popup_key)


func prepare() -> bool:
	_LOG.add(popup_key + ":prepare")
	if _LOG.gates.has(popup_key):
		var gate: _GATE = _LOG.gates[popup_key]
		if not gate.is_open:
			await gate.opened
	return not _LOG.fail_new.has(popup_key)


func on_opened() -> void:
	_LOG.add(popup_key + ":on_opened")


func on_closed() -> void:
	_LOG.add(popup_key + ":on_closed")


func on_back() -> void:
	_LOG.add(popup_key + ":on_back")
