extends "res://core/time_core/tests/support/time_test_case.gd"
## Device time changes move the device time only.


func test_device_time_change_moves_only_the_device_time() -> void:
	init_modules()
	sync_to(SERVER_TIME)
	advance(250)
	var server: int = TimeCore.get_server_time()
	var monotonic: int = TimeCore.get_monotonic_time()
	var game: int = TimeCore.get_game_time()
	var real: int = TimeCore.get_real_time()
	var device: int = TimeCore.get_device_time()
	UnitTestCore.set_device_time(device + 3 * DAY_MS)
	assert_eq(TimeCore.get_device_time(), device + 3 * DAY_MS)
	UnitTestCore.set_device_time(device - DAY_MS)
	assert_eq(TimeCore.get_device_time(), device - DAY_MS)
	assert_eq(TimeCore.get_server_time(), server)
	assert_eq(TimeCore.get_monotonic_time(), monotonic)
	assert_eq(TimeCore.get_game_time(), game)
	assert_eq(TimeCore.get_real_time(), real)


func test_advance_moves_monotonic_device_and_server_time() -> void:
	init_modules()
	sync_to(SERVER_TIME)
	var monotonic: int = TimeCore.get_monotonic_time()
	var device: int = TimeCore.get_device_time()
	advance(700)
	assert_eq(TimeCore.get_monotonic_time(), monotonic + 700)
	assert_eq(TimeCore.get_device_time(), device + 700)
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 700)


func test_read_step_moves_the_test_clock_after_each_monotonic_read() -> void:
	init_modules()
	sync_to(SERVER_TIME)
	var device: int = TimeCore.get_device_time()
	TimeCoreDev.set_test_clock_read_step(5)
	var first: int = TimeCore.get_monotonic_time()
	assert_eq(TimeCore.get_monotonic_time(), first + 5, "the read moved the clock after it read")
	assert_eq(TimeCore.get_server_time(), SERVER_TIME + 10, "a server time read reads the monotonic time once")
	assert_eq(TimeCore.get_monotonic_time(), first + 15)
	assert_eq(TimeCore.get_device_time(), device, "the device time does not move")
	TimeCoreDev.set_test_clock_read_step(-1)
	assert_eq(UnitTestCore.check_logs(ERROR, TAG), 1, "a negative step is ignored")
	assert_eq(TimeCore.get_monotonic_time(), first + 20)
	TimeCoreDev.set_test_clock_read_step(0)
	var still: int = TimeCore.get_monotonic_time()
	assert_eq(TimeCore.get_monotonic_time(), still, "0 stops it")
