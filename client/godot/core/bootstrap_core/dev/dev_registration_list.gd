class_name DevRegistrationList
extends RefCounted
## Base of the DEV registration list. The generated list overrides `register_all()` to register the DEV code of every
## content feature. The DEV entry calls it after `DataCore.build_derived_containers` in every boot whose `QACore` is
## initialized.


## Registers the DEV code of every content feature.
func register_all() -> void:
	pass
