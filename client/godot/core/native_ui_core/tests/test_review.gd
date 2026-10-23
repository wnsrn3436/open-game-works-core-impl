extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Store review request: no adapter, the interval and the boot throttle, and an adapter failure.


func test_no_adapter_gives_unsupported_without_logs() -> void:
	assert_true(await start_modules(null))
	assert_eq(NativeUiCore.request_review(), REVIEW_UNSUPPORTED)
	assert_eq(await NativeUiCore.share(content("hi")), SHARE_UNSUPPORTED)
	assert_eq(await NativeUiCore.share(content("", 4)), SHARE_UNSUPPORTED)
	assert_false(NativeUiCore.can_share())
	assert_eq(last_review_at(), NO_TIME)
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


func test_adapter_without_review_gives_unsupported() -> void:
	assert_true(await start_modules(NativeUiAdapter.new()))
	assert_eq(NativeUiCore.request_review(), REVIEW_UNSUPPORTED)
	assert_false(NativeUiCore.can_share())
	assert_eq(errors(), 0)


func test_first_request_is_requested_and_later_ones_are_throttled_until_the_interval() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	var start: int = TimeCore.get_device_time()
	assert_eq(NativeUiCore.request_review(), REQUESTED)
	assert_eq(last_review_at(), start)
	assert_eq(NativeUiCore.request_review(), THROTTLED, "the same boot")
	assert_eq(record().review_count, 1)
	UnitTestCore.set_device_time(start + REVIEW_INTERVAL_MS - 1)
	assert_true(reboot(FakeNativeUiAdapter.new()))
	assert_eq(NativeUiCore.request_review(), THROTTLED, "a new boot before the interval")
	assert_eq(record().review_count, 0)
	assert_eq(last_review_at(), start)
	UnitTestCore.set_device_time(start + REVIEW_INTERVAL_MS)
	assert_true(reboot(FakeNativeUiAdapter.new()))
	assert_eq(NativeUiCore.request_review(), REQUESTED, "a new boot after the interval")
	assert_eq(record().review_count, 1)
	assert_eq(last_review_at(), start + REVIEW_INTERVAL_MS)
	assert_eq(errors(), 0)


func test_adapter_failure_is_failed_and_stores_nothing() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	NativeUiCoreDev.set_fake_review_result(false)
	assert_eq(NativeUiCore.request_review(), REVIEW_FAILED)
	assert_eq(errors(), 1)
	assert_eq(last_review_at(), NO_TIME)
	NativeUiCoreDev.set_fake_review_result(true)
	assert_eq(NativeUiCore.request_review(), REQUESTED, "the same boot after a failure")
	assert_eq(last_review_at(), TimeCore.get_device_time())
	assert_eq(record().review_count, 2)


func test_second_request_in_the_same_boot_after_the_interval_is_throttled() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	var start: int = TimeCore.get_device_time()
	assert_eq(NativeUiCore.request_review(), REQUESTED)
	UnitTestCore.set_device_time(start + REVIEW_INTERVAL_MS)
	assert_eq(NativeUiCore.request_review(), THROTTLED, "the same boot after the interval")
	assert_eq(record().review_count, 1)
	assert_eq(last_review_at(), start)
	assert_eq(errors(), 0)
