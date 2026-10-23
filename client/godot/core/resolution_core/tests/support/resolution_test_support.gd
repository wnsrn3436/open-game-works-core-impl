extends RefCounted
## Starts and stops `ResolutionCore` with the modules it depends on, for the core tests of `ResolutionCore`.

const TAG: String = "ResolutionCore"
const RESOURCES: String = "res://core/resolution_core/tests/resources/"
## Test resources by resource key.
const FILL_IMAGE_KEY: String = "background/resolution_fill"
const MISSING_KEY: String = "background/resolution_missing"
const SCREEN_MODE_KEY: String = "ResolutionCore.screen_mode"

## Common test base resolution.
const BASE: Vector2i = Vector2i(1920, 1080)


static func resources() -> Dictionary[String, String]:
	return {FILL_IMAGE_KEY: RESOURCES + "fill_image.tres"}


## Sets the common conditions of the tests: game settings `maxResolution` 2400x1440, fill color 0, 0, 0 and no fill
## image. Call before `start`.
static func set_common_settings() -> void:
	set_size_setting("maxResolution", Vector2i(2400, 1440))
	set_fill_color(0, 0, 0)
	set_fill_image("")


static func set_size_setting(key: String, size: Vector2i) -> void:
	var value: Array[int] = [size.x, size.y]
	UnitTestCore.set_test_settings(key, value)


static func set_fill_color(red: int, green: int, blue: int) -> void:
	var value: Array[int] = [red, green, blue]
	UnitTestCore.set_test_settings("ResolutionCore.fillColor", value)


static func set_fill_image(key: String) -> void:
	UnitTestCore.set_test_settings("ResolutionCore.fillImage", key)


## Inits the modules `ResolutionCore` depends on in dependency order, loads the device file, and inits
## `ResolutionCore`. True when all succeed.
static func start() -> bool:
	if not start_dependencies():
		return false
	return ResolutionCore.init()


static func start_dependencies() -> bool:
	if not LogCore.init() or not EventCore.init() or not TimeCore.init() or not LocalDataCore.init():
		return false
	LocalDataCore.load_device_file()
	ResourceCoreDev.set_test_key_list(resources())
	return ResourceCore.init()


## `set_common_settings`, `start`, and `set_test_screen` of the common base resolution, `window` and `fill_mode`
## with screen mode support.
static func start_screen(window: Vector2i, fill_mode: ResolutionCore.FillMode) -> bool:
	set_common_settings()
	if not start():
		return false
	ResolutionCoreDev.set_test_screen(BASE, window, fill_mode, true)
	return true


## Releases the modules `start` inits, in reverse order.
static func stop() -> void:
	ResolutionCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


static func errors(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("error", tag)


static func warnings(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("warn", tag)


## The rectangles of the shown fill bands, in game coordinates.
static func fill_rects() -> Array[Rect2]:
	var rects: Array[Rect2] = []
	if ResolutionCore._node == null:
		return rects
	for band: Control in ResolutionCore._node._bands:
		if band.visible:
			rects.append(Rect2(band.position, band.size))
	return rects


## The fill colors of the shown fill bands.
static func fill_colors() -> Array[Color]:
	var colors: Array[Color] = []
	if ResolutionCore._node == null:
		return colors
	for i: int in ResolutionCore._node._bands.size():
		if ResolutionCore._node._bands[i].visible:
			colors.append(ResolutionCore._node._colors[i].color)
	return colors


## The fill image of each shown fill band: the texture and its rectangle in game coordinates. A band without a
## shown fill image gives a `null` texture.
static func fill_images() -> Array[FillImage]:
	var images: Array[FillImage] = []
	if ResolutionCore._node == null:
		return images
	for i: int in ResolutionCore._node._bands.size():
		var band: Control = ResolutionCore._node._bands[i]
		if not band.visible:
			continue
		var image: TextureRect = ResolutionCore._node._images[i]
		var item: FillImage = FillImage.new()
		if image.visible:
			item.texture = image.texture
			item.rect = Rect2(band.position + image.position, image.size)
		images.append(item)
	return images


static func saved_screen_mode() -> int:
	return LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, SCREEN_MODE_KEY, -1)


static func save_screen_mode(value: int) -> void:
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, SCREEN_MODE_KEY, value)


## The fill image a fill band shows.
class FillImage:
	extends RefCounted
	var texture: Texture2D = null
	var rect: Rect2 = Rect2()
