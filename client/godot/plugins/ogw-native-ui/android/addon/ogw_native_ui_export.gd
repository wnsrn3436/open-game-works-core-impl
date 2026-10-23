@tool
extends EditorPlugin
## Editor side of the `ogw-native-ui` Android plugin: adds its library and the libraries it needs to an Android
## Gradle build.


class AndroidExport:
	extends EditorExportPlugin

	func _get_name() -> String:
		return "OgwNativeUi"

	func _supports_platform(platform: EditorExportPlatform) -> bool:
		return platform is EditorExportPlatformAndroid

	func _get_android_libraries(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		return PackedStringArray(["ogw-native-ui/android/ogw-native-ui-release.aar"])

	func _get_android_dependencies(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		return PackedStringArray(["com.google.android.play:review:2.0.2", "androidx.core:core:1.13.1"])


var _export: AndroidExport = null


func _enter_tree() -> void:
	_export = AndroidExport.new()
	add_export_plugin(_export)


func _exit_tree() -> void:
	remove_export_plugin(_export)
	_export = null
