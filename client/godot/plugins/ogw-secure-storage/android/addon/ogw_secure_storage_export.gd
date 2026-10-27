@tool
extends EditorPlugin
## Editor side of the `ogw-secure-storage` Android plugin: adds its library to an Android Gradle build.


class AndroidExport:
	extends EditorExportPlugin

	func _get_name() -> String:
		return "OgwSecureStorage"

	func _supports_platform(platform: EditorExportPlatform) -> bool:
		return platform is EditorExportPlatformAndroid

	func _get_android_libraries(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		return PackedStringArray(["ogw-secure-storage/android/ogw-secure-storage-release.aar"])


var _export: AndroidExport = null


func _enter_tree() -> void:
	_export = AndroidExport.new()
	add_export_plugin(_export)


func _exit_tree() -> void:
	remove_export_plugin(_export)
	_export = null
