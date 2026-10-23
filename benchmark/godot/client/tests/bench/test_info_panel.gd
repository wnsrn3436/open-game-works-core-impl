extends UnitTestCase
## The tick panel: a record tap sends the cached tick count and shows the count of the response delta, and a tap at
## `[tick_count_max]` sends no request.

const _REQUEST_NAME: String = "RecordBenchTick"
const _SERVER_TIME: int = 1710000000000


func after_each() -> void:
	super()
	BootstrapCoreDev.shutdown()


## Inits the modules the panel uses in module list order, loads the game data and translation, prepares the UI and
## opens the tick panel with a session that reaches the fake network.
func open_tick_panel() -> BenchInfoPanel:
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_true(TimeCore.init(), "TimeCore.init")
	assert_true(LocalDataCore.init(), "LocalDataCore.init")
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	assert_true(ResourceCore.init(), "ResourceCore.init")
	assert_true(PoolCore.init(), "PoolCore.init")
	assert_true(DataCore.init(), "DataCore.init")
	assert_true(ResolutionCore.init(), "ResolutionCore.init")
	assert_true(InputBlockCore.init(), "InputBlockCore.init")
	assert_true(InputCore.init(), "InputCore.init")
	assert_true(SoundCore.init(), "SoundCore.init")
	assert_true(LocalizationCore.init(), "LocalizationCore.init")
	assert_true(SafeAreaCore.init(), "SafeAreaCore.init")
	assert_true(TweenCore.init(), "TweenCore.init")
	assert_true(UICore.init(), "UICore.init")
	assert_true(MessageCore.init(), "MessageCore.init")
	assert_true(UserStateCore.init(), "UserStateCore.init")
	assert_true(NetworkCore.init(), "NetworkCore.init")
	assert_true(await DataCore.load(null), "DataCore.load")
	LocalizationCore.resolve_language()
	assert_true(await LocalizationCore.load_translation([]), "LocalizationCore.load_translation")
	assert_true(await UICore.prepare(), "UICore.prepare")
	assert_true(await MessageCore.prepare(), "MessageCore.prepare")
	assert_true(NetworkCore.set_server_info("http://127.0.0.1", "1.0.0", CoreBuildInfo.platform), "set_server_info")
	NetworkCore.set_session_provider(BenchTestSessionProvider.new())
	LogCore.clear_sender()
	assert_true(await UICore.open_panel(ResourceKey.PREFAB__BENCH__INFO_PANEL, null, false), "open the tick panel")
	# the panel containers lay out their buttons on the next frame
	await UnitTestCore.wait_frames(1)
	var panel: BenchInfoPanel = find_tick_panel(UICore.get_layer(UICore.UILayer.PANEL))
	assert_not_null(panel, "the tick panel instance")
	return panel


func find_tick_panel(node: Node) -> BenchInfoPanel:
	if node is BenchInfoPanel:
		return node as BenchInfoPanel
	for child: Node in node.get_children():
		var found: BenchInfoPanel = find_tick_panel(child)
		if found != null:
			return found
	return null


## The response of one recorded tick: the delta sets the tick count to `count`.
func recorded(count: int) -> PackedByteArray:
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = _SERVER_TIME
	env.user_state = CoreContract.UserStateDelta.new()
	var state: GameContract.BenchUserState = GameContract.BenchUserState.new()
	state.tick_count = count
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = "BenchUserState"
	entry.value = state.encode()
	env.user_state.entries.append(entry)
	var response: GameContract.RecordBenchTickResponse = GameContract.RecordBenchTickResponse.new()
	response.tick_count = count
	env.body = response.encode()
	return UnitTestCore.make_response(env)


func tick_text(count: int) -> String:
	var args: FormatArgs = FormatArgs.new()
	args.set_int("count", count)
	return LocalizationCore.format(ReservedString.bench_tick_count(), args)


func test_a_record_tap_sends_the_cached_count_and_shows_the_new_count() -> void:
	var panel: BenchInfoPanel = await open_tick_panel()
	assert_eq(panel.tick_label.text, tick_text(0))
	UnitTestCore.add_result(_REQUEST_NAME, NetworkCore.TransferResult.DONE, 200, recorded(1))
	var changed: UnitTestLatch = UnitTestCore.latch_event(UserStateChangedEvent)
	assert_true(UnitTestCore.tap_anchor("bench_tick_send"), "tap the record button")
	await UnitTestCore.wait_latch(changed)
	var requests: Array[UnitTestRequest] = UnitTestCore.received_requests()
	assert_eq(requests.size(), 1)
	assert_eq(requests[0].name, _REQUEST_NAME)
	var sent: GameContract.RecordBenchTickRequest = GameContract.RecordBenchTickRequest.new()
	assert_true(sent.decode(requests[0].body), "the request body decodes")
	assert_eq(sent.tick_count, 0)
	assert_eq(BenchTicks.current(), 1)
	assert_eq(panel.tick_label.text, tick_text(1))


func test_a_record_tap_at_the_tick_count_limit_sends_no_request() -> void:
	GameDataDev.set_setting_tick_count_max(0)
	await open_tick_panel()
	assert_true(UnitTestCore.tap_anchor("bench_tick_send"), "tap the record button at the limit")
	await UnitTestCore.wait_frames(3)
	assert_eq(UnitTestCore.received_requests().size(), 0)
	# the same button sends once the count is below the limit: the first tap reached it and the check held it back
	GameDataDev.set_setting_tick_count_max(1)
	UnitTestCore.advance_clock(1000, false)
	UnitTestCore.add_result(_REQUEST_NAME, NetworkCore.TransferResult.DONE, 200, recorded(1))
	var changed: UnitTestLatch = UnitTestCore.latch_event(UserStateChangedEvent)
	assert_true(UnitTestCore.tap_anchor("bench_tick_send"), "tap the record button below the limit")
	await UnitTestCore.wait_latch(changed)
	assert_eq(UnitTestCore.received_requests().size(), 1)
