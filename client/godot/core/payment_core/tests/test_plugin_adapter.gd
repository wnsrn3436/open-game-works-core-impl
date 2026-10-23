extends "res://core/payment_core/tests/support/payment_test_case.gd"
## The real store adapter over a plugin singleton that never answers: every store call but `buy` ends at
## `PaymentCore.storeCallTimeoutMs`, `buy` waits until `release`, and the adapter stops reading the plugin and tells it
## with `cancel` when it stops waiting.

const SilentPlugin := preload("res://core/payment_core/tests/support/silent_store_plugin.gd")
const _SINGLETON: String = "OgwIapApple"

var _plugin: SilentPlugin = null


func after_each() -> void:
	super()
	if Engine.has_singleton(_SINGLETON):
		Engine.unregister_singleton(_SINGLETON)
	if _plugin != null:
		_plugin.free()
		_plugin = null


## Registers the silent plugin, then starts PaymentCore with the real store `APPLE` adapter over it and logs in.
func _start_with_plugin(answering: PackedStringArray) -> bool:
	_plugin = SilentPlugin.new()
	_plugin.answering = answering
	Engine.register_singleton(_SINGLETON, _plugin)
	if not start_modules() or not await prepare_modules() or not start_auth(false):
		return false
	PaymentCore.set_store_adapter(PluginStoreAdapter.new(CoreContract.IapStore.IAP_STORE_APPLE))
	if not PaymentCore.init():
		return false
	return await log_in(USER_ID)


## `take_result` calls of the first operation `operation` stay the same over a few frames.
func _stopped_reading(operation: String) -> bool:
	var id: int = _plugin.id_of(operation)
	var before: int = _plugin.poll_count(id)
	await settle()
	return id > 0 and before > 0 and _plugin.poll_count(id) == before


class Flag extends RefCounted:
	signal finished
	var done: bool = false
	var ok: bool = true


func _prepare_into(flag: Flag) -> void:
	flag.ok = await PaymentCore.prepare()
	flag.done = true
	flag.finished.emit()


func _open_management_into(flag: Flag) -> void:
	flag.ok = await PaymentCore.open_subscription_management()
	flag.done = true
	flag.finished.emit()


func test_a_connect_that_never_ends_fails_at_the_store_call_time_limit_and_is_cancelled() -> void:
	assert_true(await _start_with_plugin(PackedStringArray()))
	var flag: Flag = Flag.new()
	_prepare_into(flag)
	await advance(STORE_CALL_TIMEOUT_MS - 1)
	assert_false(flag.done, "not before the time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	await advance(1)
	assert_true(flag.done, "prepare ends at the time limit")
	assert_false(flag.ok)
	assert_eq(_plugin.cancelled, PackedInt64Array([_plugin.id_of("connect")]), "the plugin is told once")
	assert_true(await _stopped_reading("connect"), "the adapter stops reading the plugin")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "connect failed")


func test_a_list_unfinished_that_never_ends_fails_at_the_store_call_time_limit() -> void:
	assert_true(await _start_with_plugin(PackedStringArray(["connect", "query_prices"])))
	var running: Recovery = start_recover()
	await settle()
	assert_true(PaymentCore._is_ready, "connect and query_prices answered")
	assert_gt(_plugin.id_of("list_unfinished"), 0)
	await advance(STORE_CALL_TIMEOUT_MS - 1)
	assert_false(running.done)
	await advance(1)
	assert_true(running.done)
	assert_false(running.ok)
	assert_eq(_plugin.cancelled, PackedInt64Array([_plugin.id_of("list_unfinished")]))
	assert_true(await _stopped_reading("list_unfinished"))
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "list_unfinished failed")


func test_open_subscription_management_that_never_ends_is_false_at_the_store_call_time_limit() -> void:
	assert_true(await _start_with_plugin(PackedStringArray()))
	var flag: Flag = Flag.new()
	_open_management_into(flag)
	await advance(STORE_CALL_TIMEOUT_MS - 1)
	assert_false(flag.done, "not before the time limit")
	await advance(1)
	assert_true(flag.done, "open_subscription_management has the store call time limit")
	assert_false(flag.ok)
	assert_eq(_plugin.cancelled, PackedInt64Array([_plugin.id_of("open_subscription_management")]))
	assert_true(await _stopped_reading("open_subscription_management"))


func test_a_buy_that_never_ends_has_no_time_limit_and_release_ends_it() -> void:
	assert_true(await _start_with_plugin(PackedStringArray(["connect", "query_prices"])))
	respond_check()
	var running: Purchase = start_purchase(id_of("[iap_gems]"))
	await settle()
	var buy: int = _plugin.id_of("buy")
	assert_gt(buy, 0, "buy started")
	await advance(STORE_CALL_TIMEOUT_MS * 3)
	assert_false(running.done, "buy waits for the user with no time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	PaymentCore.release()
	await settle()
	assert_true(running.done, "release ends the purchase")
	assert_eq(running.result, PaymentCore.PurchaseResult.REJECTED)
	assert_eq(_plugin.cancelled, PackedInt64Array([buy]), "the plugin is told once")
	assert_true(await _stopped_reading("buy"), "the adapter stops reading the plugin")
	assert_eq(request_count(VERIFY), 0)


func test_release_stops_reading_the_plugin_notifications() -> void:
	assert_true(await _start_with_plugin(PackedStringArray()))
	var reads: int = _plugin.event_reads
	await settle()
	assert_gt(_plugin.event_reads, reads, "the adapter reads the notifications every frame")
	PaymentCore.release()
	await settle(1)
	reads = _plugin.event_reads
	await settle()
	assert_eq(_plugin.event_reads, reads, "no reads after release")
