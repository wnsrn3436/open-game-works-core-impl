extends DevRegistrationList
## Core project stand-in of the DEV registration list a game generates: records each `register_all()` call in the
## `BootstrapCore` core test trace.


func register_all() -> void:
	BootstrapCore._trace_call("DevRegistrationList.register_all")
