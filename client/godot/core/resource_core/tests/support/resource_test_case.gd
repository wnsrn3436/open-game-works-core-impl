extends UnitTestCase
## Setup and helpers of the `ResourceCore` core tests. Test resources are `.tres` and `.tscn` files under
## `RESOURCES`, put in the resource key list with `ResourceCoreDev.set_test_key_list`.

const RUNNER = preload("res://core/resource_core/tests/support/resource_runner.gd")
const ERROR_CAPTURE = preload("res://core/resource_core/tests/support/resource_error_capture.gd")

const TAG: String = "ResourceCore"
const RESOURCES: String = "res://core/resource_core/tests/resources/"
const KEY_LIST_FILE: String = "res://generated/resource_keys.json"
## Folder under the app storage root for files the tests write.
const TEST_FOLDER: String = "resource_core_test"

const ANIMATION: int = ResourceCore.BaseKind.ANIMATION
const TEXTURE: int = ResourceCore.BaseKind.TEXTURE_2D
const SCENE: int = ResourceCore.BaseKind.PACKED_SCENE
const MATERIAL: int = ResourceCore.BaseKind.MATERIAL
const AUDIO: int = ResourceCore.BaseKind.AUDIO_STREAM

## Resource keys of the test key list.
const ANIM_A: String = "test/anim_a"
const ANIM_B: String = "test/anim_b"
const TEX: String = "test/texture"
const PREFAB: String = "test/scene"
## A scene whose file references the file of `TEX`.
const PREFAB_WITH_TEXTURE: String = "test/scene_with_texture"
const MAT: String = "test/material"
const GRADIENT: String = "test/gradient"
const CURVE: String = "test/curve"
## A looping silent `AudioStreamWAV`.
const SOUND: String = "test/sound"
## In the key list, but its file does not exist.
const MISSING_FILE: String = "test/missing_file"
## In no key list.
const UNKNOWN: String = "test/unknown"


## `ResourceCore` `error` log messages of this test, for the failure message of `assert_errors`.
var _error_capture: ERROR_CAPTURE = null


func before_each() -> void:
	super()
	_error_capture = ERROR_CAPTURE.new()
	OS.add_logger(_error_capture)
	if ResourceCore.is_initialized():
		ResourceCore.release()
	if not LogCore.is_initialized():
		assert_true(LogCore.init(), "LogCore init")


func after_each() -> void:
	OS.remove_logger(_error_capture)
	await super()


func key_paths() -> Dictionary[String, String]:
	var keys: Dictionary[String, String] = {
		ANIM_A: RESOURCES + "test_animation_a.tres",
		ANIM_B: RESOURCES + "test_animation_b.tres",
		TEX: RESOURCES + "test_texture.tres",
		PREFAB: RESOURCES + "test_scene.tscn",
		PREFAB_WITH_TEXTURE: RESOURCES + "test_scene_with_texture.tscn",
		MAT: RESOURCES + "test_material.tres",
		GRADIENT: RESOURCES + "test_gradient.tres",
		CURVE: RESOURCES + "test_curve.tres",
		SOUND: RESOURCES + "test_audio.tres",
		MISSING_FILE: RESOURCES + "test_missing_file.tres",
	}
	return keys


## Inits `ResourceCore` with the test key list.
func start() -> void:
	ResourceCoreDev.set_test_key_list(key_paths())
	assert_true(ResourceCore.init(), "ResourceCore init")


## Inits the modules `apply_bundles` uses, then `ResourceCore`.
func start_with_storage() -> void:
	start_storage_modules()
	start()


## Inits the modules `apply_bundles` uses.
func start_storage_modules() -> void:
	if not EventCore.is_initialized():
		assert_true(EventCore.init(), "EventCore init")
	if not TimeCore.is_initialized():
		assert_true(TimeCore.init(), "TimeCore init")
	if not LocalDataCore.is_initialized():
		assert_true(LocalDataCore.init(), "LocalDataCore init")


## Text of the log files LogCore wrote, with its write buffer written first.
func log_file_text() -> String:
	var text: String = ""
	for path: String in LogCoreDev.list_log_files():
		text += FileAccess.get_file_as_string(CoreBuildInfo.storage_root + path)
	return text


## Async. Waits frames until the leak check has judged every resource that left the cache. An audio stream is judged
## after an audio mix, which the audio thread makes in real time, so the judgement ends the wait, not a frame count.
## `ResourceCore.release`, as at the test time limit, ends it too.
func wait_leak_check() -> void:
	while not ResourceCore._leaks.is_empty():
		await UnitTestCore.wait_frames(1)
	assert_true(ResourceCore.is_initialized(), "the leak check judged every resource")


