class_name PluginStoreAdapter
extends StoreAdapter
## Real store adapter over a native plugin singleton: `ogw-iap-apple` (StoreKit 2) for store `APPLE` and
## `ogw-iap-google` (Google Play Billing Library) for store `GOOGLE`.
##
## The plugin runs each operation off the main thread. `start_connect()`, `start_query_prices(skus)`,
## `start_buy(sku, product_type, account_token)`, `start_list_unfinished()`, `start_list_owned()`,
## `start_finish(sku, transaction_id, data, product_type)` and `start_open_subscription_management()` return an
## operation ID (0 when the operation could not start). `take_result(id)` returns an empty array until the operation
## ends, then once `[<status>, ...]`: status `0` is success. `buy` returns `[<status>, <sku>, <transaction ID>, <data>]`
## with status 0 success, 1 cancelled, 2 pending, 3 failed; `query_prices` returns the price texts after the status in
## the SKU order; the two lists return `<sku>, <transaction ID>, <data>` triples after the status. `cancel(id)` tells
## the plugin that the adapter stopped waiting for operation `id`: the plugin drops its result. `take_events()`
## returns the notifications since the last call: `disconnected`, or `purchase` followed by a triple.
##
## The adapter reads the plugin once a frame. The same loop ends a wait at the store call time limit and at `stop`.

const _APPLE_SINGLETON: String = "OgwIapApple"
const _GOOGLE_SINGLETON: String = "OgwIapGoogle"
const _EVENT_DISCONNECTED: String = "disconnected"
const _EVENT_PURCHASE: String = "purchase"

var _store: CoreContract.IapStore = CoreContract.IapStore.IAP_STORE_UNSPECIFIED
var _singleton: String = ""
var _watching: bool = false
## New object every `start` and `stop`: a watch loop or an operation wait that finds another object stops.
var _life: RefCounted = RefCounted.new()


func _init(store: CoreContract.IapStore) -> void:
	_store = store
	_singleton = _APPLE_SINGLETON if store == CoreContract.IapStore.IAP_STORE_APPLE else _GOOGLE_SINGLETON


func get_store() -> CoreContract.IapStore:
	return _store


func start() -> void:
	_watching = true
	_life = RefCounted.new()
	_watch(_life)


func stop() -> void:
	_watching = false
	_life = RefCounted.new()


func connect_store() -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_connect()
	var raw: PackedStringArray = await _result(plugin, id, call_timeout_ms)
	return raw.size() >= 1 and raw[0] == "0"


func query_prices(skus: PackedStringArray) -> PriceResult:
	var result: PriceResult = PriceResult.new()
	var plugin: Object = _plugin()
	if plugin == null:
		return result
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_query_prices(skus)
	var raw: PackedStringArray = await _result(plugin, id, call_timeout_ms)
	if raw.size() != skus.size() + 1 or raw[0] != "0":
		return result
	result.ok = true
	result.prices = raw.slice(1)
	return result


func buy(sku: String, product_type: GameData.IapProductType, account_token: String) -> BuyResult:
	var plugin: Object = _plugin()
	if plugin == null:
		return BuyResult.new()
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_buy(sku, product_type as int, account_token)
	# `buy` waits for the user and has no time limit; `stop` ends it.
	var raw: PackedStringArray = await _result(plugin, id, -1)
	if raw.size() < 1:
		return BuyResult.new()
	match raw[0]:
		"0":
			if raw.size() == 4 and not raw[2].is_empty() and not raw[3].is_empty():
				return BuyResult.new(BuyStatus.SUCCESS, Receipt.new(_store, raw[1], raw[2], raw[3]))
		"1":
			return BuyResult.new(BuyStatus.CANCELLED)
		"2":
			return BuyResult.new(BuyStatus.PENDING)
	return BuyResult.new()


func list_unfinished() -> ReceiptList:
	var plugin: Object = _plugin()
	if plugin == null:
		return ReceiptList.new()
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_list_unfinished()
	return _receipt_list(await _result(plugin, id, call_timeout_ms))


func list_owned() -> ReceiptList:
	var plugin: Object = _plugin()
	if plugin == null:
		return ReceiptList.new()
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_list_owned()
	return _receipt_list(await _result(plugin, id, call_timeout_ms))


func finish(receipt: Receipt, product_type: GameData.IapProductType) -> bool:
	var plugin: Object = _plugin()
	if plugin == null or receipt == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_finish(receipt.sku, receipt.transaction_id, receipt.data, product_type as int)
	var raw: PackedStringArray = await _result(plugin, id, call_timeout_ms)
	return raw.size() >= 1 and raw[0] == "0"


func open_subscription_management() -> bool:
	var plugin: Object = _plugin()
	if plugin == null:
		return false
	@warning_ignore("unsafe_method_access")
	var id: int = plugin.start_open_subscription_management()
	var raw: PackedStringArray = await _result(plugin, id, call_timeout_ms)
	return raw.size() >= 1 and raw[0] == "0"


func _plugin() -> Object:
	if not Engine.has_singleton(_singleton):
		return null
	return Engine.get_singleton(_singleton)


## Waits for the end of plugin operation `id`. Empty when it did not start, ended without a status, did not end within
## `timeout_ms` (`TimeCore` real elapsed time; -1 for no limit), or `stop` came first; the last two tell the plugin
## with `cancel`.
func _result(plugin: Object, id: int, timeout_ms: int) -> PackedStringArray:
	if id <= 0:
		return PackedStringArray()
	var life: RefCounted = _life
	var deadline: int = TimeCore.get_real_time() + timeout_ms if timeout_ms >= 0 else -1
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and life == _life and is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		var raw: PackedStringArray = plugin.take_result(id)
		if raw.size() > 0:
			return raw
		if deadline >= 0 and TimeCore.get_real_time() >= deadline:
			break
		await tree.process_frame
	if is_instance_valid(plugin):
		@warning_ignore("unsafe_method_access")
		plugin.cancel(id)
	return PackedStringArray()


func _receipt_list(raw: PackedStringArray) -> ReceiptList:
	var list: ReceiptList = ReceiptList.new()
	if raw.size() < 1 or raw[0] != "0" or (raw.size() - 1) % 3 != 0:
		return list
	var at: int = 1
	while at < raw.size():
		list.receipts.append(Receipt.new(_store, raw[at], raw[at + 1], raw[at + 2]))
		at += 3
	list.ok = true
	return list


## Reads the plugin notifications every frame between `start` and `stop`.
func _watch(life: RefCounted) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null and _watching and life == _life:
		var plugin: Object = _plugin()
		if plugin != null:
			@warning_ignore("unsafe_method_access")
			var events: PackedStringArray = plugin.take_events()
			_tell(events)
		await tree.process_frame


func _tell(events: PackedStringArray) -> void:
	var at: int = 0
	while at < events.size():
		if events[at] == _EVENT_DISCONNECTED:
			_notify_disconnected()
			at += 1
		elif events[at] == _EVENT_PURCHASE and at + 3 < events.size():
			_notify_purchase_updated(Receipt.new(_store, events[at + 1], events[at + 2], events[at + 3]))
			at += 4
		else:
			at += 1
