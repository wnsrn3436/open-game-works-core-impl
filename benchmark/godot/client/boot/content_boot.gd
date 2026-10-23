class_name ContentBoot
extends ContentEntry
## Content entry of the benchmark game. The benchmark registers no core hook: every hook runs its default.


func content_init() -> bool:
	return true


func content_release() -> void:
	pass


func select_first_scene() -> String:
	return BootstrapCore.get_first_scene()
