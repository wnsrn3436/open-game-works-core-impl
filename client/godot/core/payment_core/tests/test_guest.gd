extends "res://core/payment_core/tests/support/payment_test_case.gd"
## The guest warning popup of `purchase`.


## Starts a guest without a linked provider and with a usable social provider, and starts a purchase that waits on
## the guest warning popup.
func _start_guest_purchase() -> Purchase:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, true, false, true))
	var running: Purchase = start_purchase(id_of("[iap_gems]"))
	await settle()
	assert_true(UICore.is_system_popup_visible(), "the guest warning popup is open")
	assert_true(shows(ReservedString.payment_guest_warning()))
	return running


func test_guest_warning_opens_one_popup_before_check_purchase() -> void:
	var running: Purchase = await _start_guest_purchase()
	assert_eq(_count_system_popups(UICore.get_layer(UICore.UILayer.POPUP)), 1, "one popup")
	assert_eq(request_count(CHECK), 0, "the popup comes before CheckPurchase")
	assert_eq(fake.count_calls("connect"), 0, "and before prepare")
	assert_true(await press(ReservedString.payment_guest_cancel()))
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.CANCELLED)


func test_link_button_is_link_requested_without_check_or_buy() -> void:
	var running: Purchase = await _start_guest_purchase()
	assert_true(await press(ReservedString.payment_guest_link()))
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.LINK_REQUESTED)
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("buy"), 0)


func test_cancel_button_is_cancelled_without_check_or_buy() -> void:
	var running: Purchase = await _start_guest_purchase()
	assert_true(await press(ReservedString.payment_guest_cancel()))
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.CANCELLED)
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("buy"), 0)


func test_back_input_is_cancelled_without_check_or_buy() -> void:
	var running: Purchase = await _start_guest_purchase()
	await back()
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.CANCELLED)
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("buy"), 0)


func test_close_all_popups_is_cancelled_without_check_or_buy() -> void:
	var running: Purchase = await _start_guest_purchase()
	UICore.close_all_popups()
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.CANCELLED)
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("buy"), 0)


func test_continue_button_goes_on_with_the_purchase() -> void:
	var running: Purchase = await _start_guest_purchase()
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	assert_true(await press(ReservedString.payment_guest_continue()))
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(request_names(), PackedStringArray([CHECK, VERIFY]))
	assert_eq(fake.count_calls("buy"), 1)


func test_guest_warning_that_does_not_open_is_rejected_without_check_or_buy() -> void:
	assert_true(start_modules())
	assert_true(await prepare_modules(false))
	assert_true(start_auth(true))
	assert_true(start_payment(CoreContract.IapStore.IAP_STORE_APPLE))
	assert_true(await log_in(USER_ID, false))
	assert_eq(await PaymentCore.purchase(id_of("[iap_gems]")), PaymentCore.PurchaseResult.REJECTED)
	assert_eq(UnitTestCore.check_logs("error", "UICore"), 1, "open_system_popup before UICore.prepare")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 1, "the popup did not open")
	assert_eq(request_count(CHECK), 0)
	assert_eq(fake.count_calls("connect"), 0)
	assert_eq(fake.count_calls("buy"), 0)
	assert_eq(PaymentCore._choices.size(), 0)


func test_no_popup_with_a_linked_provider() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, true, true, true))
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	var running: Purchase = start_purchase(gems)
	await settle(2)
	assert_false(UICore.is_system_popup_visible())
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.SUCCESS)


func test_no_popup_without_a_usable_social_provider() -> void:
	assert_true(await start(CoreContract.IapStore.IAP_STORE_APPLE, true, false, false))
	var gems: int = id_of("[iap_gems]")
	respond_check()
	respond_verify(CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, gems)
	var running: Purchase = start_purchase(gems)
	await settle(2)
	assert_false(UICore.is_system_popup_visible())
	assert_eq(await wait_purchase(running), PaymentCore.PurchaseResult.SUCCESS)


func _count_system_popups(node: Node) -> int:
	var count: int = 1 if node.name == "SystemPopup" else 0
	for child: Node in node.get_children():
		count += _count_system_popups(child)
	return count
