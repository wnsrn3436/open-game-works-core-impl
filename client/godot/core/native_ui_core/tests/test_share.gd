extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## Share: busy, content limits, the fake record and the wait for the foreground.


func test_second_share_while_one_is_in_progress_is_busy() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	NativeUiCoreDev.set_fake_share_result(SHARE_UNSUPPORTED)
	start_share(content("first"))
	assert_eq(share_results.size(), 0, "the first share waits for the adapter")
	assert_eq(await NativeUiCore.share(content("second")), BUSY)
	await UnitTestCore.wait_frames(2)
	assert_eq(share_results.size(), 1)
	assert_eq(share_results[0], SHARE_UNSUPPORTED, "the fake result")
	assert_eq(record().share_count, 1)
	assert_eq(record().text, "first")
	assert_eq(errors(), 0)


func test_share_returns_the_fake_result() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	assert_true(NativeUiCore.can_share())
	assert_eq(await NativeUiCore.share(content("hello")), CLOSED, "default fake result")
	NativeUiCoreDev.set_fake_share_result(SHARE_FAILED)
	assert_eq(await NativeUiCore.share(content("again")), SHARE_FAILED)
	assert_eq(errors(), 1, "the adapter reported a failure")


func test_content_over_the_limits_or_empty_is_failed_without_the_adapter() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	assert_eq(await NativeUiCore.share(content("123456789")), SHARE_FAILED, "text over the limit")
	assert_eq(errors(), 1)
	assert_eq(await NativeUiCore.share(content("ok", IMAGE_MAX_BYTES + 1)), SHARE_FAILED, "image over the limit")
	assert_eq(errors(), 1)
	assert_eq(await NativeUiCore.share(content("")), SHARE_FAILED, "empty text and no image")
	assert_eq(errors(), 1)
	assert_eq(record().share_count, 0, "the adapter was not called")


func test_text_length_counts_code_points() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	var outside_bmp: String = String.chr(0x1F600)
	var text: String = "a".repeat(TEXT_MAX_CHARS - 1) + outside_bmp
	assert_eq(text.length(), TEXT_MAX_CHARS)
	assert_eq(await NativeUiCore.share(content(text)), CLOSED)
	assert_eq(record().share_count, 1)
	assert_eq(record().text, text)
	assert_eq(await NativeUiCore.share(content(text + outside_bmp)), SHARE_FAILED)
	assert_eq(errors(), 1)
	assert_eq(record().share_count, 1)


func test_empty_content_without_adapter_is_failed() -> void:
	assert_true(await start_modules(null))
	assert_eq(await NativeUiCore.share(content("")), SHARE_FAILED)
	assert_eq(errors(), 1)


func test_content_over_the_limits_without_a_share_adapter_is_unsupported_without_logs() -> void:
	assert_true(await start_modules(null))
	assert_eq(await NativeUiCore.share(content("123456789")), SHARE_UNSUPPORTED, "no adapter, text over the limit")
	assert_eq(
		await NativeUiCore.share(content("ok", IMAGE_MAX_BYTES + 1)), SHARE_UNSUPPORTED, "no adapter, image over the limit"
	)
	assert_true(reboot(NativeUiAdapter.new()))
	assert_eq(
		await NativeUiCore.share(content("123456789")), SHARE_UNSUPPORTED, "no share support, text over the limit"
	)
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


func test_fake_record_has_the_shared_text_and_image_size() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	assert_empty_record(record())
	assert_eq(await NativeUiCore.share(content("pic", IMAGE_MAX_BYTES)), CLOSED)
	var after: GetFakeRecordResult = record()
	assert_eq(after.share_count, 1)
	assert_eq(after.text, "pic")
	assert_eq(after.image_bytes, IMAGE_MAX_BYTES)


func test_fake_record_without_the_fake_adapter_is_the_failure_value() -> void:
	assert_true(await start_modules(null))
	assert_empty_record(record())
	assert_eq(errors(), 1)


func test_share_closed_in_the_background_returns_after_the_foreground() -> void:
	assert_true(await start_modules(FakeNativeUiAdapter.new()))
	EventCore.publish(EventCore.acquire(AppBackgroundEnteredEvent))
	start_share(content("bg"))
	await UnitTestCore.wait_frames(2)
	assert_eq(share_results.size(), 0, "the window closed while the app is in the background")
	EventCore.publish(EventCore.acquire(AppForegroundReturnedEvent))
	await UnitTestCore.wait_frames(1)
	assert_eq(share_results.size(), 1)
	assert_eq(share_results[0], CLOSED)


func assert_empty_record(value: GetFakeRecordResult) -> void:
	assert_eq(value.review_count, 0)
	assert_eq(value.share_count, 0)
	assert_eq(value.text, "")
	assert_eq(value.image_bytes, 0)
