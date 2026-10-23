extends "res://core/payment_core/tests/support/payment_test_case.gd"
## `purchase`: the order of the steps, the verify result table, the store results, the start conditions, the
## `CheckPurchase` failures and the delivery retry.

const HoldingFinish := preload("res://core/payment_core/tests/support/holding_finish_store_adapter.gd")


func test_purchase_checks_buys_with_the_account_token_and_verifies_in_order() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(request_names(), PackedStringArray([CHECK, VERIFY]))
	assert_eq(fake.calls, PackedStringArray([
		"connect", "query_prices", "buy gems_apple %s" % ACCOUNT_TOKEN, "finish %s" % fake.transactions[0].receipt.transaction_id,
	]))
	var check: CoreContract.CheckPurchaseRequest = CoreContract.CheckPurchaseRequest.new()
	assert_true(check.decode(request_body(CHECK)))
	assert_eq(check.store, CoreContract.IapStore.IAP_STORE_APPLE)
	assert_eq(check.product_id, gems)
	var verify: CoreContract.VerifyPurchaseRequest = CoreContract.VerifyPurchaseRequest.new()
	assert_true(verify.decode(request_body(VERIFY)))
	assert_eq(verify.store, CoreContract.IapStore.IAP_STORE_APPLE)
	assert_eq(verify.receipt, fake.transactions[0].receipt.data)
	assert_true(verify.receipt.ends_with(":" + ACCOUNT_TOKEN), "the fake receipt holds the account token of CheckPurchase")


func test_check_purchase_failure_rejects_without_buy() -> void:
	assert_true(await start())
	respond_error(CHECK, CoreContract.CoreError.CORE_ERROR_IAP_LIMIT_REACHED)
	assert_eq(await PaymentCore.purchase(id_of("[iap_gems]")), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(fake.count_calls("buy"), 0)
	assert_eq(request_count(VERIFY), 0)
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 1, "a ServerError no failure callback handles")


func test_check_purchase_communication_failure_rejects_without_buy() -> void:
	assert_true(await start())
	for i: int in 2:
		UnitTestCore.add_result(CHECK, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())
	assert_eq(await PaymentCore.purchase(id_of("[iap_gems]")), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(fake.count_calls("buy"), 0)
	# NetworkCore sent the request again once without a screen; the second failure is the one failure of the request.
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 1, "one communication failure")


func test_age_confirmation_and_spend_limit_end_without_buy_or_default_display() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	var popups: int = UICore.get_layer(UICore.UILayer.POPUP).get_child_count()
	var messages: int = UICore.get_layer(UICore.UILayer.MESSAGE).get_child_count()
	respond_error(CHECK, CoreContract.CoreError.CORE_ERROR_AGE_CONFIRMATION_REQUIRED)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.AGE_CONFIRMATION_REQUIRED)
	respond_error(CHECK, CoreContract.CoreError.CORE_ERROR_IAP_SPEND_LIMIT_REACHED)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.SPEND_LIMIT_REACHED)
	await settle()
	assert_eq(fake.count_calls("buy"), 0)
	assert_false(UICore.is_system_popup_visible(), "no default system popup")
	assert_eq(UICore.get_layer(UICore.UILayer.POPUP).get_child_count(), popups, "no default popup")
	assert_eq(UICore.get_layer(UICore.UILayer.MESSAGE).get_child_count(), messages, "no default toast")


