class_name PaymentCore
extends RefCounted
## Store purchase flow, subscription purchase and restore, entitlement and pass lookup, product ownership and the
## daily reward claim. Checks a purchase with server `iap` first and suggests an account link to a guest, sends the
## receipt of a bought transaction to `iap` for the verification and the grant, and processes again the transactions
## that were not granted or not ended at the store.

enum PurchaseResult {
	SUCCESS,
	CANCELLED,
	LINK_REQUESTED,
	PENDING,
	STORE_FAILED,
	VERIFY_FAILED,
	DELIVERY_PENDING,
	OTHER_ACCOUNT,
	REJECTED,
	AGE_CONFIRMATION_REQUIRED,
	SPEND_LIMIT_REACHED,
}

const _TAG: String = "PaymentCore"
const _KEY_STORE_CALL_TIMEOUT: String = "PaymentCore.storeCallTimeoutMs"
const _KEY_DELIVERY_RETRY_DELAY: String = "PaymentCore.deliveryRetryDelayMs"
const _KEY_REACH_MARGIN: String = "TimeCore.reachMarginMs"
## Size of the buffer `AuthCore.list_linked_providers` fills: more than the login providers.
const _PROVIDER_BUFFER_SIZE: int = 8
## Index of `[payment_guest_cancel]` in the guest warning buttons.
const _GUEST_CANCEL_INDEX: int = 2

const _NODE := preload("res://core/payment_core/payment_core_node.gd")
const _WAIT := preload("res://core/payment_core/payment_wait.gd")
const _REQUEST := preload("res://core/payment_core/payment_request.gd")
const _GUEST_CHOICE := preload("res://core/payment_core/payment_guest_choice.gd")
const _OUTCOME := preload("res://core/payment_core/payment_outcome.gd")

static var _is_initialized: bool = false
## New object every `init`. An async operation that finds another object after an `await` stopped by `release`.
static var _life: RefCounted = null
static var _node: _NODE = null
static var _store_call_timeout_ms: int = 0
static var _delivery_retry_delay_ms: int = 0
## Store adapter `set_store_adapter` registered. `null`: there is none.
static var _adapter: StoreAdapter = null
static var _store: CoreContract.IapStore = CoreContract.IapStore.IAP_STORE_UNSPECIFIED
static var _is_ready: bool = false
## Count of connection loss notifications. A `prepare` that sees it change while running fails.
static var _disconnects: int = 0
## Running `prepare`, `recover_purchases` and `restore_purchases` that later calls share. `null`: none runs.
static var _prepare_wait: _WAIT = null
static var _recover_wait: _WAIT = null
static var _restore_wait: _WAIT = null
## SKU table: SKU of this store → product ID value.
static var _sku_products: Dictionary[String, int] = {}
## Price text of each product of the SKU table, from the last price fetch.
static var _prices: Dictionary[int, String] = {}
## Products whose missing price was logged.
static var _price_logged: Dictionary[int, bool] = {}
static var _purchasing: bool = false
## SKU of the running `buy`: every transaction of it is in flight. Empty when no `buy` runs.
static var _buying_sku: String = ""
## Transaction key of the receipt the running `purchase` verifies. Empty when there is none.
static var _purchase_key: String = ""
## Transaction keys whose transaction processing runs.
static var _in_flight: Dictionary[String, bool] = {}
## `finish` success list of the login session: transaction keys.
static var _finished: Dictionary[String, bool] = {}
static var _recover_called: bool = false
## Whether PaymentCore called `restore_purchases` for store `GOOGLE` in this login session.
static var _google_restored: bool = false
## Goes up when the login session changes.
static var _login_epoch: int = 0
## Store calls and requests that run. `release` finishes them with a failure.
static var _calls: Array[_WAIT] = []
static var _choices: Array[_GUEST_CHOICE] = []
## Real elapsed times the waiting delivery retries call `recover_purchases` at.
static var _retry_times: PackedInt64Array = PackedInt64Array()
## Earliest store call time limit or delivery retry time. -1: none.
static var _next_due: int = -1
static var _due_queued: bool = false
static var _due_call: Callable = Callable()


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not _read_settings():
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: no scene tree")
		return false
	_life = RefCounted.new()
	_due_call = PaymentCore._run_due.bind(_life)
	_node = _NODE.new()
	_node.name = "PaymentCore"
	# The store call time limits and the delivery retries count real elapsed time, which goes on during a pause.
	_node.process_mode = Node.PROCESS_MODE_ALWAYS
	tree.root.add_child(_node)
	var subscribed: bool = (
		EventCore.subscribe(AppForegroundReturnedEvent, _node._on_app_foreground_returned)
		and EventCore.subscribe(LoginCompletedEvent, _node._on_login_completed)
		and EventCore.subscribe(SessionEndedEvent, _node._on_session_ended)
	)
	_is_initialized = true
	if not subscribed:
		LogCore.log_error(_TAG, "init: event subscription failed")
		release()
		return false
	if _adapter != null:
		_store = _adapter.get_store()
		_adapter.on_disconnected = PaymentCore._on_store_disconnected
		_adapter.on_purchase_updated = PaymentCore._on_purchase_updated
		_adapter.call_timeout_ms = _store_call_timeout_ms
		_adapter.start()
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


