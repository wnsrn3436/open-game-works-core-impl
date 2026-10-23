extends UnitTestCase
## Fill area: the fill color, the fill image placement, `load_fill_image` and a fill image from a bundle.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")

const _LETTERBOX: ResolutionCore.FillMode = ResolutionCore.FillMode.LETTERBOX
const _WINDOW: Vector2i = Vector2i(2560, 1080)
const _BUNDLE_NAME: String = "resolution_fill_bundle"
const _BUNDLE_PATH: String = "bundles/resolution_fill_bundle.pck"
const _BUNDLE_KEYS_SOURCE: String = "bundles/resolution_fill_bundle_keys.json"
const _BUNDLE_RESOURCE: String = "res://resolution_fill_bundle/fill_bundle.tres"


func after_each() -> void:
	super()
	_SUPPORT.stop()


## Starts with the common conditions, the fill image `key` and a Letterbox window with side fill bands.
func _start_with_fill_image(key: String) -> bool:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_fill_image(key)
	if not _SUPPORT.start():
		return false
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, _LETTERBOX, true)
	return true


func _texture_kind() -> int:
	return ResourceCore.BaseKind.TEXTURE_2D


## Waits for the fill image load `load_fill_image` started: the same key's load shares the engine load.
func _wait_fill_image(key: String) -> Resource:
	return await ResourceCore.load(key, _texture_kind(), ResourceCore.get_global_scope())


## The fill image rectangle: the texture size scaled to cover the window area at the smallest size, centered.
func _cover_rect(texture_size: Vector2) -> Rect2:
	var area: Vector2 = Vector2(2560, 1080)
	var cover: float = maxf(area.x / texture_size.x, area.y / texture_size.y)
	var size: Vector2 = texture_size * cover
	return Rect2((area - size) / 2.0, size)


func test_fill_bands_show_the_fill_color() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_fill_color(10, 20, 30)
	assert_true(_SUPPORT.start())
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, _LETTERBOX, true)
	var colors: Array[Color] = _SUPPORT.fill_colors()
	assert_eq(colors.size(), 2)
	for color: Color in colors:
		assert_eq(color, Color8(10, 20, 30))


func test_fill_color_outside_0_to_255_logs_an_error_and_uses_the_nearest_end() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_fill_color(-1, 128, 300)
	assert_true(_SUPPORT.start())
	assert_eq(_SUPPORT.errors(), 1)
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, _WINDOW, _LETTERBOX, true)
	var colors: Array[Color] = _SUPPORT.fill_colors()
	assert_eq(colors.size(), 2)
	for color: Color in colors:
		assert_eq(color, Color8(0, 128, 255))


func test_fill_image_covers_the_window_area_centered_and_each_band_shows_its_part() -> void:
	assert_true(_start_with_fill_image(_SUPPORT.FILL_IMAGE_KEY))
	ResolutionCore.load_fill_image()
	var loaded: Resource = await _wait_fill_image(_SUPPORT.FILL_IMAGE_KEY)
	var texture: Texture2D = loaded as Texture2D
	assert_not_null(texture)
	var images: Array[_SUPPORT.FillImage] = _SUPPORT.fill_images()
	assert_eq(images.size(), 2)
	for image: _SUPPORT.FillImage in images:
		assert_eq(image.texture, texture)
		assert_eq(image.rect, _cover_rect(Vector2(400, 100)))
	assert_has(_SUPPORT.fill_rects(), Rect2(0, 0, 80, 1080))


func test_missing_fill_image_key_logs_a_resource_error_and_shows_the_fallback_in_the_fill_image_place() -> void:
	assert_true(_start_with_fill_image(_SUPPORT.MISSING_KEY))
	ResolutionCore.load_fill_image()
	var fallback: Texture2D = await _wait_fill_image(_SUPPORT.MISSING_KEY) as Texture2D
	assert_gt(_SUPPORT.errors("ResourceCore"), 0)
	assert_not_null(fallback)
	assert_false(ResourceCore.is_loaded(_SUPPORT.MISSING_KEY, _texture_kind()))
	var images: Array[_SUPPORT.FillImage] = _SUPPORT.fill_images()
	assert_eq(images.size(), 2)
	for image: _SUPPORT.FillImage in images:
		assert_eq(image.texture, fallback)
		assert_eq(image.rect, _cover_rect(fallback.get_size()))