func test_verify_results_follow_the_purchase_table() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	var statuses: Array[CoreContract.PurchaseStatus] = [
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_PENDING,
	]
	var finishes: Array[bool] = [true, true, true, false, false]
	var expected: Array[PaymentCore.PurchaseResult] = [
		PaymentCore.PurchaseResult.SUCCESS,
		PaymentCore.PurchaseResult.SUCCESS,
		PaymentCore.PurchaseResult.VERIFY_FAILED,
		PaymentCore.PurchaseResult.OTHER_ACCOUNT,
		PaymentCore.PurchaseResult.PENDING,
	]
	for i: int in statuses.size():
		var before: int = fake.count_calls("finish")
		respond_check()
		respond_verify(statuses[i], gems)
		assert_eq(await PaymentCore.purchase(gems), expected[i], "result of status %d" % statuses[i])
		assert_eq(fake.count_calls("finish") - before, 1 if finishes[i] else 0, "finish of status %d" % statuses[i])
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "Invalid")
	assert_eq(UnitTestCore.check_logs("warn", "PaymentCore"), 1, "OtherUser")


func test_login_session_change_during_finish_rejects_the_purchase() -> void:
	var holding: HoldingFinish = HoldingFinish.new(CoreContract.IapStore.IAP_STORE_APPLE)
	assert_true(await start_with(holding))
	var gems: int = id_of("[iap_gems]")
	var statuses: Array[CoreContract.PurchaseStatus] = [
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID,
	]
	for i: int in statuses.size():
		var label: String = "status %d" % statuses[i]
		holding.hold_finish = true
		respond_check()
		respond_verify(statuses[i], gems)
		var running: Purchase = start_purchase(gems)
		await settle()
		assert_eq(holding.finish_started, i + 1, label + ": finish waits")
		assert_false(running.done, label)
		assert_true(await log_in(USER_ID + 1 + i), label)
		holding.release_finish()
		assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.REJECTED, label)
		assert_eq(PaymentCore._finished.size(), 0, label + ": the finish success list does not change")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "Invalid")
	assert_eq(recovered.size(), 0)


func test_verify_failure_is_delivery_pending_and_the_retry_verifies_and_finishes() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_error(VERIFY, CoreContract.CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.DELIVERY_PENDING)
	assert_eq(fake.count_calls("finish"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "IAP_VERIFY_UNAVAILABLE: the failure callback handles it")
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	await advance(RETRY_DELAY_MS - 1)
	assert_eq(request_count(RECOVER), 0, "not before the delay")
	await advance(1)
	assert_eq(request_count(RECOVER), 1, "the delivery retry")
	assert_eq(recovered_receipt(0), fake.transactions[0].receipt.data)
	assert_eq(fake.count_calls("finish"), 1)
	assert_true(fake.transactions[0].finished)


func test_foreground_return_calls_recover_once_after_the_first_recover() -> void:
	assert_true(await start())
	respond_foreground()
	await background_return()
	assert_eq(fake.count_calls("list_unfinished"), 0, "no recovery before the first recover_purchases")
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_eq(fake.count_calls("list_unfinished"), 1)
	respond_foreground()
	await background_return()
	assert_eq(fake.count_calls("list_unfinished"), 2)
	respond_foreground()
	await background_return()
	assert_eq(fake.count_calls("list_unfinished"), 3)


func test_other_user_is_other_account_and_recovery_neither_finishes_nor_publishes() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER, gems)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.OTHER_ACCOUNT)
	assert_eq(UnitTestCore.check_logs("warn", "PaymentCore"), 1)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER, gems)
	var result: RecoverPurchasesResult = await PaymentCore.recover_purchases()
	assert_true(result.ok)
	assert_eq(request_count(RECOVER), 1)
	assert_eq(fake.count_calls("finish"), 0)
	assert_eq(recovered.size(), 0)
	assert_false(fake.transactions[0].finished)


func test_buy_results_end_without_a_verify_request() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	var statuses: Array[StoreAdapter.BuyStatus] = [
		StoreAdapter.BuyStatus.CANCELLED, StoreAdapter.BuyStatus.PENDING, StoreAdapter.BuyStatus.FAILED,
	]
	var expected: Array[PaymentCore.PurchaseResult] = [
		PaymentCore.PurchaseResult.CANCELLED, PaymentCore.PurchaseResult.PENDING, PaymentCore.PurchaseResult.STORE_FAILED,
	]
	for i: int in statuses.size():
		respond_check()
		PaymentCoreDev.fake_set_next_buy_result(statuses[i])
		assert_eq(await PaymentCore.purchase(gems), expected[i])
	assert_eq(request_count(VERIFY), 0)
	assert_eq(fake.count_calls("buy"), 3)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "buy Failed")


