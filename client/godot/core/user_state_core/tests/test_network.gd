extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## Through `NetworkCore`: `UserStateChangedEvent` comes with the whole response delta applied and before the
## success callback.

const _SESSION_PROVIDER := preload("res://core/user_state_core/tests/support/token_session_provider.gd")
## The resource key of `[ui_button_click]` in the core test data, which `UICore.prepare` loads.
const _CLICK: String = "sfx/ui_button_click"
const _REQUEST_NAME: String = "core/CheckPurchase"

## What happened, in order: `event <kind> <tutorials> <mails>` and `success`.
var order: PackedStringArray = PackedStringArray()


## Inits NetworkCore and the modules it depends on in module list order, loads the device file and data and prepares
## the UI, then sets server info and a session provider.
func start_network() -> void:
	var keys: Dictionary[String, String] = {_CLICK: "res://core/ui_core/tests/resources/test_click.tres"}
	ResourceCoreDev.set_test_key_list(keys)
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
	assert_true(NetworkCore.set_server_info("http://127.0.0.1", "1.2.3", CoreBuildInfo.platform), "set_server_info")
	NetworkCore.set_session_provider(_SESSION_PROVIDER.new())
	LogCore.clear_sender()


func _on_changed(event: UserStateChangedEvent) -> void:
	var kind_name: String = "Mail" if event.kind == CoreContract.MailUserState else "Tutorial"
	order.append("event %s %d %d" % [kind_name, UserStateCore.count(CoreContract.TutorialProgressUserState), UserStateCore.count(CoreContract.MailUserState)])


func _on_success(_response: ContractMessage) -> void:
	order.append("success")


func test_the_event_comes_after_the_whole_delta_and_before_the_success_callback() -> void:
	await start_network()
	order = PackedStringArray()
	assert_true(EventCore.subscribe(UserStateChangedEvent, _on_changed))
	var env: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	env.server_time_at = SERVER_TIME
	env.user_state = new_delta()
	add_tutorial(env.user_state, 7, 3)
	var mail: CoreContract.MailUserState = CoreContract.MailUserState.new()
	mail.id = 3
	add_upsert(env.user_state, "MailUserState", 3, mail)
	UnitTestCore.add_result(_REQUEST_NAME, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(env))
	assert_true(await NetworkCore.send(CoreContract.CheckPurchaseRequest.new(), _on_success))
	assert_eq(order.size(), 3)
	var events: PackedStringArray = order.slice(0, 2)
	events.sort()
	assert_eq(events, PackedStringArray(["event Mail 1 1", "event Tutorial 1 1"]))
	assert_eq(order[2], "success")