func test_fill_image_waits_for_load_fill_image_then_comes_from_an_applied_bundle_and_loads_once() -> void:
	assert_true(_start_with_fill_image(_SUPPORT.FILL_IMAGE_KEY))
	assert_false(ResourceCore.is_loaded(_SUPPORT.FILL_IMAGE_KEY, _texture_kind()))
	for image: _SUPPORT.FillImage in _SUPPORT.fill_images():
		assert_null(image.texture)
	assert_eq(_SUPPORT.fill_colors().size(), 2)
	var bundles: Array[DownloadedBundle] = [_write_bundle()]
	assert_true(ResourceCore.apply_bundles(bundles))
	ResolutionCore.load_fill_image()
	var loaded: Texture2D = await _wait_fill_image(_SUPPORT.FILL_IMAGE_KEY) as Texture2D
	assert_not_null(loaded)
	assert_eq(loaded.get_size(), Vector2(100, 400))
	for image: _SUPPORT.FillImage in _SUPPORT.fill_images():
		assert_eq(image.texture, loaded)
		assert_eq(image.rect, _cover_rect(Vector2(100, 400)))
	ResolutionCore.load_fill_image()
	assert_eq(_SUPPORT.errors(), 1)
	assert_false(ResolutionCore._fill_loading)
	for image: _SUPPORT.FillImage in _SUPPORT.fill_images():
		assert_eq(image.texture, loaded)


func test_empty_fill_image_key_loads_nothing_and_keeps_the_fill_color() -> void:
	assert_true(_start_with_fill_image(""))
	ResolutionCore.load_fill_image()
	assert_false(ResolutionCore._fill_loading)
	for image: _SUPPORT.FillImage in _SUPPORT.fill_images():
		assert_null(image.texture)
	ResolutionCore.load_fill_image()
	assert_eq(_SUPPORT.errors(), 1)


func test_release_during_the_fill_image_load_drops_its_result() -> void:
	assert_true(_start_with_fill_image(_SUPPORT.FILL_IMAGE_KEY))
	ResolutionCore.load_fill_image()
	ResolutionCore.release()
	await _wait_fill_image(_SUPPORT.FILL_IMAGE_KEY)
	assert_null(ResolutionCore._fill_texture)
	assert_false(ResolutionCore._fill_loading)


## Writes a bundle file that holds `fill_bundle.tres` under the fill image key, and returns its `DownloadedBundle`.
func _write_bundle() -> DownloadedBundle:
	var root: String = CoreBuildInfo.storage_root
	var bundle_file: String = root.path_join(_BUNDLE_PATH)
	var keys_file: String = root.path_join(_BUNDLE_KEYS_SOURCE)
	assert_eq(DirAccess.make_dir_recursive_absolute(bundle_file.get_base_dir()), OK)
	var keys: String = "{\"" + _SUPPORT.FILL_IMAGE_KEY + "\": {\"path\": \"" + _BUNDLE_RESOURCE + "\", \"variants\": 1}}"
	var file: FileAccess = FileAccess.open(keys_file, FileAccess.WRITE)
	assert_not_null(file)
	if file != null:
		file.store_string(keys)
		file.close()
	var packer: PCKPacker = PCKPacker.new()
	assert_eq(packer.pck_start(bundle_file), OK)
	assert_eq(packer.add_file("res://bundle_keys/" + _BUNDLE_NAME + ".json", keys_file), OK)
	assert_eq(packer.add_file(_BUNDLE_RESOURCE, _SUPPORT.RESOURCES + "fill_bundle.tres"), OK)
	assert_eq(packer.flush(), OK)
	var bundle: DownloadedBundle = DownloadedBundle.new()
	bundle.name = _BUNDLE_NAME
	bundle.path = _BUNDLE_PATH
	bundle.sha256 = FileAccess.get_sha256(bundle_file)
	return bundle
