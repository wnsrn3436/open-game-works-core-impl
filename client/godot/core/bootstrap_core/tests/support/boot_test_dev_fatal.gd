extends BootstrapCoreDev
## DEV entry of the BootstrapCore core tests that report a fatal from a DEV call of the boot: the DEV call named
## `fatal_call` does its work and then calls `BootstrapCore.report_fatal`.

var fatal_call: String = ""


func after_init_modules() -> void:
	super()
	_report("after_init_modules")


func after_server_info() -> void:
	super()
	_report("after_server_info")


func after_derived_containers() -> void:
	super()
	_report("after_derived_containers")


func _report(call_name: String) -> void:
	if fatal_call == call_name:
		BootstrapCore.report_fatal("fatal in %s" % call_name)
