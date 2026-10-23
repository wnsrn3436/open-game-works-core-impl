extends UIPanel
## Root script of the test panel prefabs: records the panel interface calls in the test log and follows its config.

const _LOG := preload("res://core/ui_core/tests/support/ui_test_log.gd")
const _GATE := preload("res://core/ui_core/tests/support/ui_test_gate.gd")


func accepts_param(param: UIParam) -> bool:
	_LOG.add(panel_key + ":accepts")
	return not _LOG.refused.has(panel_key)


func prepare(reason: UICore.PanelOpenReason, given_cache: UIPanelCache) -> bool:
	_LOG.add("%s:prepare:%s:%s" % [panel_key, _LOG.open_reason(reason), _LOG.cache_name(given_cache)])
	_LOG.params[panel_key] = panel_param
	if _LOG.gates.has(panel_key):
		var gate: _GATE = _LOG.gates[panel_key]
		if not gate.is_open:
			await gate.opened
	if _LOG.caches.has(panel_key):
		cache = _LOG.caches[panel_key]
	if reason == UICore.PanelOpenReason.NEW:
		return not _LOG.fail_new.has(panel_key)
	return not _LOG.fail_returned.has(panel_key)


func on_opened(reason: UICore.PanelOpenReason) -> void:
	_LOG.add("%s:on_opened:%s" % [panel_key, _LOG.open_reason(reason)])


func on_closed(reason: UICore.PanelCloseReason) -> void:
	_LOG.add("%s:on_closed:%s" % [panel_key, _LOG.close_reason(reason)])


func on_back() -> void:
	_LOG.add(panel_key + ":on_back")
