extends RefCounted
## Plugin singletons of the AuthCore core tests whose operations never end: the sign-in plugins
## (`ogw-apple-signin`, `ogw-google-signin`), the tracking plugin (`ogw-tracking`) and the secure storage plugin
## (`ogw-secure-storage`). A test registers one under the singleton name its adapter reads and frees it after
## unregistering it.


## Shared counting of the silent plugins.
class Silent extends Object:
	## Operation IDs, in the order they started.
	var started: PackedInt64Array = PackedInt64Array()
	## `take_result` calls.
	var polls: int = 0
	## Operation IDs `cancel` got, in order.
	var cancelled: PackedInt64Array = PackedInt64Array()

	func _begin() -> int:
		started.append(started.size() + 1)
		return started.size()


## `ogw-apple-signin` and `ogw-google-signin`.
class SignIn extends Silent:
	func start_sign_in(_client_id: String = "") -> int:
		return _begin()

	func take_result(_id: int) -> PackedStringArray:
		polls += 1
		return PackedStringArray()

	func cancel(id: int) -> void:
		cancelled.append(id)


## `ogw-tracking`. The tracking state is `TRACKING_STATUS_NOT_DETERMINED`.
class Tracking extends Silent:
	func get_status() -> int:
		return CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED

	func start_request() -> int:
		return _begin()

	func take_result(_id: int) -> PackedInt32Array:
		polls += 1
		return PackedInt32Array()

	func cancel(id: int) -> void:
		cancelled.append(id)


## `ogw-secure-storage`.
class Storage extends Silent:
	func start_read(_name: String) -> int:
		return _begin()

	func start_write(_name: String, _text: String) -> int:
		return _begin()

	func start_remove(_name: String) -> int:
		return _begin()

	func take_result(_id: int) -> PackedStringArray:
		polls += 1
		return PackedStringArray()

	func cancel(id: int) -> void:
		cancelled.append(id)
