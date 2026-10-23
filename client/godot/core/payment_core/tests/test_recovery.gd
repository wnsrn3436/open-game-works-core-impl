extends "res://core/payment_core/tests/support/payment_test_case.gd"
## Recovery, purchase updates, in-flight transactions, the login session, `restore_purchases`, the store `GOOGLE`
## restore, `RecoverySummary` and the subscription sync.


func _release_recover(status: CoreContract.PurchaseStatus, product_id: int) -> bool:
	return UnitTestCore.release_pending(
		RECOVER, NetworkCore.TransferResult.DONE, 200, envelope(recover_response(status, product_id))
	)


func test_each_unfinished_transaction_is_processed_by_the_recovery_table() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	var statuses: Array[CoreContract.PurchaseStatus] = [
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_PENDING,
	]
	for status: CoreContract.PurchaseStatus in statuses:
		PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
		respond_recover(status, gems)
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	respond_error(RECOVER, CoreContract.CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE)
	var result: RecoverPurchasesResult = await PaymentCore.recover_purchases()
	assert_true(result.ok)
	assert_eq(request_count(RECOVER), 6, "one RecoverPurchase per unfinished transaction")
	for i: int in 6:
		assert_eq(recovered_receipt(i), fake.transactions[i].receipt.data)
	assert_eq(recovered, PackedStringArray(["%d@0" % gems]), "one event for Granted, before its finish")
	var finished: PackedStringArray = PackedStringArray()
	for i: int in 3:
		finished.append("finish %s" % fake.transactions[i].receipt.transaction_id)
	var finish_calls: PackedStringArray = PackedStringArray()
	for call: String in fake.calls:
		if call.begins_with("finish "):
			finish_calls.append(call)
	assert_eq(finish_calls, finished, "Granted, AlreadyGranted and Invalid are finished")
	assert_eq(counts(result.summary), "1,1,1,1,1,1")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "Invalid")
	# The failure callback of `RecoverPurchase` handles every failure.
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "RecoverPurchase IAP_VERIFY_UNAVAILABLE")
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 0)
	var again: Array[CoreContract.PurchaseStatus] = [
		CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_PENDING,
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED,
	]
	for status: CoreContract.PurchaseStatus in again:
		respond_recover(status, gems)
	result = await PaymentCore.recover_purchases()
	assert_eq(request_count(RECOVER), 9, "OtherUser, Pending and Failed are processed again")
	assert_eq(counts(result.summary), "1,0,0,1,1,0")


func test_background_recovery_verify_unavailable_is_one_warn_with_no_screen_and_is_processed_again() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	assert_true((await PaymentCore.recover_purchases()).ok, "the first recover_purchases")
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	respond_error(RECOVER, CoreContract.CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE)
	respond_foreground()
	await background_return()
	await settle()
	assert_eq(request_count(RECOVER), 1, "the foreground return recovers the transaction")
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "RecoverPurchase IAP_VERIFY_UNAVAILABLE")
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 0)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)
	assert_null(find_button(ReservedString.network_confirm()), "no error screen")
	assert_false(shows(ReservedString.network_error_general()))
	assert_eq(fake.count_calls("finish"), 0)
	assert_eq(recovered.size(), 0)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	respond_foreground()
	await background_return()
	await settle()
	assert_eq(request_count(RECOVER), 2, "the next recovery processes it again")
	assert_eq(recovered_receipt(1), fake.transactions[0].receipt.data)
	assert_true(fake.transactions[0].finished)
	assert_eq(recovered.size(), 1)


func test_purchase_update_before_the_first_recover_is_not_verified_and_after_it_is() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	PaymentCoreDev.fake_set_next_buy_result(StoreAdapter.BuyStatus.PENDING)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.PENDING)
	PaymentCoreDev.fake_complete_pending()
	await settle()
	assert_eq(request_count(RECOVER), 0, "before the first recover_purchases")
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_eq(request_count(RECOVER), 1, "the recovery verifies it from list_unfinished")
	respond_check()
	PaymentCoreDev.fake_set_next_buy_result(StoreAdapter.BuyStatus.PENDING)
	assert_eq(await PaymentCore.purchase(gems), PaymentCore.PurchaseResult.PENDING)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	PaymentCoreDev.fake_complete_pending()
	await settle()
	assert_eq(request_count(RECOVER), 2, "processed at once after the first recover_purchases")
	assert_eq(recovered_receipt(1), fake.transactions[1].receipt.data)
	assert_true(fake.transactions[1].finished)
	assert_eq(recovered.size(), 2)


