class_name PaymentCoreDev
extends RefCounted
## DEV operations of PaymentCore: they drive the fake store adapter registered with `PaymentCore.set_store_adapter`.

const _TAG: String = "PaymentCore"


## Result of the next `buy`: `SUCCESS`, `CANCELLED`, `PENDING` or `FAILED`.
static func fake_set_next_buy_result(result: StoreAdapter.BuyStatus) -> void:
	var fake: FakeStoreAdapter = _fake("fake_set_next_buy_result")
	if fake != null:
		fake.next_buy_result = result


## While `hold` is true, `buy` makes its transaction, puts it in `list_unfinished` and does not return. `false` lets
## the held `buy` return `SUCCESS` with that transaction's receipt.
static func fake_hold_buy(hold: bool) -> void:
	var fake: FakeStoreAdapter = _fake("fake_hold_buy")
	if fake != null:
		fake.set_hold_buy(hold)


## Makes adapter operation `operation` (`connect`, `query_prices`, `buy`, `list_unfinished`, `list_owned`, `finish`,
## `open_subscription_management`) fail while `fail` is true.
static func fake_set_fail(operation: String, fail: bool) -> void:
	var fake: FakeStoreAdapter = _fake("fake_set_fail")
	if fake == null:
		return
	if not fake.is_operation(operation):
		LogCore.log_error(_TAG, "fake_set_fail: %s is not an adapter operation" % operation)
		return
	if fail:
		fake.failing[operation] = true
	else:
		fake.failing.erase(operation)


## Adds an unfinished transaction of `product_id` to `list_unfinished`.
static func fake_add_unfinished(product_id: int, account_token: String) -> void:
	var fake: FakeStoreAdapter = _fake("fake_add_unfinished")
	if fake == null:
		return
	var sku: String = _sku("fake_add_unfinished", fake, product_id)
	if not sku.is_empty():
		fake.add_transaction(sku, GameData.IapProductTable.get_row(product_id).type, account_token)


## Tells a purchase update for every pending transaction.
static func fake_complete_pending() -> void:
	var fake: FakeStoreAdapter = _fake("fake_complete_pending")
	if fake != null:
		fake.complete_pending()


## Tells a purchase update of a renewal transaction of `product_id`: the receipt data has the first fake transaction
## ID of the product as the original transaction ID and a new UUID v4 as the transaction ID.
static func fake_renew_subscription(product_id: int) -> void:
	var fake: FakeStoreAdapter = _fake("fake_renew_subscription")
	if fake == null:
		return
	var sku: String = _sku("fake_renew_subscription", fake, product_id)
	if not sku.is_empty() and not fake.renew_subscription(product_id, sku):
		LogCore.log_error(_TAG, "fake_renew_subscription: product %d has no fake transaction" % product_id)


static func _fake(operation: String) -> FakeStoreAdapter:
	var fake: FakeStoreAdapter = PaymentCore._adapter as FakeStoreAdapter
	if fake == null:
		LogCore.log_error(_TAG, "%s: the store adapter is not the fake adapter" % operation)
	return fake


static func _sku(operation: String, fake: FakeStoreAdapter, product_id: int) -> String:
	if not GameData.IapProductTable.has_row(product_id):
		LogCore.log_error(_TAG, "%s: product %d is not in iap_product" % [operation, product_id])
		return ""
	var product: GameData.IapProductRow = GameData.IapProductTable.get_row(product_id)
	var sku: String = product.sku_apple if fake.get_store() == CoreContract.IapStore.IAP_STORE_APPLE else product.sku_google
	if sku.is_empty():
		LogCore.log_error(_TAG, "%s: product %d has no SKU in this store" % [operation, product_id])
	return sku