## Async. Waits until the engine process frame counter is `frame`. On web the first frames of a run emit
## `process_frame` more than once per counter value. `ResourceCore.release`, as at the test time limit, ends it too.
func wait_process_frame(frame: int) -> void:
	while Engine.get_process_frames() < frame and ResourceCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	assert_true(Engine.get_process_frames() >= frame, "process frame %d came" % frame)


## Async. Waits frames until the first resource of the leak check saw an audio mix. The audio thread mixes in real
## time, so the mix ends the wait, not a frame count. `ResourceCore.release`, as at the test time limit, ends it too.
func wait_audio_mix() -> void:
	while not ResourceCore._leaks.is_empty() and ResourceCore._leaks[0].mixed_frame < 0:
		await UnitTestCore.wait_frames(1)
	assert_true(
		not ResourceCore._leaks.is_empty() and ResourceCore._leaks[0].mixed_frame >= 0,
		"an audio mix started after the stream left the cache"
	)


## A playing `AudioStreamPlayer` in the tree with `stream`.
func play_sound(stream: AudioStream) -> AudioStreamPlayer:
	var player: AudioStreamPlayer = AudioStreamPlayer.new()
	player.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
	get_tree().root.add_child(player)
	player.stream = stream
	player.play()
	return player


## Asserts that `expected` `ResourceCore` `error` logs of this test are unchecked, and checks them. On failure the
## message also holds every `ResourceCore` `error` log message of this test.
func assert_errors(expected: int, text: String = "") -> void:
	var count: int = UnitTestCore.check_logs("error", TAG)
	var message: String = text
	if count != expected:
		message += " (ResourceCore error logs of this test: %s)" % " | ".join(_error_capture.messages())
	assert_eq(count, expected, message)


func warns() -> int:
	return UnitTestCore.check_logs("warn", TAG)


func new_scope(scope_name: String) -> Scope:
	return ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, scope_name)


func reference_count(key: String) -> int:
	var loaded: Dictionary[String, int] = ResourceCoreDev.list_loaded_resources()
	if not loaded.has(key):
		return 0
	return loaded[key]


func fallback_of(kind: int) -> Resource:
	return ResourceCore._kinds[kind].fallback


## Async. `ResourceCore.load` of `key` as an animation with `scope`.
func load_animation(key: String, scope: Scope) -> Animation:
	var resource: Resource = await ResourceCore.load(key, ANIMATION, scope)
	return resource as Animation


func start_load(key: String, kind: int, scope: Scope) -> RUNNER:
	var runner: RUNNER = RUNNER.new()
	runner.run_load(key, kind, scope)
	return runner


func start_preload(request: PreloadRequest, scope: Scope) -> RUNNER:
	var runner: RUNNER = RUNNER.new()
	runner.run_preload(request, scope)
	return runner


## Writes `text` to `path` under the app storage root.
func write_storage_file(path: String, text: String) -> void:
	var full: String = CoreBuildInfo.storage_root + path
	assert_eq(DirAccess.make_dir_recursive_absolute(full.get_base_dir()), OK, "make folder of " + path)
	var file: FileAccess = FileAccess.open(full, FileAccess.WRITE)
	assert_not_null(file, "open " + path)
	if file == null:
		return
	file.store_string(text)
	file.close()


## A bundle file `<TEST_FOLDER>/<bundle_name>.pck` holding `files` (engine path in the bundle to source file) and
## the key list `keys_json`, and its `DownloadedBundle`.
func make_bundle(bundle_name: String, files: Dictionary[String, String], keys_json: String) -> DownloadedBundle:
	var keys_path: String = TEST_FOLDER + "/" + bundle_name + "_keys.json"
	write_storage_file(keys_path, keys_json)
	var path: String = TEST_FOLDER + "/" + bundle_name + ".pck"
	var full: String = CoreBuildInfo.storage_root + path
	var packer: PCKPacker = PCKPacker.new()
	assert_eq(packer.pck_start(full), OK, "pck_start " + path)
	assert_eq(
		packer.add_file("res://bundle_keys/" + bundle_name + ".json", CoreBuildInfo.storage_root + keys_path),
		OK,
		"pack the key list of " + bundle_name
	)
	for target: String in files:
		assert_eq(packer.add_file(target, files[target]), OK, "pack " + target)
	assert_eq(packer.flush(), OK, "flush " + path)
	var bundle: DownloadedBundle = DownloadedBundle.new()
	bundle.name = bundle_name
	bundle.path = path
	bundle.sha256 = FileAccess.get_sha256(full)
	return bundle


## Key list JSON mapping each key of `paths` to its engine path.
func key_list_json(paths: Dictionary[String, String]) -> String:
	var parts: PackedStringArray = PackedStringArray()
	for key: String in paths:
		parts.append(JSON.stringify(key) + ": {\"path\": " + JSON.stringify(paths[key]) + ", \"variants\": 1}")
	return "{" + ", ".join(parts) + "}"
