extends RefCounted
## Records the `QualityChangedEvent` payloads a `QualityCore` test receives, and the applied profile values the engine
## and `QualityCore` have when each event comes.

## `level` of each received event, in order.
var levels: PackedInt32Array = PackedInt32Array()
## `Engine.max_fps` when each event came.
var max_fps: PackedInt32Array = PackedInt32Array()
## Root `scaling_3d_scale` when each event came.
var render_scales: PackedFloat32Array = PackedFloat32Array()
## `QualityCore.get_profile().render_scale_permille` when each event came.
var profile_render_scales: PackedInt32Array = PackedInt32Array()
## `QualityCore.get_profile().frame_limit_fps` when each event came.
var profile_frame_limits: PackedInt32Array = PackedInt32Array()


func subscribe() -> bool:
	return EventCore.subscribe(QualityChangedEvent, on_changed)


func on_changed(event: QualityChangedEvent) -> void:
	levels.append(event.level)
	max_fps.append(Engine.max_fps)
	render_scales.append((Engine.get_main_loop() as SceneTree).root.scaling_3d_scale)
	var profile: QualityProfile = QualityCore.get_profile()
	profile_render_scales.append(profile.render_scale_permille)
	profile_frame_limits.append(profile.frame_limit_fps)
