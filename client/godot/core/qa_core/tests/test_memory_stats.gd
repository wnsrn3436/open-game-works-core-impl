extends "res://core/qa_core/tests/support/qa_test_case.gd"
## `heap_memory_bytes` and `total_memory_bytes` of `get_stats` in native, headless and browser runs, and
## `frame_step_fps` of `get_state`.

## The platforms whose resident memory the engine-specific rules read.
const RESIDENT_PLATFORMS: PackedStringArray = ["android", "linux"]
const FRAME_STEP_FPS: int = 60


func test_memory_stats_are_integers_of_0_or_more() -> void:
	assert_true(await start())
	var stats: String = await run_ok("get_stats")
	for field: String in ["heap_memory_bytes", "total_memory_bytes"]:
		var value: float = JSONR.number(stats, field)
		assert_eq(value, floorf(value), field + " is an integer")
		assert_true(value >= 0.0, field + " is 0 or more")
	assert_eq(errors() + warns(), 0)


func test_a_native_run_gives_the_static_memory_as_the_heap_and_the_resident_memory_as_the_total() -> void:
	if CoreBuildInfo.platform == "web":
		pass_test("a browser run")
		return
	assert_true(await start())
	var stats: String = await run_ok("get_stats")
	assert_eq(JSONR.integer(stats, "heap_memory_bytes"), JSONR.integer(stats, "static_memory_bytes"),
		"one reading of MEMORY_STATIC for both")
	var total: int = JSONR.integer(stats, "total_memory_bytes")
	if CoreBuildInfo.os_platform() in RESIDENT_PLATFORMS:
		assert_gt(total, 0, "the resident memory of the process")
	else:
		assert_eq(total, 0, "a platform without a reading")


func test_a_browser_run_gives_the_webassembly_memory_and_the_page_heap() -> void:
	UnitTestCore.require_platform(PackedStringArray(["web"]))
	if CoreBuildInfo.platform != "web":
		return
	assert_true(await start())
	var first: String = await run_ok("get_stats")
	var heap: int = JSONR.integer(first, "heap_memory_bytes")
	assert_gt(heap, 0, "the WebAssembly memory of the page")
	assert_true(JSONR.integer(first, "total_memory_bytes") >= heap, "the total holds the heap")
	# Allocate in the engine heap; the WebAssembly memory grows and does not shrink.
	var block: PackedByteArray = PackedByteArray()
	block.resize(heap)
	await UnitTestCore.wait_frames(1)
	var second: String = await run_ok("get_stats")
	block.clear()
	var heap_after: int = JSONR.integer(second, "heap_memory_bytes")
	assert_true(heap_after >= heap, "not smaller than the get_stats before it")
	assert_gt(heap_after, heap, "the memory grew with the allocation")
	assert_true(JSONR.integer(second, "total_memory_bytes") >= heap_after)
	assert_eq(errors() + warns(), 0)


func test_frame_step_fps_with_a_test_clock() -> void:
	TimeCoreDev.set_frame_step(FRAME_STEP_FPS)
	assert_true(await start())
	assert_eq(JSONR.integer(await state(), "frame_step_fps"), FRAME_STEP_FPS)


func test_frame_step_fps_without_a_test_clock() -> void:
	TimeCoreDev.set_test_clock(null)
	TimeCoreDev.set_frame_step(FRAME_STEP_FPS)
	assert_true(await start())
	assert_eq(JSONR.integer(await state(), "frame_step_fps"), FRAME_STEP_FPS)


func test_frame_step_fps_is_0_without_a_frame_step() -> void:
	assert_true(await start())
	assert_eq(JSONR.integer(await state(), "frame_step_fps"), 0)
	assert_eq(errors() + warns(), 0)