static func _on_node_exit(node: Node) -> void:
	if _is_initialized and node == _node:
		_clean_up(false)


## `release`. `detach` is `false` when the core node leaves the tree by itself (app exit).
static func _clean_up(detach: bool) -> void:
	_is_initialized = false
	_life = null
	var calls: Array[_WAIT] = _calls
	_calls = []
	for call: _WAIT in calls:
		call.finish(false)
	var choices: Array[_GUEST_CHOICE] = _choices
	_choices = []
	for choice: _GUEST_CHOICE in choices:
		choice.cancel()
	var shared: Array[_WAIT] = [_prepare_wait, _recover_wait, _restore_wait]
	for wait: _WAIT in shared:
		if wait != null:
			wait.finish(false)
	if _adapter != null:
		_adapter.stop()
		_adapter.on_disconnected = Callable()
		_adapter.on_purchase_updated = Callable()
	var node: _NODE = _node
	_node = null
	if node != null:
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		if not node.is_queued_for_deletion():
			node.queue_free()
	_store_call_timeout_ms = 0
	_delivery_retry_delay_ms = 0
	_adapter = null
	_store = CoreContract.IapStore.IAP_STORE_UNSPECIFIED
	_is_ready = false
	_disconnects = 0
	_prepare_wait = null
	_recover_wait = null
	_restore_wait = null
	_sku_products = {}
	_prices = {}
	_price_logged = {}
	_purchasing = false
	_buying_sku = ""
	_purchase_key = ""
	_in_flight = {}
	_finished = {}
	_recover_called = false
	_google_restored = false
	_login_epoch = 0
	_retry_times = PackedInt64Array()
	_next_due = -1
	_due_queued = false
	_due_call = Callable()


static func _read_settings() -> bool:
	var ok: bool = true
	var keys: PackedStringArray = [_KEY_STORE_CALL_TIMEOUT, _KEY_DELIVERY_RETRY_DELAY, _KEY_REACH_MARGIN]
	for key: String in keys:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: setting %s is missing or is not an integer" % key)
			ok = false
	if not ok:
		return false
	_store_call_timeout_ms = CoreSettings.get_int(_KEY_STORE_CALL_TIMEOUT)
	_delivery_retry_delay_ms = CoreSettings.get_int(_KEY_DELIVERY_RETRY_DELAY)
	return true


