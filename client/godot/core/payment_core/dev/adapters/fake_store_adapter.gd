class_name FakeStoreAdapter
extends StoreAdapter
## Fake store adapter: works as the store it was made for and shows no store screen. `connect`, `query_prices`, the
## two lists and `finish` succeed, a price text is the SKU itself, and `buy` succeeds unless a next result was set.
## A `buy` transaction gets a new UUID v4 transaction ID and the receipt data `fake:<SKU>:<transaction ID>:<account
## token>` of the server `iap` fake adapter, and stays in `list_unfinished` until its `finish` succeeds.
## `PaymentCoreDev` drives it.

signal hold_released

const _OPERATIONS: PackedStringArray = [
	"connect", "query_prices", "buy", "list_unfinished", "list_owned", "finish", "open_subscription_management",
]


class Transaction extends RefCounted:
	var receipt: StoreAdapter.Receipt = null
	var product_id: int = 0
	var product_type: GameData.IapProductType = GameData.IapProductType.NONE
	var account_token: String = ""
	## A `Pending` buy: not in the lists until `fake_complete_pending`.
	var pending: bool = false
	var finished: bool = false


## Adapter calls in order: the operation name, then for `buy` the SKU and the account token and for `finish` the
## transaction ID, separated by spaces.
var calls: PackedStringArray = PackedStringArray()
## Result of the next `buy`: a `BuyStatus` value. -1: none.
var next_buy_result: int = -1
var hold_buy: bool = false
## Operation names that fail.
var failing: Dictionary[String, bool] = {}
var transactions: Array[Transaction] = []

var _store: CoreContract.IapStore = CoreContract.IapStore.IAP_STORE_UNSPECIFIED
var _crypto: Crypto = Crypto.new()


func _init(store: CoreContract.IapStore) -> void:
	_store = store


func get_store() -> CoreContract.IapStore:
	return _store


func connect_store() -> bool:
	calls.append("connect")
	await _frame()
	return not failing.has("connect")


func query_prices(skus: PackedStringArray) -> PriceResult:
	calls.append("query_prices")
	await _frame()
	var result: PriceResult = PriceResult.new()
	if failing.has("query_prices"):
		return result
	result.ok = true
	result.prices = skus.duplicate()
	return result


func buy(sku: String, product_type: GameData.IapProductType, account_token: String) -> BuyResult:
	calls.append("buy %s %s" % [sku, account_token])
	await _frame()
	if failing.has("buy"):
		return BuyResult.new(BuyStatus.FAILED)
	if hold_buy:
		var held: Transaction = add_transaction(sku, product_type, account_token)
		while hold_buy:
			await hold_released
		return BuyResult.new(BuyStatus.SUCCESS, held.receipt)
	var status: int = next_buy_result if next_buy_result >= 0 else BuyStatus.SUCCESS
	next_buy_result = -1
	if status == BuyStatus.SUCCESS:
		return BuyResult.new(BuyStatus.SUCCESS, add_transaction(sku, product_type, account_token).receipt)
	if status == BuyStatus.PENDING:
		add_transaction(sku, product_type, account_token).pending = true
		return BuyResult.new(BuyStatus.PENDING)
	return BuyResult.new(status as BuyStatus)


func list_unfinished() -> ReceiptList:
	calls.append("list_unfinished")
	await _frame()
	var list: ReceiptList = ReceiptList.new()
	if failing.has("list_unfinished"):
		return list
	for transaction: Transaction in transactions:
		if not transaction.pending and not transaction.finished:
			list.receipts.append(transaction.receipt)
	list.ok = true
	return list


func list_owned() -> ReceiptList:
	calls.append("list_owned")
	await _frame()
	var list: ReceiptList = ReceiptList.new()
	if failing.has("list_owned"):
		return list
	for transaction: Transaction in transactions:
		var owned_type: bool = (
			transaction.product_type == GameData.IapProductType.NON_CONSUMABLE
			or transaction.product_type == GameData.IapProductType.SUBSCRIPTION
		)
		if owned_type and not transaction.pending:
			list.receipts.append(transaction.receipt)
	list.ok = true
	return list


func finish(receipt: Receipt, _product_type: GameData.IapProductType) -> bool:
	calls.append("finish %s" % receipt.transaction_id)
	await _frame()
	if failing.has("finish"):
		return false
	for transaction: Transaction in transactions:
		if transaction.receipt.transaction_id == receipt.transaction_id:
			transaction.finished = true
	return true


func open_subscription_management() -> bool:
	calls.append("open_subscription_management")
	await _frame()
	return not failing.has("open_subscription_management")


## Number of calls of operation `operation`.
func count_calls(operation: String) -> int:
	var count: int = 0
	for call: String in calls:
		if call == operation or call.begins_with(operation + " "):
			count += 1
	return count


func is_operation(operation: String) -> bool:
	return _OPERATIONS.has(operation)


func set_hold_buy(hold: bool) -> void:
	hold_buy = hold
	if not hold:
		hold_released.emit()


## A new transaction of `sku`, unfinished. `original_id` is added to the receipt data when it is not empty.
func add_transaction(
	sku: String, product_type: GameData.IapProductType, account_token: String, original_id: String = ""
) -> Transaction:
	var transaction: Transaction = Transaction.new()
	var id: String = _new_transaction_id()
	var data: String = "fake:%s:%s:%s" % [sku, id, account_token]
	if not original_id.is_empty():
		data += ":" + original_id
	transaction.receipt = Receipt.new(_store, sku, id, data)
	transaction.product_id = _product_of(sku)
	transaction.product_type = product_type
	transaction.account_token = account_token
	transactions.append(transaction)
	return transaction


## Ends every pending transaction with a purchase update.
func complete_pending() -> void:
	for transaction: Transaction in transactions:
		if transaction.pending:
			transaction.pending = false
			_notify_purchase_updated(transaction.receipt)


## A renewal transaction of the subscription `product_id` with a purchase update.
func renew_subscription(product_id: int, sku: String) -> bool:
	var first: Transaction = null
	for transaction: Transaction in transactions:
		if transaction.product_id == product_id:
			first = transaction
			break
	if first == null:
		return false
	var renewal: Transaction = add_transaction(
		sku, GameData.IapProductType.SUBSCRIPTION, first.account_token, first.receipt.transaction_id
	)
	_notify_purchase_updated(renewal.receipt)
	return true


func notify_disconnected() -> void:
	_notify_disconnected()


func notify_purchase(receipt: Receipt) -> void:
	_notify_purchase_updated(receipt)


func _product_of(sku: String) -> int:
	for product: GameData.IapProductRow in GameData.IapProductTable.all_rows():
		var store_sku: String = product.sku_apple if _store == CoreContract.IapStore.IAP_STORE_APPLE else product.sku_google
		if store_sku == sku:
			return product.id
	return 0


func _frame() -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null:
		await tree.process_frame


## Lowercase UUID v4.
func _new_transaction_id() -> String:
	var bytes: PackedByteArray = _crypto.generate_random_bytes(16)
	bytes[6] = (bytes[6] & 0x0F) | 0x40
	bytes[8] = (bytes[8] & 0x3F) | 0x80
	var hex: String = bytes.hex_encode()
	return "%s-%s-%s-%s-%s" % [hex.substr(0, 8), hex.substr(8, 4), hex.substr(12, 4), hex.substr(16, 4), hex.substr(20, 12)]
