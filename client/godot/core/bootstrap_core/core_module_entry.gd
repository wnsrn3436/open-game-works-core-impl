class_name CoreModuleEntry
extends RefCounted
## One module of the `BootstrapCore` module list: the module name and references to its lifecycle static funcs.

## Module name. Example: `UICore`.
var name: String = ""
## `<Module>.init`: returns the success flag.
var init: Callable = Callable()
## `<Module>.release`.
var release: Callable = Callable()
## `<Module>.is_initialized`: returns whether the module is initialized.
var is_initialized: Callable = Callable()