static func _check(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s: not initialized" % operation)
	return false


# --- store adapter ---


static func set_store_adapter(adapter: StoreAdapter) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_store_adapter: called after init")
		return
	_adapter = adapter


static func is_supported() -> bool:
	if not _check("is_supported"):
		return false
	return _adapter != null


static func _on_store_disconnected() -> void:
	if not _is_initialized:
		return
	_is_ready = false
	_disconnects += 1


static func _on_purchase_updated(receipt: StoreAdapter.Receipt) -> void:
	if not _is_initialized or not _recover_called:
		return
	_process_update(receipt)


static func _process_update(receipt: StoreAdapter.Receipt) -> void:
	await _process_transaction(receipt, RecoverySummary.new(), _login_epoch)


# --- prepare and price ---


static func prepare() -> bool:
	if not _check("prepare"):
		return false
	if _adapter == null:
		LogCore.log_error(_TAG, "prepare: no store adapter")
		return false
	return await _prepare()


static func get_price(product_id: int) -> String:
	if not _check("get_price") or not _has_product("get_price", product_id):
		return ""
	if not _is_ready:
		LogCore.log_error(_TAG, "get_price: the store is not ready")
		return ""
	if not _prices.has(product_id):
		LogCore.log_error(_TAG, "get_price: product %d is not in the SKU table" % product_id)
		return ""
	return _prices[product_id]


## `prepare` without the checks. A running one gives its result to every caller.
static func _prepare() -> bool:
	if _is_ready:
		return true
	if _prepare_wait != null:
		var shared: _WAIT = _prepare_wait
		if not shared.finished:
			await shared.done
		return shared.ok
	var life: RefCounted = _life
	var wait: _WAIT = _WAIT.new()
	_prepare_wait = wait
	var disconnects: int = _disconnects
	var ok: bool = await _run_prepare()
	if life != _life:
		wait.finish(false)
		return false
	_prepare_wait = null
	if _disconnects != disconnects:
		ok = false
	_is_ready = ok
	wait.finish(ok)
	return ok


## Processing order of `prepare`: `connect`, the SKU table, the price fetch.
static func _run_prepare() -> bool:
	var life: RefCounted = _life
	var adapter: StoreAdapter = _adapter
	var connected: _WAIT = await _await_job(func() -> bool: return await adapter.connect_store(), _store_call_timeout_ms)
	if life != _life:
		return false
	if not connected.ok:
		LogCore.log_error(_TAG, "prepare: connect failed")
		return false
	_build_sku_table()
	if _sku_products.is_empty():
		return true
	var skus: PackedStringArray = PackedStringArray(_sku_products.keys())
	var priced: _WAIT = await _await_job(
		func() -> StoreAdapter.PriceResult: return await adapter.query_prices(skus), _store_call_timeout_ms
	)
	if life != _life:
		return false
	var result: StoreAdapter.PriceResult = priced.value as StoreAdapter.PriceResult
	if not priced.ok or result == null or not result.ok or result.prices.size() != skus.size():
		LogCore.log_error(_TAG, "prepare: query_prices failed")
		return false
	_prices = {}
	for i: int in skus.size():
		var product_id: int = _sku_products[skus[i]]
		_prices[product_id] = result.prices[i]
		if result.prices[i].is_empty() and not _price_logged.has(product_id):
			_price_logged[product_id] = true
			LogCore.log_error(_TAG, "prepare: the store gave no price for product %d (SKU %s)" % [product_id, skus[i]])
	return true


static func _build_sku_table() -> void:
	_sku_products = {}
	for product: GameData.IapProductRow in GameData.IapProductTable.all_rows():
		var sku: String = _sku_of(product)
		if not sku.is_empty():
			_sku_products[sku] = product.id


## SKU of `product` in this store. Empty when the store does not sell it.
static func _sku_of(product: GameData.IapProductRow) -> String:
	if _store == CoreContract.IapStore.IAP_STORE_APPLE:
		return product.sku_apple
	if _store == CoreContract.IapStore.IAP_STORE_GOOGLE:
		return product.sku_google
	return ""


# --- purchase ---


static func purchase(product_id: int) -> PurchaseResult:
	if not _check("purchase"):
		return PurchaseResult.REJECTED
	if _adapter == null:
		LogCore.log_error(_TAG, "purchase: no store adapter")
		return PurchaseResult.REJECTED
	if not AuthCore.is_logged_in():
		LogCore.log_error(_TAG, "purchase: not logged in")
		return PurchaseResult.REJECTED
	if not _has_product("purchase", product_id):
		return PurchaseResult.REJECTED
	var product: GameData.IapProductRow = GameData.IapProductTable.get_row(product_id)
	var sku: String = _sku_of(product)
	if sku.is_empty():
		LogCore.log_error(_TAG, "purchase: product %d has no SKU in this store" % product_id)
		return PurchaseResult.REJECTED
	if _purchasing:
		LogCore.log_warn(_TAG, "purchase: another purchase is running")
		return PurchaseResult.REJECTED
	var life: RefCounted = _life
	_purchasing = true
	var result: PurchaseResult = await _run_purchase(product, sku)
	if life != _life:
		return PurchaseResult.REJECTED
	_purchasing = false
	_buying_sku = ""
	_purchase_key = ""
	if result == PurchaseResult.DELIVERY_PENDING:
		_retry_times.append(TimeCore.get_real_time() + _delivery_retry_delay_ms)
		_update_due()
	return result


## Steps 2 to 7 of `purchase`.
static func _run_purchase(product: GameData.IapProductRow, sku: String) -> PurchaseResult:
	var life: RefCounted = _life
	var epoch: int = _login_epoch
	if _needs_guest_warning():
		var choice: _GUEST_CHOICE.Choice = await _guest_warning()
		if life != _life:
			return PurchaseResult.REJECTED
		match choice:
			_GUEST_CHOICE.Choice.LINK:
				return PurchaseResult.LINK_REQUESTED
			_GUEST_CHOICE.Choice.CANCEL, _GUEST_CHOICE.Choice.HIDDEN:
				return PurchaseResult.CANCELLED
			_GUEST_CHOICE.Choice.NONE:
				return PurchaseResult.REJECTED
	if not _is_ready:
		var prepared: bool = await _prepare()
		if life != _life:
			return PurchaseResult.REJECTED
		if not prepared:
			return PurchaseResult.STORE_FAILED
	var check: CoreContract.CheckPurchaseRequest = CoreContract.CheckPurchaseRequest.new()
	check.store = _store
	check.product_id = product.id
	var checked: _REQUEST = _REQUEST.new()
	checked.handled_codes = PackedInt32Array([
		CoreContract.CoreError.CORE_ERROR_AGE_CONFIRMATION_REQUIRED,
		CoreContract.CoreError.CORE_ERROR_IAP_SPEND_LIMIT_REACHED,
	])
	await _await_send(check, checked, true)
	if life != _life or epoch != _login_epoch:
		return PurchaseResult.REJECTED
	var check_response: CoreContract.CheckPurchaseResponse = checked.response as CoreContract.CheckPurchaseResponse
	if not checked.ok or check_response == null:
		match checked.error_code:
			CoreContract.CoreError.CORE_ERROR_AGE_CONFIRMATION_REQUIRED:
				return PurchaseResult.AGE_CONFIRMATION_REQUIRED
			CoreContract.CoreError.CORE_ERROR_IAP_SPEND_LIMIT_REACHED:
				return PurchaseResult.SPEND_LIMIT_REACHED
		return PurchaseResult.REJECTED
	var adapter: StoreAdapter = _adapter
	var token: String = check_response.account_token
	var product_type: GameData.IapProductType = product.type
	_buying_sku = sku
	var bought_call: _WAIT = await _await_job(
		func() -> StoreAdapter.BuyResult: return await adapter.buy(sku, product_type, token), -1
	)
	if life != _life:
		return PurchaseResult.REJECTED
	_buying_sku = ""
	var bought: StoreAdapter.BuyResult = bought_call.value as StoreAdapter.BuyResult
	var status: StoreAdapter.BuyStatus = bought.status if bought != null else StoreAdapter.BuyStatus.FAILED
	if status == StoreAdapter.BuyStatus.CANCELLED:
		return PurchaseResult.CANCELLED
	if status == StoreAdapter.BuyStatus.PENDING:
		return PurchaseResult.PENDING
	if status != StoreAdapter.BuyStatus.SUCCESS or bought.receipt == null:
		LogCore.log_error(_TAG, "purchase: buy failed for product %d (SKU %s)" % [product.id, sku])
		return PurchaseResult.STORE_FAILED
	var receipt: StoreAdapter.Receipt = bought.receipt
	_purchase_key = _key_of(receipt)
	if epoch != _login_epoch:
		return PurchaseResult.REJECTED
	var verify: CoreContract.VerifyPurchaseRequest = CoreContract.VerifyPurchaseRequest.new()
	verify.store = _store
	verify.receipt = receipt.data
	var verified: _REQUEST = _REQUEST.new()
	verified.handled_codes = PackedInt32Array([CoreContract.CoreError.CORE_ERROR_IAP_VERIFY_UNAVAILABLE])
	await _await_send(verify, verified, true)
	if life != _life or epoch != _login_epoch:
		return PurchaseResult.REJECTED
	match _verify_of(verified):
		_OUTCOME.Verify.GRANTED, _OUTCOME.Verify.ALREADY_GRANTED:
			await _finish_transaction(receipt, product_type, epoch)
			return PurchaseResult.SUCCESS if life == _life and epoch == _login_epoch else PurchaseResult.REJECTED
		_OUTCOME.Verify.INVALID:
			LogCore.log_error(_TAG, "purchase: verify result Invalid for %s" % _describe(receipt))
			await _finish_transaction(receipt, product_type, epoch)
			return PurchaseResult.VERIFY_FAILED if life == _life and epoch == _login_epoch else PurchaseResult.REJECTED
		_OUTCOME.Verify.OTHER_USER:
			LogCore.log_warn(_TAG, "purchase: verify result OtherUser for %s" % _describe(receipt))
			return PurchaseResult.OTHER_ACCOUNT
		_OUTCOME.Verify.PENDING:
			return PurchaseResult.PENDING
	return PurchaseResult.DELIVERY_PENDING


## Whether `purchase` opens the guest warning: no linked provider and a social provider that can be used.
static func _needs_guest_warning() -> bool:
	var linked: PackedInt32Array = PackedInt32Array()
	linked.resize(_PROVIDER_BUFFER_SIZE)
	if AuthCore.list_linked_providers(linked) > 0:
		return false
	for provider: int in CoreContract.LoginProvider.values():
		if provider == CoreContract.LoginProvider.LOGIN_PROVIDER_UNSPECIFIED:
			continue
		if provider == CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST:
			continue
		if AuthCore.is_provider_supported(provider as CoreContract.LoginProvider):
			return true
	return false


## Opens the guest warning popup and waits for its answer. `NONE` when it did not open or `release` cut it short.
static func _guest_warning() -> _GUEST_CHOICE.Choice:
	var life: RefCounted = _life
	var choice: _GUEST_CHOICE = _GUEST_CHOICE.new()
	_choices.append(choice)
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.payment_guest_warning()
	param.buttons.append(_button(ReservedString.payment_guest_link(), choice.on_link))
	param.buttons.append(_button(ReservedString.payment_guest_continue(), choice.on_continue))
	param.buttons.append(_button(ReservedString.payment_guest_cancel(), choice.on_cancel))
	param.back_button = _GUEST_CANCEL_INDEX
	var opened: bool = await UICore.open_system_popup(param, choice.on_hidden)
	if life != _life:
		return _GUEST_CHOICE.Choice.NONE
	if not opened and not choice.finished and not choice.hidden_called:
		_choices.erase(choice)
		LogCore.log_error(_TAG, "purchase: the guest warning popup did not open")
		return _GUEST_CHOICE.Choice.NONE
	if not choice.finished:
		await choice.done
	if life != _life:
		return _GUEST_CHOICE.Choice.NONE
	_choices.erase(choice)
	return choice.choice


static func _button(label: String, callback: Callable) -> SystemPopupButton:
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = label
	button.callback = callback
	return button


# --- recovery ---


static func recover_purchases() -> RecoverPurchasesResult:
	if not _check("recover_purchases") or _adapter == null:
		return RecoverPurchasesResult.new()
	_recover_called = true
	if _recover_wait != null:
		var shared: _WAIT = _recover_wait
		if not shared.finished:
			await shared.done
		return _recover_result(shared)
	var life: RefCounted = _life
	var epoch: int = _login_epoch
	var wait: _WAIT = _WAIT.new()
	_recover_wait = wait
	var summary: RecoverySummary = RecoverySummary.new()
	var ok: bool = await _run_recovery(summary, epoch)
	if life != _life:
		wait.finish(false)
		return RecoverPurchasesResult.new()
	_recover_wait = null
	var same_session: bool = epoch == _login_epoch
	if same_session:
		wait.finish(ok, summary)
	else:
		wait.finish(false)
	if same_session and _store == CoreContract.IapStore.IAP_STORE_GOOGLE and not _google_restored:
		_google_restored = true
		_restore()
	return _recover_result(wait)


static func restore_purchases() -> RestorePurchasesResult:
	var result: RestorePurchasesResult = RestorePurchasesResult.new()
	if not _check("restore_purchases"):
		return result
	if _adapter == null:
		LogCore.log_error(_TAG, "restore_purchases: no store adapter")
		return result
	var life: RefCounted = _life
	var wait: _WAIT = await _restore()
	if life != _life or not wait.ok:
		return result
	result.ok = true
	var summary: RecoverySummary = wait.value as RecoverySummary
	if summary != null:
		result.summary = summary
	return result


static func _recover_result(wait: _WAIT) -> RecoverPurchasesResult:
	var result: RecoverPurchasesResult = RecoverPurchasesResult.new()
	if not wait.ok:
		return result
	result.ok = true
	var summary: RecoverySummary = wait.value as RecoverySummary
	if summary != null:
		result.summary = summary
	return result


## Recovery: `prepare` when not ready, then the transaction processing of every unfinished transaction and the
## subscription sync. Whether `prepare` and `list_unfinished` succeeded.
static func _run_recovery(summary: RecoverySummary, epoch: int) -> bool:
	var life: RefCounted = _life
	if not await _prepare() or life != _life:
		return false
	var adapter: StoreAdapter = _adapter
	var listed: _WAIT = await _await_job(
		func() -> StoreAdapter.ReceiptList: return await adapter.list_unfinished(), _store_call_timeout_ms
	)
	if life != _life:
		return false
	var list: StoreAdapter.ReceiptList = listed.value as StoreAdapter.ReceiptList
	if not listed.ok or list == null or not list.ok:
		LogCore.log_error(_TAG, "recover_purchases: list_unfinished failed")
		return false
	return await _process_all(list.receipts, summary, epoch)


## `restore_purchases` without the checks. A running one gives its wait to every caller.
static func _restore() -> _WAIT:
	if _restore_wait != null:
		var shared: _WAIT = _restore_wait
		if not shared.finished:
			await shared.done
		return shared
	var life: RefCounted = _life
	var epoch: int = _login_epoch
	var wait: _WAIT = _WAIT.new()
	_restore_wait = wait
	var summary: RecoverySummary = RecoverySummary.new()
	var ok: bool = await _run_restore(summary, epoch)
	if life != _life:
		wait.finish(false)
		return wait
	_restore_wait = null
	if epoch == _login_epoch:
		wait.finish(ok, summary)
	else:
		wait.finish(false)
	return wait


static func _run_restore(summary: RecoverySummary, epoch: int) -> bool:
	var life: RefCounted = _life
	if not await _prepare() or life != _life:
		return false
	var adapter: StoreAdapter = _adapter
	var listed: _WAIT = await _await_job(
		func() -> StoreAdapter.ReceiptList: return await adapter.list_owned(), _store_call_timeout_ms
	)
	if life != _life:
		return false
	var list: StoreAdapter.ReceiptList = listed.value as StoreAdapter.ReceiptList
	if not listed.ok or list == null or not list.ok:
		LogCore.log_error(_TAG, "restore_purchases: list_owned failed")
		return false
	return await _process_all(list.receipts, summary, epoch)


## Transaction processing of `receipts` one by one, then the subscription sync. `false` when the processing was
## discarded.
static func _process_all(receipts: Array[StoreAdapter.Receipt], summary: RecoverySummary, epoch: int) -> bool:
	var life: RefCounted = _life
	for receipt: StoreAdapter.Receipt in receipts:
		var processed: _OUTCOME.Processed = await _process_transaction(receipt, summary, epoch)
		if life != _life or processed == _OUTCOME.Processed.DISCARDED:
			return false
	if UserStateCore.count(CoreContract.SubscriptionUserState) > 0:
		var synced: _REQUEST = _REQUEST.new()
		synced.handles_all = true
		await _await_send(CoreContract.SyncSubscriptionsRequest.new(), synced, false)
	return life == _life and epoch == _login_epoch


## Transaction processing: `RecoverPurchase`, the event and `finish` by the recovery table.
static func _process_transaction(receipt: StoreAdapter.Receipt, summary: RecoverySummary, epoch: int) -> _OUTCOME.Processed:
	if receipt == null:
		return _OUTCOME.Processed.SKIPPED
	if epoch != _login_epoch:
		return _OUTCOME.Processed.DISCARDED
	if not _sku_products.has(receipt.sku):
		LogCore.log_error(_TAG, "recovery: SKU %s of transaction %s is not in the SKU table" % [receipt.sku, receipt.transaction_id])
		return _OUTCOME.Processed.SKIPPED
	var key: String = _key_of(receipt)
	if _is_in_flight(receipt, key) or _finished.has(key):
		return _OUTCOME.Processed.SKIPPED
	var life: RefCounted = _life
	var product: GameData.IapProductRow = GameData.IapProductTable.get_row(_sku_products[receipt.sku])
	_in_flight[key] = true
	var request: CoreContract.RecoverPurchaseRequest = CoreContract.RecoverPurchaseRequest.new()
	request.store = _store
	request.receipt = receipt.data
	var recovered: _REQUEST = _REQUEST.new()
	# Every failure is a warn with no screen: the transaction is `Failed` and the next recovery processes it again.
	recovered.handles_all = true
	await _await_send(request, recovered, true)
	if life != _life:
		return _OUTCOME.Processed.DISCARDED
	if epoch != _login_epoch:
		_in_flight.erase(key)
		return _OUTCOME.Processed.DISCARDED
	var verify: _OUTCOME.Verify = _verify_of(recovered)
	_count(summary, verify)
	match verify:
		_OUTCOME.Verify.GRANTED:
			var event: PurchaseRecoveredEvent = EventCore.acquire(PurchaseRecoveredEvent) as PurchaseRecoveredEvent
			event.product_id = _granted_product(recovered, product.id)
			EventCore.publish(event)
			if life == _life:
				await _finish_transaction(receipt, product.type, epoch)
		_OUTCOME.Verify.ALREADY_GRANTED:
			await _finish_transaction(receipt, product.type, epoch)
		_OUTCOME.Verify.INVALID:
			LogCore.log_error(_TAG, "recovery: verify result Invalid for %s" % _describe(receipt))
			await _finish_transaction(receipt, product.type, epoch)
	if life != _life:
		return _OUTCOME.Processed.DISCARDED
	_in_flight.erase(key)
	return _OUTCOME.Processed.COUNTED if epoch == _login_epoch else _OUTCOME.Processed.DISCARDED


static func _is_in_flight(receipt: StoreAdapter.Receipt, key: String) -> bool:
	if _in_flight.has(key) or key == _purchase_key:
		return true
	return not _buying_sku.is_empty() and receipt.sku == _buying_sku


## `finish` of a verified transaction. Adds it to the `finish` success list when it succeeded in the same login
## session.
static func _finish_transaction(receipt: StoreAdapter.Receipt, product_type: GameData.IapProductType, epoch: int) -> void:
	var life: RefCounted = _life
	var adapter: StoreAdapter = _adapter
	var finished: _WAIT = await _await_job(
		func() -> bool: return await adapter.finish(receipt, product_type), _store_call_timeout_ms
	)
	if life != _life or epoch != _login_epoch:
		return
	if finished.ok:
		_finished[_key_of(receipt)] = true
	else:
		LogCore.log_error(_TAG, "finish failed for %s" % _describe(receipt))


static func _verify_of(sent: _REQUEST) -> _OUTCOME.Verify:
	if not sent.ok:
		return _OUTCOME.Verify.FAILED
	var status: CoreContract.PurchaseStatus = CoreContract.PurchaseStatus.PURCHASE_STATUS_UNSPECIFIED
	if sent.response is CoreContract.VerifyPurchaseResponse:
		status = (sent.response as CoreContract.VerifyPurchaseResponse).status
	elif sent.response is CoreContract.RecoverPurchaseResponse:
		status = (sent.response as CoreContract.RecoverPurchaseResponse).status
	match status:
		CoreContract.PurchaseStatus.PURCHASE_STATUS_GRANTED:
			return _OUTCOME.Verify.GRANTED
		CoreContract.PurchaseStatus.PURCHASE_STATUS_ALREADY_GRANTED:
			return _OUTCOME.Verify.ALREADY_GRANTED
		CoreContract.PurchaseStatus.PURCHASE_STATUS_INVALID:
			return _OUTCOME.Verify.INVALID
		CoreContract.PurchaseStatus.PURCHASE_STATUS_OTHER_USER:
			return _OUTCOME.Verify.OTHER_USER
		CoreContract.PurchaseStatus.PURCHASE_STATUS_PENDING:
			return _OUTCOME.Verify.PENDING
	LogCore.log_error(_TAG, "verification response has no purchase status")
	return _OUTCOME.Verify.FAILED


static func _granted_product(sent: _REQUEST, fallback: int) -> int:
	var response: CoreContract.RecoverPurchaseResponse = sent.response as CoreContract.RecoverPurchaseResponse
	if response != null and response.product_id > 0:
		return response.product_id
	return fallback


static func _count(summary: RecoverySummary, verify: _OUTCOME.Verify) -> void:
	match verify:
		_OUTCOME.Verify.GRANTED:
			summary.granted += 1
		_OUTCOME.Verify.ALREADY_GRANTED:
			summary.already_granted += 1
		_OUTCOME.Verify.INVALID:
			summary.invalid += 1
		_OUTCOME.Verify.OTHER_USER:
			summary.other_user += 1
		_OUTCOME.Verify.PENDING:
			summary.pending += 1
		_OUTCOME.Verify.FAILED:
			summary.failed += 1


## Same transaction key for the same (store, transaction ID).
static func _key_of(receipt: StoreAdapter.Receipt) -> String:
	return "%d:%s" % [receipt.store, receipt.transaction_id]


## A transaction in a log: store, SKU and transaction ID. Never the receipt data.
static func _describe(receipt: StoreAdapter.Receipt) -> String:
	var store: String = "APPLE" if receipt.store == CoreContract.IapStore.IAP_STORE_APPLE else "GOOGLE"
	return "store %s SKU %s transaction %s" % [store, receipt.sku, receipt.transaction_id]


static func _on_foreground_returned() -> void:
	if _is_initialized and _adapter != null and _recover_called:
		recover_purchases()


static func _on_login_session_changed() -> void:
	if not _is_initialized:
		return
	_login_epoch += 1
	_finished = {}
	_google_restored = false


# --- subscription, pass and ownership ---


static func is_subscribed(product_id: int) -> bool:
	if not _check("is_subscribed") or not _has_subscription("is_subscribed", product_id):
		return false
	return _is_entitled(product_id)


static func get_subscription_ends_at(product_id: int) -> int:
	if not _check("get_subscription_ends_at") or not _has_subscription("get_subscription_ends_at", product_id):
		return 0
	var state: CoreContract.SubscriptionUserState = (
		UserStateCore.get_by_id(CoreContract.SubscriptionUserState, product_id) as CoreContract.SubscriptionUserState
	)
	return state.ends_at if state != null else 0


static func get_pass_days_left(product_id: int) -> int:
	if not _check("get_pass_days_left") or not _has_product("get_pass_days_left", product_id):
		return 0
	return _pass_days_left(GameData.IapProductTable.get_row(product_id))


static func is_owned(product_id: int) -> bool:
	if not _check("is_owned") or not _has_product("is_owned", product_id):
		return false
	var product: GameData.IapProductRow = GameData.IapProductTable.get_row(product_id)
	match product.type:
		GameData.IapProductType.NON_CONSUMABLE:
			return UserStateCore.get_iap_purchase_count(product_id) >= 1
		GameData.IapProductType.SUBSCRIPTION:
			return _is_entitled(product_id)
	return _is_pass(product) and _pass_days_left(product) >= 1


static func can_claim_daily(product_id: int) -> bool:
	if not _check("can_claim_daily") or not _has_product("can_claim_daily", product_id):
		return false
	var product: GameData.IapProductRow = GameData.IapProductTable.get_row(product_id)
	if product.daily_reward.is_empty():
		return false
	var entitled: bool = false
	if product.type == GameData.IapProductType.SUBSCRIPTION:
		entitled = _is_entitled(product_id)
	elif _is_pass(product):
		entitled = _pass_days_left(product) >= 1
	if not entitled or not TimeCore.is_synced():
		return false
	var state: CoreContract.IapPurchaseUserState = (
		UserStateCore.get_by_id(CoreContract.IapPurchaseUserState, product_id) as CoreContract.IapPurchaseUserState
	)
	var claimed_day: int = state.daily_claimed_day if state != null else 0
	return claimed_day != _today()


static func claim_daily(product_id: int) -> bool:
	if not _check("claim_daily") or not _has_product("claim_daily", product_id):
		return false
	var life: RefCounted = _life
	var request: CoreContract.ClaimIapDailyRequest = CoreContract.ClaimIapDailyRequest.new()
	request.product_id = product_id
	var claimed: _REQUEST = await _await_send(request, _REQUEST.new(), false)
	return life == _life and claimed.ok


static func open_subscription_management() -> bool:
	if not _check("open_subscription_management") or _adapter == null:
		return false
	var life: RefCounted = _life
	var adapter: StoreAdapter = _adapter
	var opened: _WAIT = await _await_job(
		func() -> bool: return await adapter.open_subscription_management(), _store_call_timeout_ms
	)
	return life == _life and opened.ok


## Entitlement of `iap`: an `ACTIVE` or `GRACE_PERIOD` row that has not reached `ends_at`.
static func _is_entitled(product_id: int) -> bool:
	var state: CoreContract.SubscriptionUserState = (
		UserStateCore.get_by_id(CoreContract.SubscriptionUserState, product_id) as CoreContract.SubscriptionUserState
	)
	if state == null:
		return false
	if (
		state.state != CoreContract.SubscriptionState.SUBSCRIPTION_STATE_ACTIVE
		and state.state != CoreContract.SubscriptionState.SUBSCRIPTION_STATE_GRACE_PERIOD
	):
		return false
	return TimeCore.is_synced() and TimeCore.is_before_end(state.ends_at)


## A pass: a `Consumable` with `pass_days`.
static func _is_pass(product: GameData.IapProductRow) -> bool:
	return product.type == GameData.IapProductType.CONSUMABLE and product.pass_days > 0


static func _pass_days_left(product: GameData.IapProductRow) -> int:
	if not _is_pass(product) or not TimeCore.is_synced():
		return 0
	var state: CoreContract.IapPurchaseUserState = (
		UserStateCore.get_by_id(CoreContract.IapPurchaseUserState, product.id) as CoreContract.IapPurchaseUserState
	)
	if state == null:
		return 0
	return maxi(state.pass_end_day - _today(), 0)


## Game day number of today.
static func _today() -> int:
	return TimeCore.get_day_number(TimeCore.get_current_day())


static func _has_product(operation: String, product_id: int) -> bool:
	if GameData.IapProductTable.has_row(product_id):
		return true
	LogCore.log_error(_TAG, "%s: product %d is not in iap_product" % [operation, product_id])
	return false


static func _has_subscription(operation: String, product_id: int) -> bool:
	if not _has_product(operation, product_id):
		return false
	if GameData.IapProductTable.get_row(product_id).type == GameData.IapProductType.SUBSCRIPTION:
		return true
	LogCore.log_error(_TAG, "%s: product %d is not a Subscription" % [operation, product_id])
	return false


# --- awaited steps ---


## Runs `job` (a store adapter call or a `NetworkCore.send`) and waits for it. The wait ends with a failure when
## `timeout_ms` (real elapsed time; -1 for none) passes first or `release` cuts it short.
static func _await_job(job: Callable, timeout_ms: int) -> _WAIT:
	var call: _WAIT = _WAIT.new()
	if timeout_ms >= 0:
		call.deadline = TimeCore.get_real_time() + timeout_ms
	_calls.append(call)
	_update_due()
	_drive(call, job)
	if not call.finished:
		await call.done
	_calls.erase(call)
	_update_due()
	return call


# ogw:input_boundary
static func _drive(call: _WAIT, job: Callable) -> void:
	var out: Variant = await job.call()
	if out is bool:
		var flag: bool = out
		call.finish(flag)
	elif out is RefCounted:
		var result: RefCounted = out
		call.finish(true, result)
	else:
		call.finish(false)


## `NetworkCore.send` with the callbacks of `sent`. The body is left out of logs when `sensitive`.
static func _await_send(request: ContractRequest, sent: _REQUEST, sensitive: bool) -> _REQUEST:
	var options: SendOptions = null
	if sensitive:
		options = SendOptions.new()
		options.sensitive = true
	var call: _WAIT = await _await_job(
		func() -> bool: return await NetworkCore.send(request, sent.on_success, sent.on_failure, options), -1
	)
	sent.ok = call.ok
	return sent


static func _update_due() -> void:
	var next: int = -1
	for call: _WAIT in _calls:
		if call.deadline >= 0 and (next < 0 or call.deadline < next):
			next = call.deadline
	for at: int in _retry_times:
		if next < 0 or at < next:
			next = at
	_next_due = next


## Frame code: queues the due work when the earliest time limit or delivery retry time has come.
static func _on_frame() -> void:
	if _next_due < 0 or _due_queued:
		return
	if TimeCore.get_real_time() < _next_due:
		return
	_due_queued = true
	_due_call.call_deferred()


## Ends the store calls past their time limit and runs the delivery retries that are due.
static func _run_due(life: RefCounted) -> void:
	if life != _life:
		return
	_due_queued = false
	var now: int = TimeCore.get_real_time()
	var expired: Array[_WAIT] = []
	for call: _WAIT in _calls:
		if call.deadline >= 0 and now >= call.deadline:
			expired.append(call)
	var kept: PackedInt64Array = PackedInt64Array()
	var retry: bool = false
	for at: int in _retry_times:
		if now >= at:
			retry = true
		else:
			kept.append(at)
	_retry_times = kept
	for call: _WAIT in expired:
		call.finish(false)
	_update_due()
	if retry and life == _life:
		recover_purchases()
