extends UnitTestCase
## The quality profile of each level and its application to the engine: frame limit, render scale and the `Light3D`
## shadows of shadow `Off`, and the engine values `release` puts back.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")
const _RECORDER := preload("res://core/quality_core/tests/support/quality_test_recorder.gd")
const _LOW: QualityCore.QualityLevel = QualityCore.QualityLevel.LOW
const _MEDIUM: QualityCore.QualityLevel = QualityCore.QualityLevel.MEDIUM
const _HIGH: QualityCore.QualityLevel = QualityCore.QualityLevel.HIGH

var _lights: Array[Light3D] = []


func after_each() -> void:
	super()
	_SUPPORT.stop()
	for light: Light3D in _lights:
		if is_instance_valid(light):
			light.free()
	_lights.clear()


func test_target_fps_60_and_frame_limit_permille_500_give_frame_limit_fps_30_and_engine_max_fps_30() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_json("QualityCore.levels", _SUPPORT.levels_json(500, 500, 500))
	assert_true(_SUPPORT.start_applied())
	assert_eq(QualityCore.get_profile().frame_limit_fps, 30)
	assert_eq(Engine.max_fps, 30)


func test_frame_limit_fps_is_floored_and_at_least_1() -> void:
	# targetFps, frameLimitPermille, frame_limit_fps
	var cases: Array[PackedInt32Array] = [
		PackedInt32Array([61, 500, 30]),
		PackedInt32Array([60, 999, 59]),
		PackedInt32Array([1, 500, 1]),
		PackedInt32Array([0, 1000, 1]),
		PackedInt32Array([144, 1000, 144]),
	]
	for item: PackedInt32Array in cases:
		var label: String = "targetFps %d, frameLimitPermille %d" % [item[0], item[1]]
		_SUPPORT.set_common_settings()
		UnitTestCore.set_test_settings("targetFps", item[0])
		_SUPPORT.set_json("QualityCore.levels", _SUPPORT.levels_json(item[1], item[1], item[1]))
		assert_true(_SUPPORT.start_applied(), label)
		assert_eq(QualityCore.get_profile().frame_limit_fps, item[2], label)
		assert_eq(Engine.max_fps, item[2], label)
		LocalDataCore.remove_value(_SUPPORT.DEVICE, _SUPPORT.KEY_AUTO)
		_SUPPORT.release_quality()


func test_get_profile_gives_the_settings_values_of_the_current_level() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_json("QualityCore.levels", _SUPPORT.levels_json(500, 750, 1000))
	assert_true(_SUPPORT.start_applied())
	var high: QualityProfile = QualityCore.get_profile()
	assert_eq(high.render_scale_permille, 1000)
	assert_eq(high.shadow, QualityCore.ShadowQuality.HIGH)
	assert_eq(high.effect_density_permille, 1000)
	assert_eq(high.frame_limit_fps, 60)
	QualityCore.set_level(_MEDIUM)
	var medium: QualityProfile = QualityCore.get_profile()
	assert_eq(medium.render_scale_permille, _SUPPORT.MEDIUM_RENDER_SCALE)
	assert_eq(medium.shadow, QualityCore.ShadowQuality.LOW)
	assert_eq(medium.effect_density_permille, 600)
	assert_eq(medium.frame_limit_fps, 45)
	QualityCore.set_level(_LOW)
	var low: QualityProfile = QualityCore.get_profile()
	assert_eq(low.render_scale_permille, _SUPPORT.LOW_RENDER_SCALE)
	assert_eq(low.shadow, QualityCore.ShadowQuality.OFF)
	assert_eq(low.effect_density_permille, 300)
	assert_eq(low.frame_limit_fps, 30)
	low.frame_limit_fps = 5
	assert_eq(QualityCore.get_profile().frame_limit_fps, 30, "get_profile gives a copy")


func test_saved_medium_level_applies_the_medium_frame_limit_without_an_event() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_json("QualityCore.levels", _SUPPORT.levels_json(500, 750, 1000))
	assert_true(_SUPPORT.start())
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Medium")
	QualityCore.apply_saved_level()
	assert_eq(QualityCore.get_level(), _MEDIUM)
	assert_eq(Engine.max_fps, 45)
	assert_almost_eq(_SUPPORT.render_scale(), 0.8, 0.0001)
	assert_eq(recorder.levels.size(), 0)


func test_apply_saved_level_applies_the_level_even_when_it_is_the_current_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	Engine.max_fps = 7
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Medium")
	QualityCore.apply_saved_level()
	assert_eq(Engine.max_fps, _SUPPORT.MEDIUM_FPS)


func test_render_scale_is_the_root_viewport_3d_scale() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	assert_almost_eq(_SUPPORT.render_scale(), 1.0, 0.0001)
	QualityCore.set_level(_MEDIUM)
	assert_almost_eq(_SUPPORT.render_scale(), 0.8, 0.0001)
	QualityCore.set_level(_LOW)
	assert_almost_eq(_SUPPORT.render_scale(), 0.5, 0.0001)


func test_shadow_off_turns_off_the_shadow_of_every_light_and_the_next_level_puts_it_back() -> void:
	var lit: Light3D = _add_light(true)
	var unlit: Light3D = _add_light(false)
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCore.set_level(_LOW)
	assert_false(lit.shadow_enabled)
	assert_false(unlit.shadow_enabled)
	var added: Light3D = _add_light(true)
	assert_false(added.shadow_enabled, "a light added while the shadow is Off")
	QualityCore.set_level(_MEDIUM)
	assert_true(lit.shadow_enabled)
	assert_false(unlit.shadow_enabled)
	assert_true(added.shadow_enabled)
	var later: Light3D = _add_light(true)
	assert_true(later.shadow_enabled, "a light added while the shadow is Low")


func test_light_removed_from_the_tree_while_the_shadow_is_off_gets_its_shadow_back() -> void:
	var lit: Light3D = _add_light(true)
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCore.set_level(_LOW)
	lit.get_parent().remove_child(lit)
	assert_true(lit.shadow_enabled)
	assert_true(QualityCore._light_shadows.is_empty())
	get_tree().root.add_child(lit)
	assert_false(lit.shadow_enabled, "added again while the shadow is Off")


func test_release_puts_the_render_scale_shadow_and_frame_limit_back_to_their_values_before_init() -> void:
	var lit: Light3D = _add_light(true)
	var root: Window = get_tree().root
	root.scaling_3d_scale = 0.9
	Engine.max_fps = 75
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCore.set_level(_LOW)
	var added: Light3D = _add_light(true)
	assert_eq(Engine.max_fps, _SUPPORT.LOW_FPS)
	assert_almost_eq(root.scaling_3d_scale, 0.5, 0.0001)
	assert_false(lit.shadow_enabled)
	QualityCore.release()
	assert_eq(Engine.max_fps, 75)
	assert_almost_eq(root.scaling_3d_scale, 0.9, 0.0001)
	assert_true(lit.shadow_enabled)
	assert_true(added.shadow_enabled)
	var later: Light3D = _add_light(true)
	assert_true(later.shadow_enabled, "no light is turned off after release")
	root.scaling_3d_scale = 1.0
	Engine.max_fps = 0


func test_release_keeps_the_saved_values() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCore.set_level(_MEDIUM)
	QualityCore.release()
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "Medium")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High")


## A `Light3D` with `shadow` in the tree. `after_each` frees it.
func _add_light(shadow: bool) -> Light3D:
	var light: OmniLight3D = OmniLight3D.new()
	light.shadow_enabled = shadow
	get_tree().root.add_child(light)
	_lights.append(light)
	return light