func test_purchase_update_of_an_in_flight_transaction_is_verified_once() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	UnitTestCore.add_pending(RECOVER)
	var running: Recovery = start_recover()
	await settle()
	assert_eq(request_count(RECOVER), 1)
	fake.notify_purchase(fake.transactions[0].receipt)
	await settle()
	assert_eq(request_count(RECOVER), 1, "in flight")
	assert_true(_release_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems))
	assert_true(await wait_recovery(running))
	fake.notify_purchase(fake.transactions[0].receipt)
	await settle()
	assert_eq(request_count(RECOVER), 1, "finished in this login session")
	assert_eq(fake.count_calls("finish"), 1)
	assert_eq(recovered.size(), 1)


func test_recovery_during_a_purchase_does_not_verify_its_transaction() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	respond_check()
	PaymentCoreDev.fake_hold_buy(true)
	var running: Purchase = start_purchase(gems)
	await settle()
	assert_eq(fake.transactions.size(), 1, "the held buy made its transaction")
	assert_true((await PaymentCore.recover_purchases()).ok, "recovery while buy runs")
	UnitTestCore.add_pending(VERIFY)
	PaymentCoreDev.fake_hold_buy(false)
	await settle()
	assert_eq(request_count(VERIFY), 1)
	var result: RecoverPurchasesResult = await PaymentCore.recover_purchases()
	assert_true(result.ok, "recovery before the VerifyPurchase response")
	assert_eq(counts(result.summary), "0,0,0,0,0,0", "skipped transactions are not counted")
	assert_true(UnitTestCore.release_pending(
		VERIFY, NetworkCore.TransferResult.DONE, 200,
		envelope(verify_response(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems))
	))
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(request_count(RECOVER), 0, "the only verification is VerifyPurchase")
	assert_eq(recovered.size(), 0)
	assert_eq(fake.count_calls("finish"), 1)


func test_verification_response_of_an_earlier_login_session_changes_nothing() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	UnitTestCore.add_pending(RECOVER)
	var running: Recovery = start_recover()
	await settle()
	assert_eq(request_count(RECOVER), 1)
	assert_true(await log_in(USER_ID + 1))
	_release_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	assert_false(await wait_recovery(running), "the result is dropped")
	await settle()
	assert_eq(fake.count_calls("finish"), 0)
	assert_eq(recovered.size(), 0)
	assert_eq(PaymentCore._finished.size(), 0)
	assert_eq(counts(running.summary), "0,0,0,0,0,0")
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_eq(request_count(RECOVER), 2, "the new session processes it again")
	assert_eq(fake.count_calls("finish"), 1)


func test_restore_is_true_when_list_owned_succeeds_and_false_without_verification_when_it_fails() -> void:
	assert_true(await start())
	var no_ads: int = id_of("[iap_no_ads]")
	var vip: int = id_of("[iap_vip]")
	PaymentCoreDev.fake_add_unfinished(no_ads, ACCOUNT_TOKEN)
	PaymentCoreDev.fake_add_unfinished(vip, ACCOUNT_TOKEN)
	PaymentCoreDev.fake_add_unfinished(id_of("[iap_gems]"), ACCOUNT_TOKEN)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID, no_ads)
	respond_error(RECOVER, CoreContract.CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE)
	var result: RestorePurchasesResult = await PaymentCore.restore_purchases()
	assert_true(result.ok)
	assert_eq(request_count(RECOVER), 2, "the owned transactions only")
	assert_eq(counts(result.summary), "0,0,1,0,0,1")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "Invalid")
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "RecoverPurchase IAP_VERIFY_UNAVAILABLE")
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 0)
	PaymentCoreDev.fake_set_fail("list_owned", true)
	result = await PaymentCore.restore_purchases()
	assert_false(result.ok)
	assert_eq(request_count(RECOVER), 2, "no verification")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1)


func test_google_restore_of_paymentcore_is_shared_with_a_content_restore() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_GOOGLE))
	var no_ads: int = id_of("[iap_no_ads]")
	PaymentCoreDev.fake_add_unfinished(no_ads, ACCOUNT_TOKEN)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER, no_ads)
	UnitTestCore.add_pending(RECOVER)
	assert_true((await PaymentCore.recover_purchases()).ok)
	await settle()
	assert_eq(fake.count_calls("list_owned"), 1, "PaymentCore called restore_purchases")
	assert_eq(request_count(RECOVER), 2)
	var running: Recovery = start_restore()
	await settle()
	assert_eq(fake.count_calls("list_owned"), 1, "the content restore joins the running one")
	assert_true(_release_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, no_ads))
	assert_true(await wait_recovery(running))
	assert_eq(counts(running.summary), "1,0,0,0,0,0", "the summary of the running restore")
	assert_eq(request_count(RECOVER), 2)


