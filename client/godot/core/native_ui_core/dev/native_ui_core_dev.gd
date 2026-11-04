class_name NativeUiCoreDev
extends RefCounted
## DEV operations of `NativeUiCore`.

const _TAG: String = "NativeUiCore"
## The fake adapter, read through this constant and not the global class name (Godot 4.7.2 keeps the generated
## contract and data scripts alive at exit when a file that names a base adapter type reads a derived adapter class's
## members through its global name).
const _FAKE := preload("res://core/native_ui_core/dev/adapters/fake_native_ui_adapter.gd")


## Record of the fake adapter `NativeUiCore` holds. All zero and an empty text when it holds no fake adapter.
static func get_fake_record() -> GetFakeRecordResult:
	var record: GetFakeRecordResult = GetFakeRecordResult.new()
	if not _check_initialized("get_fake_record"):
		return record
	var fake: _FAKE = NativeUiCore._adapter as _FAKE
	if fake == null:
		LogCore.log_error(_TAG, "get_fake_record: the adapter is not the fake adapter")
		return record
	record.review_count = fake.review_count
	record.share_count = fake.share_count
	record.text = fake.last_text
	record.image_bytes = fake.last_image_bytes
	return record


## Result the fake adapter's `share` returns from now on. Default `Closed`.
static func set_fake_share_result(result: NativeUiCore.ShareResult) -> void:
	if not _check_initialized("set_fake_share_result"):
		return
	if result < NativeUiCore.ShareResult.CLOSED or result > NativeUiCore.ShareResult.FAILED:
		LogCore.log_error(_TAG, "set_fake_share_result: %d is no ShareResult" % result)
		return
	NativeUiCore._fake_share_result = result


## Success flag the fake adapter's `request_review` returns from now on. Default `true`.
static func set_fake_review_result(ok: bool) -> void:
	if not _check_initialized("set_fake_review_result"):
		return
	NativeUiCore._fake_review_result = ok


static func _check_initialized(operation: String) -> bool:
	if NativeUiCore._is_initialized:
		return true
	LogCore.log_error(_TAG, "%s called before init" % operation)
	return false
