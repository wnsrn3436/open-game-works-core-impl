extends "res://core/payment_core/tests/support/payment_test_case.gd"
## Subscription purchase and renewal, entitlement, pass days, ownership and the daily reward.


func _margin() -> int:
	return CoreSettings.get_int("TimeCore.reachMarginMs")


## Start of the game day `days` after today.
func _day_start(days: int) -> int:
	return TimeCore.get_current_day() + days * DAY_MS


func test_subscription_purchase_gives_the_entitlement_until_ends_at() -> void:
	assert_true(await start())
	var vip: int = id_of("[iap_vip]")
	var ends_at: int = SERVER_TIME + DAY_MS
	respond_check()
	respond_verify(
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, vip,
		subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE, ends_at)
	)
	assert_eq(await PaymentCore.purchase(vip), PaymentCore.PurchaseResult.SUCCESS)
	assert_eq(fake.transactions[0].product_type, GameData.IapProductType.SUBSCRIPTION, "buy got the Subscription type")
	assert_true(PaymentCore.is_subscribed(vip))
	assert_true(PaymentCore.is_owned(vip))
	assert_eq(PaymentCore.get_subscription_ends_at(vip), ends_at)
	await advance_to(ends_at - _margin() - 1)
	assert_true(PaymentCore.is_subscribed(vip), "at ends_at - reachMarginMs - 1")
	await advance(1)
	assert_false(PaymentCore.is_subscribed(vip), "at ends_at - reachMarginMs")
	assert_false(PaymentCore.is_owned(vip))


func test_entitlement_follows_the_subscription_state() -> void:
	assert_true(await start())
	var vip: int = id_of("[iap_vip]")
	assert_false(PaymentCore.is_subscribed(vip), "no row")
	assert_eq(PaymentCore.get_subscription_ends_at(vip), 0)
	var ends_at: int = SERVER_TIME + DAY_MS
	assert_true(apply(subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD, ends_at)))
	assert_true(PaymentCore.is_subscribed(vip), "GRACE_PERIOD")
	assert_true(apply(subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_BILLING_RETRY, ends_at)))
	assert_false(PaymentCore.is_subscribed(vip), "BILLING_RETRY")
	assert_false(PaymentCore.is_subscribed(id_of("[iap_gems]")), "not a Subscription")
	assert_eq(PaymentCore.get_subscription_ends_at(id_of("[iap_gems]")), 0)
	assert_false(PaymentCore.is_subscribed(999999), "not in iap_product")
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 3)


func test_renewal_sends_one_recover_purchase_and_moves_ends_at() -> void:
	assert_true(await start())
	var vip: int = id_of("[iap_vip]")
	var ends_at: int = SERVER_TIME + DAY_MS
	respond_check()
	respond_verify(
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, vip,
		subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE, ends_at)
	)
	assert_eq(await PaymentCore.purchase(vip), PaymentCore.PurchaseResult.SUCCESS)
	respond(SYNC, CoreContract.SyncSubscriptionsResponse.new())
	assert_true((await PaymentCore.recover_purchases()).ok)
	var renewed_at: int = ends_at + 30 * DAY_MS
	respond_recover(
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED, vip,
		subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE, renewed_at)
	)
	PaymentCoreDev.fake_renew_subscription(vip)
	await settle()
	assert_eq(request_count(RECOVER), 1)
	var original: String = fake.transactions[0].receipt.transaction_id
	assert_true(recovered_receipt(0).ends_with(":" + original), "the renewal receipt names the original transaction")
	assert_eq(PaymentCore.get_subscription_ends_at(vip), renewed_at)
	assert_eq(recovered, PackedStringArray(["%d@1" % vip]))


func test_daily_reward_can_be_claimed_again_from_the_next_game_day() -> void:
	assert_true(await start())
	var vip: int = id_of("[iap_vip]")
	assert_true(apply(subscription_delta(vip, CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE, SERVER_TIME + 30 * DAY_MS)))
	assert_true(PaymentCore.can_claim_daily(vip), "not claimed")
	var claimed_day: int = today()
	respond(CLAIM, CoreContract.ClaimIapDailyResponse.new(), iap_delta(vip, 0, 0, claimed_day))
	assert_true(await PaymentCore.claim_daily(vip))
	var claim: CoreContract.ClaimIapDailyRequest = CoreContract.ClaimIapDailyRequest.new()
	assert_true(claim.decode(request_body(CLAIM)))
	assert_eq(claim.product_id, vip)
	assert_false(PaymentCore.can_claim_daily(vip), "claimed today")
	var boundary: int = _day_start(1)
	await advance_to(boundary + _margin() - 1)
	assert_false(PaymentCore.can_claim_daily(vip), "at the next boundary + reachMarginMs - 1")
	await advance(1)
	assert_true(PaymentCore.can_claim_daily(vip), "at the next boundary + reachMarginMs")


func test_pass_days_left_ownership_and_daily_end_on_the_pass_end_day() -> void:
	assert_true(await start())
	var pass_id: int = id_of("[iap_pass]")
	assert_eq(PaymentCore.get_pass_days_left(pass_id), 0)
	assert_false(PaymentCore.is_owned(pass_id))
	assert_false(PaymentCore.can_claim_daily(pass_id))
	var end_day: int = today() + 2
	assert_true(apply(iap_delta(pass_id, 1, end_day)))
	assert_eq(PaymentCore.get_pass_days_left(pass_id), 2)
	assert_true(PaymentCore.is_owned(pass_id))
	assert_true(PaymentCore.can_claim_daily(pass_id))
	await advance_to(_day_start(2) + _margin() - 1)
	assert_eq(PaymentCore.get_pass_days_left(pass_id), 1)
	assert_true(PaymentCore.can_claim_daily(pass_id))
	await advance(1)
	assert_eq(today(), end_day)
	assert_eq(PaymentCore.get_pass_days_left(pass_id), 0)
	assert_false(PaymentCore.is_owned(pass_id), "from the pass end day")
	assert_false(PaymentCore.can_claim_daily(pass_id), "from the pass end day")


func test_owned_follows_the_product_type() -> void:
	assert_true(await start())
	var no_ads: int = id_of("[iap_no_ads]")
	var gems: int = id_of("[iap_gems]")
	assert_false(PaymentCore.is_owned(no_ads))
	assert_true(apply(iap_delta(no_ads, 1)))
	assert_true(PaymentCore.is_owned(no_ads), "NonConsumable after its grant delta")
	assert_true(apply(iap_delta(gems, 3)))
	assert_false(PaymentCore.is_owned(gems), "a Consumable that is not a pass")
	assert_eq(PaymentCore.get_pass_days_left(gems), 0, "not a pass")
	assert_false(PaymentCore.can_claim_daily(no_ads), "no daily reward")
	assert_false(PaymentCore.is_owned(999999))
	assert_false(PaymentCore.can_claim_daily(999999))
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 2)