func test_google_restores_once_per_login_session_after_the_first_recovery() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_GOOGLE))
	var no_ads: int = id_of("[iap_no_ads]")
	var vip: int = id_of("[iap_vip]")
	PaymentCoreDev.fake_add_unfinished(no_ads, ACCOUNT_TOKEN)
	PaymentCoreDev.fake_add_unfinished(vip, ACCOUNT_TOKEN)
	for transaction: FakeStoreAdapter.Transaction in fake.transactions:
		transaction.finished = true
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, no_ads)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, vip)
	assert_true((await PaymentCore.recover_purchases()).ok)
	await settle()
	assert_eq(fake.count_calls("list_owned"), 1)
	assert_eq(request_count(RECOVER), 2, "one RecoverPurchase per owned transaction")
	assert_eq(recovered_receipt(0), fake.transactions[0].receipt.data)
	assert_eq(recovered_receipt(1), fake.transactions[1].receipt.data)
	assert_true((await PaymentCore.recover_purchases()).ok)
	await settle()
	assert_eq(fake.count_calls("list_owned"), 1, "not again in the same login session")
	assert_true(await log_in(USER_ID))
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, no_ads)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, vip)
	assert_true((await PaymentCore.recover_purchases()).ok)
	await settle()
	assert_eq(fake.count_calls("list_owned"), 2, "once in the new login session")


func test_apple_does_not_list_owned_before_a_content_restore() -> void:
	assert_true(await start())
	PaymentCoreDev.fake_add_unfinished(id_of("[iap_no_ads]"), ACCOUNT_TOKEN)
	fake.transactions[0].finished = true
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_true((await PaymentCore.recover_purchases()).ok)
	await settle()
	assert_eq(fake.count_calls("list_owned"), 0)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, id_of("[iap_no_ads]"))
	assert_true((await PaymentCore.restore_purchases()).ok)
	assert_eq(fake.count_calls("list_owned"), 1)


func test_summary_counts_processed_transactions_by_verify_result() -> void:
	assert_true(await start())
	var gems: int = id_of("[iap_gems]")
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	PaymentCoreDev.fake_add_unfinished(gems, ACCOUNT_TOKEN)
	fake.add_transaction("sku_of_no_product", GameData.IapProductType.CONSUMABLE, ACCOUNT_TOKEN)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER, gems)
	var recovery: RecoverPurchasesResult = await PaymentCore.recover_purchases()
	assert_true(recovery.ok)
	assert_eq(counts(recovery.summary), "1,0,0,1,0,0", "the unknown SKU is skipped")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "the unknown SKU")
	var no_ads: int = id_of("[iap_no_ads]")
	var vip: int = id_of("[iap_vip]")
	PaymentCoreDev.fake_add_unfinished(no_ads, ACCOUNT_TOKEN)
	PaymentCoreDev.fake_add_unfinished(vip, ACCOUNT_TOKEN)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, no_ads)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER, vip)
	var restore: RestorePurchasesResult = await PaymentCore.restore_purchases()
	assert_true(restore.ok)
	assert_eq(counts(restore.summary), "1,0,0,1,0,0")


func test_subscription_sync_follows_the_processing_when_a_subscription_row_exists() -> void:
	assert_true(await start())
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_true((await PaymentCore.restore_purchases()).ok)
	assert_eq(request_count(SYNC), 0, "no SubscriptionUserState")
	var vip: int = id_of("[iap_vip]")
	assert_true(apply(subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE, SERVER_TIME + DAY_MS)))
	PaymentCoreDev.fake_add_unfinished(id_of("[iap_gems]"), ACCOUNT_TOKEN)
	respond_recover(CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED, id_of("[iap_gems]"))
	respond(SYNC, CoreContract.SyncSubscriptionsResponse.new())
	assert_true((await PaymentCore.recover_purchases()).ok)
	assert_eq(request_names().slice(-2), PackedStringArray([RECOVER, SYNC]), "after the transaction processing")
	respond_error(SYNC, CoreContract.CoreError.CORE_ERROR_INTERNAL)
	assert_true((await PaymentCore.restore_purchases()).ok, "a failed sync keeps the result")
	assert_eq(request_count(SYNC), 2)
	assert_eq(UnitTestCore.check_logs("warn", "NetworkCore"), 1, "the SyncSubscriptions failure callback handles it")


func test_recover_without_a_store_adapter_is_false_without_store_request_or_log() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, false))
	var result: RecoverPurchasesResult = await PaymentCore.recover_purchases()
	assert_false(result.ok)
	assert_eq(counts(result.summary), "0,0,0,0,0,0")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)
	assert_eq(UnitTestCore.check_logs("warn", "PaymentCore"), 0)
	assert_eq(request_names().size(), 0)
	assert_false(PaymentCore._recover_called)
	respond_foreground()
	await background_return()
	assert_eq(request_count(RECOVER), 0)
	assert_false(PaymentCore._recover_called, "no recover_purchases on the foreground return")
