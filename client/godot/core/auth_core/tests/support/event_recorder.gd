extends Node
## Records the AuthCore events and `RestartRequestedEvent` of a core test.

var logins: PackedInt64Array = []
var session_ends: PackedInt32Array = []
var consents: Array[ConsentInfo] = []
var restarts: int = 0
## Event names in publish order.
var order: PackedStringArray = []
## `AuthCore.is_logged_in` when `LoginCompletedEvent` came.
var logged_in_at_login: bool = false
## Callback run inside the `LoginCompletedEvent` callback. `Callable()` is none.
var on_login: Callable = Callable()


func start() -> bool:
	return (
		EventCore.subscribe(LoginCompletedEvent, _on_login_completed)
		and EventCore.subscribe(SessionEndedEvent, _on_session_ended)
		and EventCore.subscribe(ConsentChangedEvent, _on_consent_changed)
		and EventCore.subscribe(RestartRequestedEvent, _on_restart_requested)
	)


func _on_login_completed(event: LoginCompletedEvent) -> void:
	logins.append(event.user_id)
	order.append("LoginCompleted")
	logged_in_at_login = AuthCore.is_logged_in()
	if on_login.is_valid():
		on_login.call()


func _on_session_ended(event: SessionEndedEvent) -> void:
	session_ends.append(event.reason)
	order.append("SessionEnded")


func _on_consent_changed(event: ConsentChangedEvent) -> void:
	consents.append(event.consent)
	order.append("ConsentChanged")


func _on_restart_requested(event: RestartRequestedEvent) -> void:
	if event.module == "AuthCore":
		restarts += 1
		order.append("RestartRequested")
