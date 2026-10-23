extends Node
## Core node of `BootstrapCore`. Made on the first `start_boot` or `shutdown` and kept until the process ends. It
## receives the app exit notification, holds the subscription callbacks and the popup callbacks, and parents the
## fatal screen.


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		BootstrapCore._on_exit_request(false)


func _on_restart_requested(event: RestartRequestedEvent) -> void:
	BootstrapCore._on_restart_request(event.module)


func _on_fatal_requested(event: FatalErrorRequestedEvent) -> void:
	BootstrapCore._fatal(event.module, event.reason)


func _on_exit_confirmed(_event: ExitConfirmedEvent) -> void:
	BootstrapCore._on_exit_request(true)


func _on_failure_popup_hidden(serial: int) -> void:
	BootstrapCore._on_failure_popup_hidden(serial)


func _after_failure_popup_hidden(serial: int) -> void:
	BootstrapCore._after_failure_popup_hidden(serial)


func _on_restart_pressed() -> void:
	BootstrapCore._on_restart_pressed()


func _on_deletion_pressed() -> void:
	BootstrapCore._on_deletion_pressed()
