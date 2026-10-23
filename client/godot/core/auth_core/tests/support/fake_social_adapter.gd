extends SocialAdapter
## Social adapter of the core tests: returns the scripted results in order, then `SUCCESS` with `credential`.

var credential: String = "test-credential"
## Platforms it works on. Empty is every platform.
var platforms: PackedStringArray = []
var scripted: Array[SignInStatus] = []
var sign_in_count: int = 0


func is_supported(platform: String) -> bool:
	return platforms.is_empty() or platforms.has(platform)


func sign_in() -> SignInResult:
	sign_in_count += 1
	await (Engine.get_main_loop() as SceneTree).process_frame
	if not scripted.is_empty():
		var status: SignInStatus = scripted.pop_front()
		if status != SignInStatus.SUCCESS:
			return SignInResult.new(status)
	return SignInResult.new(SignInStatus.SUCCESS, credential)
