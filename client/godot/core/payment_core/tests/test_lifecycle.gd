extends "res://core/payment_core/tests/support/payment_test_case.gd"
## PaymentCore lifecycle: init check, what `release` clears, calls before `init`, `set_store_adapter` order, and the
## operations `release` stops.


func test_init_check_follows_init_and_release() -> void:
	assert_false(PaymentCore.is_initialized())
	assert_true(await start())
	assert_true(PaymentCore.is_initialized())
	PaymentCore.release()
	assert_false(PaymentCore.is_initialized())
	assert_true(PaymentCore.init())
	assert_true(PaymentCore.is_initialized())


func test_second_init_fails_with_an_error() -> void:
	assert_true(await start())
	assert_false(PaymentCore.init())
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)


func test_operations_before_init_fail_with_an_error() -> void:
	assert_true(start_modules())
	assert_false(PaymentCore.is_supported())
	assert_false(await PaymentCore.prepare())
	assert_eq(PaymentCore.get_price(1), "")
	assert_eq(await PaymentCore.purchase(1), PaymentCore.PurchaseResult.REJECTED)
	assert_false((await PaymentCore.recover_purchases()).ok)
	assert_false((await PaymentCore.restore_purchases()).ok)
	assert_false(PaymentCore.is_subscribed(1))
	assert_eq(PaymentCore.get_subscription_ends_at(1), 0)
	assert_eq(PaymentCore.get_pass_days_left(1), 0)
	assert_false(PaymentCore.is_owned(1))
	assert_false(PaymentCore.can_claim_daily(1))
	assert_false(await PaymentCore.claim_daily(1))
	assert_false(await PaymentCore.open_subscription_management())
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 13)


func test_set_store_adapter_after_init_is_ignored_with_an_error() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, false))
	PaymentCore.set_store_adapter(FakeStoreAdapter.new(CoreContract.IapStore.IAP_STORE_APPLE))
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_false(PaymentCore.is_supported())


func test_release_clears_the_state_and_removes_the_core_node() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_error(VERIFY, CoreContract.CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.DELIVERY_PENDING)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "IAP_VERIFY_UNAVAILABLE: the failure callback handles it")
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER, gems)
	assert_true((await PaymentCore.recover_purchases()).ok)
	var node: Node = PaymentCore._node
	assert_not_null(node)
	PaymentCore.release()
	await settle(2)
	assert_false(is_instance_valid(node))
	assert_null(PaymentCore._node)
	assert_null(PaymentCore._life)
	assert_null(PaymentCore._adapter)
	assert_eq(PaymentCore._store, CoreContract.IapStore.IAP_STORE_UNSPECIFIED)
	assert_false(PaymentCore._is_ready)
	assert_null(PaymentCore._prepare_wait)
	assert_null(PaymentCore._recover_wait)
	assert_null(PaymentCore._restore_wait)
	assert_eq(PaymentCore._sku_products.size(), 0)
	assert_eq(PaymentCore._prices.size(), 0)
	assert_eq(PaymentCore._price_logged.size(), 0)
	assert_false(PaymentCore._purchasing)
	assert_eq(PaymentCore._buying_sku, "")
	assert_eq(PaymentCore._purchase_key, "")
	assert_eq(PaymentCore._in_flight.size(), 0)
	assert_eq(PaymentCore._finished.size(), 0)
	assert_false(PaymentCore._recover_called)
	assert_false(PaymentCore._google_restored)
	assert_eq(PaymentCore._login_epoch, 0)
	assert_eq(PaymentCore._calls.size(), 0)
	assert_eq(PaymentCore._choices.size(), 0)
	assert_eq(PaymentCore._retry_times.size(), 0)
	assert_eq(PaymentCore._next_due, -1)
	assert_false(PaymentCore._due_queued)
	assert_false(PaymentCore._due_call.is_valid())
	assert_eq(PaymentCore._store_call_timeout_ms, 0)
	assert_eq(PaymentCore._delivery_retry_delay_ms, 0)
	assert_false(fake.on_disconnected.is_valid(), "the adapter callbacks are cleared")
	assert_false(fake.on_purchase_updated.is_valid())


func test_init_again_without_a_store_adapter_fails_prepare_and_rejects_purchase() -> void:
	assert_true(await start())
	assert_true(await PaymentCore.prepare())
	PaymentCore.release()
	assert_true(PaymentCore.init())
	assert_false(PaymentCore.is_supported())
	assert_false(await PaymentCore.prepare())
	assert_eq(await PaymentCore.purchase(id_of("[iap_gems]")), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 2)


func test_release_stops_a_running_purchase_with_its_failure_value() -> void:
	assert_true(await start())
	respond_check()
	PaymentCoreDev.fake_hold_buy(true)
	var running: Purchase = start_purchase(id_of("[iap_gems]"))
	await settle()
	assert_false(running.done)
	PaymentCore.release()
	assert_true(running.done, "release resumed the purchase")
	assert_eq(running.result, PaymentCore.PurchaseResult.REJECTED)
	fake.set_hold_buy(false)
	await settle()


func test_release_stops_a_waiting_guest_warning() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, true, false, true))
	var running: Purchase = start_purchase(id_of("[iap_gems]"))
	await settle()
	assert_true(UICore.is_system_popup_visible())
	PaymentCore.release()
	assert_true(running.done)
	assert_eq(running.result, PaymentCore.PurchaseResult.REJECTED)
	# The popup stays until UICore is released: its callbacks belong to the released PaymentCore.
	await settle()


func test_core_node_leaving_the_tree_cleans_up_like_release() -> void:
	assert_true(await start())
	var node: Node = PaymentCore._node
	node.get_parent().remove_child(node)
	assert_false(PaymentCore.is_initialized())
	assert_null(PaymentCore._node)
	assert_null(PaymentCore._adapter)
	node.queue_free()
	await settle(2)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)
