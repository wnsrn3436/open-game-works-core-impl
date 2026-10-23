extends "res://core/payment_core/tests/support/payment_test_case.gd"
## `prepare`, the SKU table, the price fetch, `get_price` and the connection loss.


## A `prepare` running in the background.
const Hanging := preload("res://core/payment_core/tests/support/hanging_store_adapter.gd")
const Priceless := preload("res://core/payment_core/tests/support/priceless_store_adapter.gd")


class Prepare extends RefCounted:
	signal finished
	var done: bool = false
	var ok: bool = false


func _start_prepare() -> Prepare:
	var running: Prepare = Prepare.new()
	_prepare_into(running)
	return running


func _prepare_into(running: Prepare) -> void:
	running.ok = await PaymentCore.prepare()
	running.done = true
	running.finished.emit()


func _wait_prepare(running: Prepare) -> bool:
	if not running.done:
		await running.finished
	return running.ok


func test_two_prepares_at_once_connect_once_and_share_the_result() -> void:
	assert_true(await start())
	var first: Prepare = _start_prepare()
	var second: Prepare = _start_prepare()
	assert_true(await _wait_prepare(first))
	assert_true(await _wait_prepare(second))
	assert_eq(fake.count_calls("connect"), 1)
	assert_true(await PaymentCore.prepare(), "ready")
	assert_eq(fake.count_calls("connect"), 1, "no connect in the ready state")


func test_two_failing_prepares_at_once_connect_once_and_both_fail() -> void:
	assert_true(await start())
	PaymentCoreDev.fake_set_fail("connect", true)
	var first: Prepare = _start_prepare()
	var second: Prepare = _start_prepare()
	assert_false(await _wait_prepare(first))
	assert_false(await _wait_prepare(second))
	assert_eq(fake.count_calls("connect"), 1)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "one connect failure")


func test_prepare_fetches_the_prices_of_the_sku_table() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_GOOGLE))
	assert_true(await PaymentCore.prepare())
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "gems_google", "the fake price is the SKU")
	assert_eq(PaymentCore.get_price(id_of("[iap_vip]")), "vip_google")
	assert_eq(PaymentCore.get_price(id_of("[iap_apple_only]")), "", "not in the SKU table of GOOGLE")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)


func test_empty_sku_table_prepares_without_query_prices() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_UNSPECIFIED))
	assert_true(await PaymentCore.prepare())
	assert_eq(fake.count_calls("connect"), 1)
	assert_eq(fake.count_calls("query_prices"), 0)


func test_query_prices_failure_fails_prepare() -> void:
	assert_true(await start())
	PaymentCoreDev.fake_set_fail("query_prices", true)
	assert_false(await PaymentCore.prepare())
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "", "not ready")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)


func test_missing_price_is_an_empty_get_price_with_one_error_per_product() -> void:
	var priceless: Priceless = Priceless.new(CoreContract.IapStore.IAP_STORE_APPLE)
	priceless.priceless = PackedStringArray(["gems_apple", "noads_apple"])
	assert_true(await start_with(priceless))
	assert_true(await PaymentCore.prepare(), "a missing price does not fail prepare")
	fake.notify_disconnected()
	assert_true(await PaymentCore.prepare())
	assert_eq(fake.count_calls("query_prices"), 2, "two price fetches")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 2, "one error for each product over both price fetches")
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "")
	assert_eq(PaymentCore.get_price(id_of("[iap_no_ads]")), "")
	assert_eq(PaymentCore.get_price(id_of("[iap_vip]")), "vip_apple")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0, "get_price of a product without a price logs nothing")


func test_get_price_before_prepare_is_empty_with_an_error() -> void:
	assert_true(await start())
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "")
	assert_eq(PaymentCore.get_price(999999), "")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 2)
	assert_eq(fake.count_calls("query_prices"), 0, "get_price does not call the store")


func test_connection_loss_empties_get_price_and_the_next_prepare_connects_once() -> void:
	assert_true(await start())
	assert_true(await PaymentCore.prepare())
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "gems_apple")
	fake.notify_disconnected()
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_true(await PaymentCore.prepare())
	assert_eq(fake.count_calls("connect"), 2)
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "gems_apple")


func test_connection_loss_during_the_price_fetch_fails_that_prepare() -> void:
	assert_true(await start())
	var running: Prepare = _start_prepare()
	for i: int in 12:
		if fake.count_calls("query_prices") > 0:
			break
		await UnitTestCore.wait_frames(1)
	assert_eq(fake.count_calls("query_prices"), 1, "the price fetch started")
	assert_false(running.done, "the price fetch is running")
	fake.notify_disconnected()
	assert_false(await _wait_prepare(running), "the price fetch succeeds but the connection was lost")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "", "not ready")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_true(await PaymentCore.prepare(), "the next prepare connects again")
	assert_eq(fake.count_calls("connect"), 2)
	assert_eq(PaymentCore.get_price(id_of("[iap_gems]")), "gems_apple")

func test_store_call_past_its_time_limit_fails() -> void:
	assert_true(start_modules())
	assert_true(await prepare_modules())
	assert_true(start_auth(false))
	var hanging: Hanging = Hanging.new(CoreContract.IapStore.IAP_STORE_APPLE)
	PaymentCore.set_store_adapter(hanging)
	assert_true(PaymentCore.init())
	var running: Prepare = _start_prepare()
	await settle()
	await advance(STORE_CALL_TIMEOUT_MS - 1)
	assert_false(running.done, "within the time limit")
	await advance(1)
	assert_true(running.done, "the time limit ended connect")
	assert_false(await _wait_prepare(running))
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	hanging.release_hang()
	await settle()


func test_prepare_and_restore_without_a_store_adapter_fail_with_an_error() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, false))
	assert_false(await PaymentCore.prepare())
	assert_false((await PaymentCore.restore_purchases()).ok)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 2)
	assert_false(await PaymentCore.open_subscription_management())
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)


func test_open_subscription_management_opens_the_store_screen() -> void:
	assert_true(await start())
	assert_true(await PaymentCore.open_subscription_management())
	assert_eq(fake.count_calls("open_subscription_management"), 1)
	PaymentCoreDev.fake_set_fail("open_subscription_management", true)
	assert_false(await PaymentCore.open_subscription_management())
