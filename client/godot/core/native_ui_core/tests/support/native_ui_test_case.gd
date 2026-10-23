extends UnitTestCase
## Base of the NativeUiCore core tests: module start with an adapter, a new boot, share result recording and log
## counts.

const ERROR: String = "error"
const WARN: String = "warn"
const REVIEW_INTERVAL_MS: int = 86400000
const TEXT_MAX_CHARS: int = 8
const IMAGE_MAX_BYTES: int = 16
const CLOSED: NativeUiCore.ShareResult = NativeUiCore.ShareResult.CLOSED
const BUSY: NativeUiCore.ShareResult = NativeUiCore.ShareResult.BUSY
const SHARE_UNSUPPORTED: NativeUiCore.ShareResult = NativeUiCore.ShareResult.UNSUPPORTED
const SHARE_FAILED: NativeUiCore.ShareResult = NativeUiCore.ShareResult.FAILED
const REQUESTED: NativeUiCore.ReviewResult = NativeUiCore.ReviewResult.REQUESTED
const THROTTLED: NativeUiCore.ReviewResult = NativeUiCore.ReviewResult.THROTTLED
const REVIEW_UNSUPPORTED: NativeUiCore.ReviewResult = NativeUiCore.ReviewResult.UNSUPPORTED
const REVIEW_FAILED: NativeUiCore.ReviewResult = NativeUiCore.ReviewResult.FAILED
## Default of the `last_review_at` read in the tests: no stored value.
const NO_TIME: int = -1

## Results of the shares started by `start_share`, in the order they ended.
var share_results: Array[NativeUiCore.ShareResult] = []


func before_each() -> void:
	super()
	share_results.clear()
	assert_true(UnitTestCore.set_test_settings("NativeUiCore.reviewMinIntervalMs", REVIEW_INTERVAL_MS))
	assert_true(UnitTestCore.set_test_settings("NativeUiCore.shareTextMaxChars", TEXT_MAX_CHARS))
	assert_true(UnitTestCore.set_test_settings("NativeUiCore.shareImageMaxBytes", IMAGE_MAX_BYTES))


## Starts the modules NativeUiCore depends on in dependency order and loads the `device` file, then passes `adapter`
## (none for `null`) and starts NativeUiCore unless `init_native` is false.
func start_modules(adapter: NativeUiAdapter, init_native: bool = true) -> bool:
	ResourceCoreDev.set_test_key_list({})
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and DataCore.init() and InputBlockCore.init() and ResolutionCore.init()
		and InputCore.init() and LocalizationCore.init() and SoundCore.init() and SafeAreaCore.init()
		and TweenCore.init() and UICore.init()
	)
	assert_true(started, "dependencies init")
	if not started:
		return false
	assert_true(LocalDataCore.load_device_file(), "LocalDataCore.load_device_file")
	NativeUiCore.set_native_adapter(adapter)
	if not init_native:
		return true
	var initialized: bool = NativeUiCore.init()
	assert_true(initialized, "NativeUiCore.init")
	return initialized


## A new boot of NativeUiCore with `adapter`: release, the adapter, `init`. The `device` file stays loaded.
func reboot(adapter: NativeUiAdapter) -> bool:
	NativeUiCore.release()
	NativeUiCore.set_native_adapter(adapter)
	var initialized: bool = NativeUiCore.init()
	assert_true(initialized, "NativeUiCore.init again")
	return initialized


## Stored `NativeUiCore.last_review_at`; `NO_TIME` when there is none.
func last_review_at() -> int:
	return LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, "NativeUiCore.last_review_at", NO_TIME)


func content(text: String, image_size: int = 0) -> ShareContent:
	var value: ShareContent = ShareContent.new()
	value.text = text
	var image: PackedByteArray = PackedByteArray()
	image.resize(image_size)
	image.fill(7)
	value.image = image
	return value


## Starts a share of `value` without waiting; its result is appended to `share_results` when it ends.
func start_share(value: ShareContent) -> void:
	var result: NativeUiCore.ShareResult = await NativeUiCore.share(value)
	share_results.append(result)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, NativeUiCore._TAG)


func warns() -> int:
	return UnitTestCore.check_logs(WARN, NativeUiCore._TAG)


func record() -> GetFakeRecordResult:
	return NativeUiCoreDev.get_fake_record()
