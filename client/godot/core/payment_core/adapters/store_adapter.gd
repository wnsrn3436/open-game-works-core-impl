class_name StoreAdapter
extends RefCounted
## Base of the store adapters. A store adapter wraps the SDK of one store; every store-specific step stays in it.
## `BootstrapCore` passes one with `PaymentCore.set_store_adapter`. Only `PaymentCore` calls it.
##
## The adapter tells `PaymentCore` of a connection loss and of a purchase update (a transaction that ended outside
## `buy`) through `_notify_disconnected` and `_notify_purchase_updated`, between `start` and `stop`.

enum BuyStatus { SUCCESS, CANCELLED, PENDING, FAILED }


## A store transaction: store, SKU, transaction ID and the receipt data the store issued.
class Receipt extends RefCounted:
	var store: CoreContract.IapStore = CoreContract.IapStore.IAP_STORE_UNSPECIFIED
	var sku: String = ""
	var transaction_id: String = ""
	## Proof of purchase, sent as is in `VerifyPurchase` and `RecoverPurchase`. Never logged.
	var data: String = ""

	func _init(
		receipt_store: CoreContract.IapStore = CoreContract.IapStore.IAP_STORE_UNSPECIFIED,
		receipt_sku: String = "",
		id: String = "",
		receipt_data: String = ""
	) -> void:
		store = receipt_store
		sku = receipt_sku
		transaction_id = id
		data = receipt_data


## Result of `query_prices`.
class PriceResult extends RefCounted:
	var ok: bool = false
	## Price text of each SKU, in the order of the request. An empty string when the store gave none.
	var prices: PackedStringArray = PackedStringArray()


## Result of `buy`.
class BuyResult extends RefCounted:
	var status: BuyStatus = BuyStatus.FAILED
	## Receipt of the transaction. Filled only for `SUCCESS`.
	var receipt: Receipt = null

	func _init(value: BuyStatus = BuyStatus.FAILED, bought: Receipt = null) -> void:
		status = value
		receipt = bought


## Result of `list_unfinished` and `list_owned`.
class ReceiptList extends RefCounted:
	var ok: bool = false
	var receipts: Array[Receipt] = []


## Called with no argument on a connection loss. Set by `PaymentCore`.
var on_disconnected: Callable = Callable()
## Called with the `Receipt` of a purchase update. Set by `PaymentCore`.
var on_purchase_updated: Callable = Callable()
## Time limit of one store call other than `buy`, ms: `PaymentCore.storeCallTimeoutMs`. Set by `PaymentCore.init`.
var call_timeout_ms: int = 0


## Store of this adapter.
func get_store() -> CoreContract.IapStore:
	return CoreContract.IapStore.IAP_STORE_UNSPECIFIED


## Starts telling the notifications. `PaymentCore.init` calls it.
func start() -> void:
	pass


## Stops telling the notifications and ends the store calls that wait, with their failure value. `PaymentCore.release`
## calls it.
func stop() -> void:
	pass


## Async. Connects to the store. The spec name is `connect`, which is a method of `Object`.
func connect_store() -> bool:
	return false


## Async. Price text of each SKU of `skus`.
func query_prices(_skus: PackedStringArray) -> PriceResult:
	return PriceResult.new()


## Async. Buys `sku` with the account token. Waits for the user; no time limit.
func buy(_sku: String, _product_type: GameData.IapProductType, _account_token: String) -> BuyResult:
	return BuyResult.new()


## Async. Receipts of the transactions whose `finish` has not succeeded.
func list_unfinished() -> ReceiptList:
	return ReceiptList.new()


## Async. Receipts of the `NonConsumable` products and of the `Subscription` products the store sees as valid.
func list_owned() -> ReceiptList:
	return ReceiptList.new()


## Async. Ends the transaction of `receipt` at the store.
func finish(_receipt: Receipt, _product_type: GameData.IapProductType) -> bool:
	return false


## Async. Opens the subscription management screen of the store. Whether it opened.
func open_subscription_management() -> bool:
	return false


## Tells `PaymentCore` of a connection loss.
func _notify_disconnected() -> void:
	if on_disconnected.is_valid():
		on_disconnected.call()


## Tells `PaymentCore` of a purchase update.
func _notify_purchase_updated(receipt: Receipt) -> void:
	if on_purchase_updated.is_valid() and receipt != null:
		on_purchase_updated.call(receipt)
