class_name QualityProfile
extends RefCounted
## Quality profile of a `QualityCore.QualityLevel`. The default values are the `get_profile` failure value.

var render_scale_permille: int = 1000
var shadow: QualityCore.ShadowQuality = QualityCore.ShadowQuality.HIGH
## Repeated effects (particles, debris, damage text) make their count × this ÷ 1000, and 1 when that is 0.
var effect_density_permille: int = 1000
var frame_limit_fps: int = 0