func test_finish_failure_is_success_with_an_error_and_the_next_recovery_processes_it() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	PaymentCoreDev.fake_set_fail("finish", true)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_false(fake.transactions[0].finished)
	PaymentCoreDev.fake_set_fail("finish", false)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, gems)
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_eq(request_count(RECOVER), 1)
	assert_true(fake.transactions[0].finished)


func test_start_condition_violations_reject_without_check_or_buy() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_GOOGLE))
	assert_eq(await PaymentCore.purchase(999999), PaymentCore.PurchaseResult.REJECTED, "not in iap_product")
	assert_eq(await PaymentCore.purchase(id_of("[iap_apple_only]")), PaymentCore.PurchaseResult.REJECTED, "no SKU")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 2)
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("buy"), 0)


func test_purchase_while_another_runs_is_rejected_with_a_warning() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	PaymentCoreDev.fake_hold_buy(true)
	var first: Purchase = start_purchase(gems)
	await settle()
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(UnitTestCore.check_logs("warn", "PaymentCore"), 1)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)
	assert_eq(request_count(CHECK), 1)
	PaymentCoreDev.fake_hold_buy(false)
	assert_eq(await wait_purchase(first), PaymentCore.PurchaseResult.SUCCESS)


func test_purchase_without_login_is_rejected() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, true, true, false, false))
	assert_eq(await PaymentCore.purchase(id_of("[iap_gems]")), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("buy"), 0)


func test_purchase_without_a_store_adapter_is_rejected() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, false))
	assert_false(PaymentCore.is_supported())
	assert_eq(await PaymentCore.purchase(id_of("[iap_gems]")), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	assert_eq(request_count(CHECK), 0)


func test_purchase_prepares_first_and_a_failed_prepare_is_store_failed() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	PaymentCoreDev.fake_set_fail("connect", true)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.STORE_FAILED)
	assert_eq(fake.count_calls("connect"), 1)
	assert_eq(fake.count_calls("buy"), 0)
	assert_eq(request_count(CHECK), 0)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)
	PaymentCoreDev.fake_set_fail("connect", false)
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(fake.calls.slice(1, 4), PackedStringArray(["connect", "query_prices", "buy gems_apple %s" % ACCOUNT_TOKEN]))


func test_fake_purchase_success_applies_the_grant_delta() -> void:
	assert_true(await start())
	var no_ads: int = id_of("[iap_no_ads]")
	assert_false(PaymentCore.is_owned(no_ads))
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, no_ads, iap_delta(no_ads, 1))
	assert_eq(await PaymentCore.purchase(no_ads), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(UserStateCore.get_iap_purchase_count(no_ads), 1, "the delta is applied when purchase returns")
	assert_true(PaymentCore.is_owned(no_ads))


func test_logs_hold_no_receipt_data_or_account_token() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID, gems)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.VERIFY_FAILED)
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID, gems)
	PaymentCoreDev.fake_set_fail("finish", true)
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 3, "Invalid of the purchase and of the recovery, failed finish")
	var text: String = ""
	# The paths are under the app storage root.
	for path: String in LogCoreDev.list_log_files():
		text += FileAccess.get_file_as_string(CoreBuildInfo.storage_root + path)
	assert_false(text.is_empty(), "the logs were written")
	assert_false(text.contains(ACCOUNT_TOKEN), "no account token")
	for transaction: FakeStoreAdapter.Transaction in fake.transactions:
		assert_false(text.contains(transaction.receipt.data), "no receipt data")
		assert_true(text.contains(transaction.receipt.transaction_id), "the transaction ID names the transaction")
