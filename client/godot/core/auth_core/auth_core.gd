class_name AuthCore
extends RefCounted
## Terms, age, privacy choice, ad push consent and tracking permission flows; guest, social and auto login, the login
## token storage, the install marker, account recovery, the access token refresh, account link and switch, logout,
## withdrawal, the web guest storage request and link prompt, and the web account deletion code. Hands the login
## session to `NetworkCore` and the analytics consent to `LogCore`.

enum TermsStatus { AGREED, REFUSED, FAILED }
enum LoginStatus { SUCCESS, NO_TOKEN, CANCELLED, REJECTED, CONSENT_REQUIRED, BANNED, AGE_BLOCKED, FAILED }
enum LinkStatus { SUCCESS, CANCELLED, ALREADY_LINKED, FAILED }
enum ConsentResult { DONE, AGE_BLOCKED, FAILED }
enum SessionEndReason { LOGOUT, WITHDRAW, SWITCH, REJECTED, REPLACED, AGE_BLOCKED }

const _TAG: String = "AuthCore"
const _INSTALL_MARKER: String = "auth/installed"
const _AGE_BLOCK_MARKER: String = "auth/age_blocked"
const _KEY_TERMS_VERSION: String = "AuthCore.terms_version"
const _KEY_PRIVACY_TERMS_VERSION: String = "AuthCore.privacy_terms_version"
const _KEY_WEB_GUEST_LOGINS: String = "AuthCore.web_guest_logins"
## Byte the install marker and the age block marker hold: `1`.
const _MARKER_BYTE: int = 0x31

const _NODE := preload("res://core/auth_core/auth_core_node.gd")
const _SESSION := preload("res://core/auth_core/auth_session.gd")
const _PROVIDER := preload("res://core/auth_core/auth_session_provider.gd")
const _WAIT := preload("res://core/auth_core/auth_wait.gd")
const _CALL := preload("res://core/auth_core/auth_request_call.gd")
const _STORAGE_QUEUE := preload("res://core/auth_core/auth_storage_queue.gd")
const _POPUP_WAIT := preload("res://core/auth_core/auth_popup_wait.gd")
const _POPUP_PARAM := preload("res://core/auth_core/auth_popup_param.gd")
const _STORAGE := preload("res://core/auth_core/adapters/token_storage.gd")
const _SECURE_STORAGE := preload("res://core/auth_core/adapters/secure_storage_adapter.gd")
const _WEB_STORAGE := preload("res://core/auth_core/adapters/web_storage_adapter.gd")
const _TRACKING := preload("res://core/auth_core/adapters/tracking_adapter.gd")

enum StorageOp { READ, WRITE, REMOVE }
## What account recovery and the new-start confirm popup got.
enum Choice { FIRST, SECOND, HIDDEN, NOT_OPENED }

static var _is_initialized: bool = false
## New object every `init`. An async operation that finds another object after an `await` stopped by `release`.
static var _life: RefCounted = null
static var _node: _NODE = null
static var _storage_scope: String = ""
static var _social_adapters: Dictionary[int, SocialAdapter] = {}
static var _storage: _STORAGE = null
static var _tracking: _TRACKING = null
static var _provider: _PROVIDER = null
static var _session: _SESSION = null
## Ban session: user ID, access token and signing key of a `BANNED` login. Not a session.
static var _ban_session: _SESSION = null
static var _remote_config: CoreContract.GetRemoteConfigResponse = null
## True after `prepare_terms` returned `AGREED` in this `init`.
static var _terms_agreed: bool = false
## Running access token refresh. Its result is a `GetAccessTokenResult`.
static var _refresh_wait: _WAIT = null
static var _frame_refresh_stopped: bool = false
static var _frame_refresh_queued: bool = false
static var _frame_refresh_call: Callable = Callable()
static var _replaced_popup_open: bool = false
## Consent of the last consent apply. `null` when there is none.
static var _applied_consent: ConsentInfo = null
static var _waits: Array[_WAIT] = []
static var _popup_waits: Array[_POPUP_WAIT] = []
# Settings `init` reads.
static var _refresh_margin_ms: int = 0
static var _web_link_prompt_logins: int = 0
static var _desktop_timeout_ms: int = 0
static var _storage_timeout_ms: int = 0
static var _max_age_years: int = 0
static var _terms_popup_key: String = ""
static var _age_popup_key: String = ""
static var _privacy_popup_key: String = ""
static var _push_popup_key: String = ""
static var _age_confirmation: bool = false
static var _privacy_choices: bool = false
static var _consent_version: int = 0
static var _tracking_request: bool = false
static var _ad_push: bool = false
static var _google_server_client_id: String = ""
static var _google_ios_client_id: String = ""
static var _google_desktop_client_id: String = ""

# DEV state. The DEV operations read and write it.
## Fake account name of `set_fake_social_account`. Empty when it was not set.
static var _fake_social_account: String = ""
## `CoreContract.TrackingStatus` of `set_fake_tracking_status`. -1 when it was not set.
static var _fake_tracking: int = -1
## DEV token storage the DEV code gives before `init`. `init` uses it in a run with DEV code that is not a browser
## runtime and has no `ogw-secure-storage` singleton.
static var _dev_storage: _STORAGE = null

# Core test replacements. Core tests set them before `init`.
## Login token storage to use instead of the platform one.
static var _test_storage: _STORAGE = null
## Opens a URL instead of the OS and returns a success flag.
static var _test_url_opener: Callable = Callable()
## Makes the persistent storage request instead of the browser and returns whether it could be made.
static var _test_persist_requester: Callable = Callable()
## Device tracking state and tracking permission request to use instead of the OS ones.
static var _test_tracking: _TRACKING = null

# State `release` keeps.
## Pending token: the login token of an auto login whose storage write did not succeed yet.
static var _pending_token: String = ""
## Login token the `AutoLogin` of the pending token sent.
static var _pending_sent_token: String = ""
## Linked providers written with the pending token.
static var _pending_linked: PackedInt32Array = PackedInt32Array()
## Order of the storage operations, also across `release`.
static var _storage_queue: _STORAGE_QUEUE = _STORAGE_QUEUE.new()


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not _read_settings():
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: no scene tree")
		return false
	_life = RefCounted.new()
	_storage = _test_storage if _test_storage != null else _platform_storage()
	if _storage != null:
		_storage.call_timeout_ms = _storage_timeout_ms
	_tracking = _test_tracking if _test_tracking != null else _TRACKING.new()
	_configure_google()
	_frame_refresh_call = AuthCore._frame_refresh
	_node = _NODE.new()
	_node.name = "AuthCore"
	tree.root.add_child(_node)
	var subscribed: bool = (
		EventCore.subscribe(AppForegroundReturnedEvent, _node._on_app_foreground_returned)
		and EventCore.subscribe(AppBackgroundEnteredEvent, _node._on_app_background_entered)
		and EventCore.subscribe(AppQuitEvent, _node._on_app_quit)
	)
	_is_initialized = true
	if not subscribed:
		LogCore.log_error(_TAG, "init: event subscription failed")
		release()
		return false
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


static func _on_node_exit(node: Node) -> void:
	if _is_initialized and node == _node:
		_clean_up(false)


## `release`. `detach` is `false` when the core node leaves the tree by itself (app exit).
static func _clean_up(detach: bool) -> void:
	_is_initialized = false
	_life = null
	var waits: Array[_WAIT] = _waits
	_waits = []
	for wait: _WAIT in waits:
		wait.finish()
	var popup_waits: Array[_POPUP_WAIT] = _popup_waits
	_popup_waits = []
	for popup_wait: _POPUP_WAIT in popup_waits:
		popup_wait.cancel()
	if NetworkCore.is_initialized():
		NetworkCore.set_session_provider(null)
	if LogCore.is_initialized():
		LogCore.set_analytics_allowed(false)
	if not _pending_token.is_empty() and not _storage_scope.is_empty() and _storage != null:
		_run_storage(_storage, StorageOp.WRITE, _storage_scope, _item_text(_pending_token, _pending_linked), null)
	for adapter: SocialAdapter in _social_adapters.values():
		if adapter != null:
			adapter.stop()
	if _tracking != null:
		_tracking.stop()
	var node: _NODE = _node
	_node = null
	if node != null:
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		if not node.is_queued_for_deletion():
			node.queue_free()
	_storage_scope = ""
	_social_adapters = {}
	_storage = null
	_tracking = null
	_provider = null
	_session = null
	_ban_session = null
	_remote_config = null
	_terms_agreed = false
	_refresh_wait = null
	_frame_refresh_stopped = false
	_frame_refresh_queued = false
	_frame_refresh_call = Callable()
	_replaced_popup_open = false
	_applied_consent = null
	_refresh_margin_ms = 0
	_web_link_prompt_logins = 0
	_desktop_timeout_ms = 0
	_storage_timeout_ms = 0
	_max_age_years = 0
	_terms_popup_key = ""
	_age_popup_key = ""
	_privacy_popup_key = ""
	_push_popup_key = ""
	_age_confirmation = false
	_privacy_choices = false
	_consent_version = 0
	_tracking_request = false
	_ad_push = false
	_google_server_client_id = ""
	_google_ios_client_id = ""
	_google_desktop_client_id = ""
	_fake_social_account = ""
	_fake_tracking = -1
	_dev_storage = null
	_test_storage = null
	_test_url_opener = Callable()
	_test_persist_requester = Callable()
	_test_tracking = null


## Login token storage of the running platform: the browser storage in the browser runtime, else OS secure storage.
## A run with DEV code that has no `ogw-secure-storage` singleton uses the DEV token storage instead.
static func _platform_storage() -> _STORAGE:
	if OS.get_name() == "Web":
		return _WEB_STORAGE.new()
	if CoreBuildInfo.has_dev_code and _dev_storage != null and not _SECURE_STORAGE.is_available():
		return _dev_storage
	return _SECURE_STORAGE.new()


static func _read_settings() -> bool:
	var ints: PackedStringArray = [
		"AuthCore.tokenRefreshMarginMs",
		"AuthCore.webLinkPromptLogins",
		"AuthCore.desktopSignInTimeoutMs",
		"AuthCore.storageCallTimeoutMs",
		"auth.maxAgeYears",
		"consent.version",
	]
	var bools: PackedStringArray = [
		"consent.ageConfirmation",
		"consent.privacyChoices",
		"consent.trackingRequest",
		"pushConsent.adPush",
	]
	var strings: PackedStringArray = [
		"termsPopup",
		"agePopup",
		"privacyPopup",
		"pushConsentPopup",
		"loginGoogle.serverClientId",
		"loginGoogle.iosClientId",
		"loginGoogle.desktopClientId",
	]
	var ok: bool = true
	for key: String in ints:
		ok = _has_setting(key, TYPE_INT) and ok
	for key: String in bools:
		ok = _has_setting(key, TYPE_BOOL) and ok
	for key: String in strings:
		ok = _has_setting(key, TYPE_STRING) and ok
	if not ok:
		return false
	_refresh_margin_ms = CoreSettings.get_int("AuthCore.tokenRefreshMarginMs")
	_web_link_prompt_logins = CoreSettings.get_int("AuthCore.webLinkPromptLogins")
	_desktop_timeout_ms = CoreSettings.get_int("AuthCore.desktopSignInTimeoutMs")
	_storage_timeout_ms = CoreSettings.get_int("AuthCore.storageCallTimeoutMs")
	_max_age_years = CoreSettings.get_int("auth.maxAgeYears")
	_consent_version = CoreSettings.get_int("consent.version")
	_age_confirmation = CoreSettings.get_bool("consent.ageConfirmation")
	_privacy_choices = CoreSettings.get_bool("consent.privacyChoices")
	_tracking_request = CoreSettings.get_bool("consent.trackingRequest")
	_ad_push = CoreSettings.get_bool("pushConsent.adPush")
	_terms_popup_key = CoreSettings.get_string("termsPopup")
	_age_popup_key = CoreSettings.get_string("agePopup")
	_privacy_popup_key = CoreSettings.get_string("privacyPopup")
	_push_popup_key = CoreSettings.get_string("pushConsentPopup")
	_google_server_client_id = CoreSettings.get_string("loginGoogle.serverClientId")
	_google_ios_client_id = CoreSettings.get_string("loginGoogle.iosClientId")
	_google_desktop_client_id = CoreSettings.get_string("loginGoogle.desktopClientId")
	return true


static func _has_setting(key: String, type: int) -> bool:
	var found: bool = false
	match type:
		TYPE_INT:
			found = CoreSettings.has_int(key)
		TYPE_BOOL:
			found = CoreSettings.has_bool(key)
		TYPE_STRING:
			found = CoreSettings.has_string(key)
	if found:
		return true
	LogCore.log_error(_TAG, "init: setting %s is missing or has another type" % key)
	return false


static func _configure_google() -> void:
	if not _social_adapters.has(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE):
		return
	var google: LoginGoogleAdapter = _social_adapters[CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE] as LoginGoogleAdapter
	if google == null:
		return
	google.server_client_id = _google_server_client_id
	google.ios_client_id = _google_ios_client_id
	google.desktop_client_id = _google_desktop_client_id
	google.desktop_timeout_ms = _desktop_timeout_ms
	google.open_url = AuthCore._open_url


static func _check(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, "%s: not initialized" % operation)
	return false


# --- before init ---


static func set_storage_scope(scope: String) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_storage_scope: called after init")
		return
	_storage_scope = scope


static func set_social_adapter(provider: CoreContract.LoginProvider, adapter: SocialAdapter) -> void:
	if _is_initialized:
		LogCore.log_error(_TAG, "set_social_adapter: called after init")
		return
	if not _is_social(provider) or adapter == null:
		LogCore.log_error(_TAG, "set_social_adapter: not a social provider or no adapter")
		return
	_social_adapters[provider] = adapter


# --- boot login ---


static func boot_login() -> LoginResult:
	if not _check("boot_login"):
		return _login_result(LoginStatus.FAILED)
	var life: RefCounted = _life
	if CoreBuildInfo.platform == "web" and not _request_persist():
		LogCore.log_info(_TAG, "boot_login: the persistent storage request cannot be made")
	if not await _check_install_marker() or life != _life:
		return _login_result(LoginStatus.FAILED)
	var marker: FileResult = LocalDataCore.read_file(_AGE_BLOCK_MARKER, 1)
	if marker.ok:
		return _login_result(LoginStatus.AGE_BLOCKED)
	if marker.error != LocalDataCore.FileError.NOT_FOUND:
		LogCore.log_error(_TAG, "boot_login: age block marker read %s" % _file_error_name(marker.error))
		return _login_result(LoginStatus.FAILED)
	var consent_retried: bool = false
	var result: LoginResult = null
	while true:
		var terms: TermsStatus = await prepare_terms()
		while terms == TermsStatus.REFUSED and life == _life:
			terms = await prepare_terms()
		if life != _life or terms != TermsStatus.AGREED:
			return _login_result(LoginStatus.FAILED)
		result = await _auto_login()
		if life != _life:
			return _login_result(LoginStatus.FAILED)
		if result.status == LoginStatus.CONSENT_REQUIRED and not consent_retried:
			consent_retried = true
			continue
		break
	if result.status != LoginStatus.SUCCESS:
		return result
	var consent: ConsentResult = await prepare_consent()
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if consent == ConsentResult.AGE_BLOCKED:
		return _login_result(LoginStatus.AGE_BLOCKED)
	if consent != ConsentResult.DONE:
		return _login_result(LoginStatus.FAILED)
	await _web_link_prompt()
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	return result


## Auto login, then the new account login for `NO_TOKEN` and account recovery for `REJECTED`.
static func _auto_login() -> LoginResult:
	var life: RefCounted = _life
	if not _terms_agreed:
		LogCore.log_error(_TAG, "auto login: prepare_terms has not returned Agreed")
		return _login_result(LoginStatus.FAILED)
	var token: String = _pending_token
	var linked: PackedInt32Array = _pending_linked
	if token.is_empty():
		var read: _STORAGE.Outcome = await _storage_call(StorageOp.READ)
		if life != _life:
			return _login_result(LoginStatus.FAILED)
		if read.status == _STORAGE.Status.NOT_FOUND:
			return await login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
		if read.status != _STORAGE.Status.OK:
			return _login_result(LoginStatus.FAILED)
		var item: _StoredItem = _parse_item(read.text)
		linked = item.linked
		if item.login_token.is_empty():
			LogCore.log_error(_TAG, "auto login: the storage item has no login token")
			return await _account_recovery(linked)
		token = item.login_token
	var request: CoreContract.AutoLoginRequest = CoreContract.AutoLoginRequest.new()
	request.agreements = _agreements()
	var sent: AuthSendResult = await _send_auth(request, token, false, "")
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if sent == null or not sent.ok:
		var failed: LoginResult = _login_failure(sent)
		if failed.status == LoginStatus.REJECTED:
			return await _account_recovery(linked)
		return failed
	var response: CoreContract.AutoLoginResponse = sent.response as CoreContract.AutoLoginResponse
	if response == null or response.result == null:
		LogCore.log_error(_TAG, "auto login: response has no result")
		return _login_result(LoginStatus.FAILED)
	var written: bool = await _write_item(response.result.login_token, response.result.linked_providers)
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if written:
		_clear_pending()
	else:
		_pending_token = response.result.login_token
		_pending_sent_token = token
		_pending_linked = response.result.linked_providers
	return _open_session(response.result)


static func _check_install_marker() -> bool:
	var life: RefCounted = _life
	var marker: FileResult = LocalDataCore.read_file(_INSTALL_MARKER, 1)
	if marker.ok:
		return true
	if marker.error != LocalDataCore.FileError.NOT_FOUND:
		LogCore.log_error(_TAG, "install marker read %s" % _file_error_name(marker.error))
		return false
	var removed: _STORAGE.Outcome = await _storage_call(StorageOp.REMOVE)
	if life != _life:
		return false
	if removed.status != _STORAGE.Status.OK and removed.status != _STORAGE.Status.NOT_FOUND:
		return false
	var written: FileResult = LocalDataCore.write_file(_INSTALL_MARKER, PackedByteArray([_MARKER_BYTE]))
	if not written.ok:
		LogCore.log_error(_TAG, "install marker write %s" % _file_error_name(written.error))
		return false
	return true


static func _account_recovery(linked: PackedInt32Array) -> LoginResult:
	var life: RefCounted = _life
	var recovery: int = 0
	var order: PackedInt32Array = [CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE, CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE]
	for provider: int in order:
		if linked.has(provider) and _is_supported(provider):
			recovery = provider
			break
	while life == _life:
		var labels: PackedStringArray = []
		var body: String = ReservedString.auth_recover_guest()
		if recovery != 0:
			body = ReservedString.auth_recover_linked()
			labels.append(
				ReservedString.auth_recover_login_apple()
				if recovery == CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE
				else ReservedString.auth_recover_login_google()
			)
		labels.append(ReservedString.auth_recover_new())
		var choice: Choice = await _choose(body, labels, -1)
		if life != _life:
			break
		if choice == Choice.NOT_OPENED:
			LogCore.log_error(_TAG, "account recovery: popup did not open")
			return _login_result(LoginStatus.FAILED)
		if choice == Choice.HIDDEN:
			continue
		if recovery != 0 and choice == Choice.FIRST:
			var result: LoginResult = await login(recovery as CoreContract.LoginProvider)
			if life != _life:
				break
			if result.status == LoginStatus.CANCELLED or result.status == LoginStatus.FAILED:
				continue
			return result
		var confirm_labels: PackedStringArray = [ReservedString.auth_recover_new_ok(), ReservedString.auth_recover_back()]
		var confirm: Choice = await _choose(ReservedString.auth_recover_new_confirm(), confirm_labels, 1)
		if life != _life:
			break
		if confirm == Choice.NOT_OPENED:
			LogCore.log_error(_TAG, "account recovery: new-start confirm popup did not open")
			return _login_result(LoginStatus.FAILED)
		if confirm != Choice.FIRST:
			continue
		var removed: _STORAGE.Outcome = await _storage_call(StorageOp.REMOVE)
		if life != _life:
			break
		if removed.status != _STORAGE.Status.OK and removed.status != _STORAGE.Status.NOT_FOUND:
			return _login_result(LoginStatus.FAILED)
		_clear_pending()
		return await login(CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST)
	return _login_result(LoginStatus.FAILED)


static func _web_link_prompt() -> void:
	if CoreBuildInfo.platform != "web" or _session == null or not _session.linked_providers.is_empty():
		return
	var count: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_WEB_GUEST_LOGINS, 0)
	count += 1
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _KEY_WEB_GUEST_LOGINS, count)
	if _web_link_prompt_logins <= 0 or count % _web_link_prompt_logins != 0:
		return
	if not _is_supported(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE):
		return
	var life: RefCounted = _life
	var labels: PackedStringArray = [ReservedString.auth_web_link_google(), ReservedString.auth_web_link_later()]
	var choice: Choice = await _choose(ReservedString.auth_web_link_body(), labels, 1)
	if life != _life:
		return
	if choice == Choice.NOT_OPENED:
		LogCore.log_error(_TAG, "link prompt popup did not open")
		return
	if choice != Choice.FIRST:
		return
	var linked: LinkStatus = await link_account(CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE)
	if life != _life:
		return
	if linked == LinkStatus.ALREADY_LINKED or linked == LinkStatus.FAILED:
		MessageCore.show_toast(ReservedString.auth_web_link_failed())


# --- terms ---


static func prepare_terms() -> TermsStatus:
	if not _check("prepare_terms"):
		return TermsStatus.FAILED
	var life: RefCounted = _life
	var documents: Dictionary[int, CoreContract.TermsDocument] = {}
	if not await _get_terms(documents) or life != _life:
		return TermsStatus.FAILED
	var terms: CoreContract.TermsDocument = _document(documents, CoreContract.TermsItem.TERMS_ITEM_TERMS)
	var privacy: CoreContract.TermsDocument = _document(documents, CoreContract.TermsItem.TERMS_ITEM_PRIVACY)
	if terms == null or privacy == null or not _is_document_url(terms.url) or not _is_document_url(privacy.url):
		LogCore.log_error(_TAG, "prepare_terms: a terms document URL fails the document URL check")
		return TermsStatus.FAILED
	var stored_terms: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_TERMS_VERSION, 0)
	var stored_privacy: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_PRIVACY_TERMS_VERSION, 0)
	if stored_terms == terms.version and stored_privacy == privacy.version:
		_terms_agreed = true
		return TermsStatus.AGREED
	var param: _POPUP_PARAM = _POPUP_PARAM.new()
	param.terms_url = terms.url
	param.privacy_url = privacy.url
	param.open_url = AuthCore._open_url
	if not await _show_popup(_terms_popup_key, param):
		if life == _life:
			LogCore.log_error(_TAG, "prepare_terms: terms popup did not open")
		return TermsStatus.FAILED
	if life != _life:
		return TermsStatus.FAILED
	if not param.confirmed or not param.first_on or not param.second_on:
		return TermsStatus.REFUSED
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _KEY_TERMS_VERSION, terms.version)
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _KEY_PRIVACY_TERMS_VERSION, privacy.version)
	_terms_agreed = true
	return TermsStatus.AGREED


static func open_terms_document(item: CoreContract.TermsItem) -> bool:
	if not _check("open_terms_document"):
		return false
	if item != CoreContract.TermsItem.TERMS_ITEM_TERMS and item != CoreContract.TermsItem.TERMS_ITEM_PRIVACY:
		LogCore.log_error(_TAG, "open_terms_document: not a terms item")
		return false
	var life: RefCounted = _life
	var documents: Dictionary[int, CoreContract.TermsDocument] = {}
	if not await _get_terms(documents) or life != _life:
		return false
	var document: CoreContract.TermsDocument = _document(documents, item)
	if document == null or not _is_document_url(document.url):
		LogCore.log_error(_TAG, "open_terms_document: the document URL fails the document URL check")
		return false
	if not _open_url(document.url):
		LogCore.log_error(_TAG, "open_terms_document: the OS did not open the URL")
		return false
	return true


## Sends `GetTerms` and puts the documents of the response in `documents` by item. `false` when the request failed.
static func _get_terms(documents: Dictionary[int, CoreContract.TermsDocument]) -> bool:
	var sent: AuthSendResult = await _send_auth(CoreContract.GetTermsRequest.new(), "", false, "")
	if sent == null or not sent.ok:
		return false
	var response: CoreContract.GetTermsResponse = sent.response as CoreContract.GetTermsResponse
	if response == null:
		return false
	for document: CoreContract.TermsDocument in response.documents:
		if document != null and not documents.has(document.item):
			documents[document.item] = document
	return true


static func _document(documents: Dictionary[int, CoreContract.TermsDocument], item: int) -> CoreContract.TermsDocument:
	return documents[item] if documents.has(item) else null


## Document URL check: scheme `https` (`http` too in a build with DEV code), a host and no user info.
static func _is_document_url(url: String) -> bool:
	var rest: String = ""
	if url.begins_with("https://"):
		rest = url.substr(8)
	elif url.begins_with("http://") and CoreBuildInfo.has_dev_code:
		rest = url.substr(7)
	else:
		return false
	var end: int = rest.length()
	for mark: String in PackedStringArray(["/", "?", "#"]):
		var at: int = rest.find(mark)
		if at >= 0 and at < end:
			end = at
	var authority: String = rest.substr(0, end)
	if authority.contains("@"):
		return false
	var host: String = authority
	if host.begins_with("["):
		host = host.substr(0, host.find("]") + 1) if host.contains("]") else ""
	elif host.contains(":"):
		host = host.substr(0, host.find(":"))
	return not host.is_empty() and host != "[]"


static func _agreements() -> Array[CoreContract.TermsAgreement]:
	var terms: CoreContract.TermsAgreement = CoreContract.TermsAgreement.new()
	terms.item = CoreContract.TermsItem.TERMS_ITEM_TERMS
	terms.version = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_TERMS_VERSION, 0)
	var privacy: CoreContract.TermsAgreement = CoreContract.TermsAgreement.new()
	privacy.item = CoreContract.TermsItem.TERMS_ITEM_PRIVACY
	privacy.version = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_PRIVACY_TERMS_VERSION, 0)
	var agreements: Array[CoreContract.TermsAgreement] = [terms, privacy]
	return agreements


# --- login ---


static func login(provider: CoreContract.LoginProvider) -> LoginResult:
	if not _check("login"):
		return _login_result(LoginStatus.FAILED)
	if not _is_provider(provider):
		LogCore.log_error(_TAG, "login: not a login provider")
		return _login_result(LoginStatus.FAILED)
	if _session != null:
		LogCore.log_error(_TAG, "login: a session is open")
		return _login_result(LoginStatus.FAILED)
	if not _terms_agreed:
		LogCore.log_error(_TAG, "login: prepare_terms has not returned Agreed")
		return _login_result(LoginStatus.FAILED)
	var life: RefCounted = _life
	var request: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	request.provider = provider
	request.agreements = _agreements()
	if provider != CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST:
		if not _is_supported(provider):
			LogCore.log_error(_TAG, "login: the provider is not supported")
			return _login_result(LoginStatus.FAILED)
		var signed: SocialAdapter.SignInResult = await _sign_in(provider)
		if life != _life:
			return _login_result(LoginStatus.FAILED)
		if signed.status == SocialAdapter.SignInStatus.CANCELLED:
			return _login_result(LoginStatus.CANCELLED)
		if signed.status != SocialAdapter.SignInStatus.SUCCESS:
			return _login_result(LoginStatus.FAILED)
		request.credential = signed.credential
	var sent: AuthSendResult = await _send_auth(request, "", false, "")
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if sent == null or not sent.ok:
		return _login_failure(sent)
	var response: CoreContract.LoginResponse = sent.response as CoreContract.LoginResponse
	if response == null or response.result == null:
		LogCore.log_error(_TAG, "login: response has no result")
		return _login_result(LoginStatus.FAILED)
	if _session != null:
		LogCore.log_error(_TAG, "login: a session opened while the login waited")
		return _login_result(LoginStatus.FAILED)
	var written: bool = await _write_item(response.result.login_token, response.result.linked_providers)
	if life != _life or not written:
		return _login_result(LoginStatus.FAILED)
	_clear_pending()
	return _open_session(response.result)


## Login success order 2 to 4.
static func _open_session(result: CoreContract.AuthResult) -> LoginResult:
	var session: _SESSION = _SESSION.new()
	session.access_token = result.access_token
	session.access_token_expires_at = result.access_token_expires_at
	session.signing_key = result.session_signing_key
	session.login_token = result.login_token
	session.user_id = result.user_id
	session.public_code = result.public_code
	session.linked_providers = result.linked_providers
	session.consent = result.consent if result.consent != null else CoreContract.ConsentUserState.new()
	_session = session
	_ban_session = null
	_remote_config = result.remote_config if result.remote_config != null else CoreContract.GetRemoteConfigResponse.new()
	_frame_refresh_stopped = false
	_apply_consent()
	UserStateCore.set_user_created_at(result.user_created_at)
	_provider = _PROVIDER.new()
	NetworkCore.set_session_provider(_provider)
	var event: LoginCompletedEvent = EventCore.acquire(LoginCompletedEvent) as LoginCompletedEvent
	event.user_id = result.user_id
	EventCore.publish(event)
	var done: LoginResult = _login_result(LoginStatus.SUCCESS)
	done.user_id = result.user_id
	done.public_code = result.public_code
	return done


## `LoginStatus` of a failed `Login` or `AutoLogin`.
static func _login_failure(sent: AuthSendResult) -> LoginResult:
	var result: LoginResult = _login_result(LoginStatus.FAILED)
	if sent == null or sent.failure == null or sent.failure.kind != NetworkCore.FailureKind.SERVER_ERROR:
		return result
	var failure: RequestFailure = sent.failure
	match failure.error_code:
		CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED:
			result.status = LoginStatus.REJECTED
		CoreContract.CoreError.CORE_ERROR_CONSENT_REQUIRED:
			result.status = LoginStatus.CONSENT_REQUIRED
		CoreContract.CoreError.CORE_ERROR_AGE_BELOW_MINIMUM:
			result.status = LoginStatus.AGE_BLOCKED
		CoreContract.CoreError.CORE_ERROR_BANNED:
			result.status = LoginStatus.BANNED
			var ban: CoreContract.BanDetail = failure.ban
			if ban != null:
				result.user_id = ban.user_id
				result.public_code = ban.public_code
				result.ban_until_at = ban.until_at
				result.deletion_url = ban.deletion_url
				if _session == null and not ban.access_token.is_empty():
					var ban_session: _SESSION = _SESSION.new()
					ban_session.user_id = ban.user_id
					ban_session.public_code = ban.public_code
					ban_session.access_token = ban.access_token
					ban_session.signing_key = ban.session_signing_key
					_ban_session = ban_session
		_:
			result.error_code = failure.error_code
	return result


static func is_provider_supported(provider: CoreContract.LoginProvider) -> bool:
	if not _check("is_provider_supported"):
		return false
	return _is_supported(provider)


static func _is_supported(provider: int) -> bool:
	if provider == CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST:
		return true
	if not _is_social(provider) or not _social_adapters.has(provider):
		return false
	return _social_adapters[provider].is_supported(CoreBuildInfo.platform)


static func is_logged_in() -> bool:
	if not _check("is_logged_in"):
		return false
	return _session != null


static func get_user_id() -> int:
	if not _check("get_user_id"):
		return 0
	if _session == null:
		LogCore.log_error(_TAG, "get_user_id: no session")
		return 0
	return _session.user_id


static func get_public_code() -> String:
	if not _check("get_public_code"):
		return ""
	if _session != null:
		return _session.public_code
	if _ban_session != null:
		return _ban_session.public_code
	LogCore.log_error(_TAG, "get_public_code: no session and no ban session")
	return ""


static func get_login_remote_config() -> CoreContract.GetRemoteConfigResponse:
	if not _check("get_login_remote_config") or _remote_config == null:
		return CoreContract.GetRemoteConfigResponse.new()
	return _remote_config


static func list_linked_providers(buffer: PackedInt32Array) -> int:
	if not _check("list_linked_providers") or _session == null:
		return 0
	var count: int = mini(buffer.size(), _session.linked_providers.size())
	if count < _session.linked_providers.size():
		LogCore.log_error(_TAG, "list_linked_providers: the buffer is too small")
	for i: int in count:
		buffer[i] = _session.linked_providers[i]
	return count


# --- access token ---


static func get_access_token() -> GetAccessTokenResult:
	if not _check("get_access_token"):
		return _token_failure(null)
	return await _provide_access_token(false)


static func refresh_access_token() -> GetAccessTokenResult:
	if not _check("refresh_access_token"):
		return _token_failure(null)
	return await _provide_access_token(true)


static func _provide_access_token(force: bool) -> GetAccessTokenResult:
	if not _is_initialized or _session == null:
		LogCore.log_error(_TAG, "access token: no session")
		return _token_failure(null)
	if not force and _session.access_token_expires_at - TimeCore.get_server_time() > _refresh_margin_ms:
		var result: GetAccessTokenResult = GetAccessTokenResult.new()
		result.ok = true
		result.access_token = _session.access_token
		return result
	return await _refresh_token()


static func _signing_key() -> String:
	return _session.signing_key if _session != null else ""


## Refresh of the access token. A refresh that is running gives its result to every caller.
static func _refresh_token() -> GetAccessTokenResult:
	var wait: _WAIT = _refresh_wait
	if wait == null:
		wait = _WAIT.new()
		_refresh_wait = wait
		# A refresh that ends without waiting clears `_refresh_wait` before it returns.
		_run_refresh(wait)
	var life: RefCounted = _life
	_waits.append(wait)
	if not wait.finished:
		await wait.done
	_waits.erase(wait)
	if life != _life or not wait.result is GetAccessTokenResult:
		return _token_failure(null)
	return wait.result as GetAccessTokenResult


static func _run_refresh(wait: _WAIT) -> void:
	var life: RefCounted = _life
	var session: _SESSION = _session
	var request: CoreContract.RefreshTokenRequest = CoreContract.RefreshTokenRequest.new()
	var token: String = _pending_sent_token if not _pending_token.is_empty() else session.login_token
	var sent: AuthSendResult = await _send_auth(request, token, true, session.signing_key)
	if _refresh_wait == wait:
		_refresh_wait = null
	if life != _life:
		wait.finish()
		return
	if sent != null and sent.ok:
		var response: CoreContract.RefreshTokenResponse = sent.response as CoreContract.RefreshTokenResponse
		if response != null and _session == session:
			session.access_token = response.access_token
			session.access_token_expires_at = response.access_token_expires_at
			_frame_refresh_stopped = false
			var result: GetAccessTokenResult = GetAccessTokenResult.new()
			result.ok = true
			result.access_token = response.access_token
			wait.finish(result)
			_write_pending_token()
			return
		wait.finish(_token_failure(null))
		return
	var failure: RequestFailure = sent.failure if sent != null else null
	wait.finish(_token_failure(failure))
	if failure == null or failure.kind != NetworkCore.FailureKind.SERVER_ERROR or _session != session:
		return
	match failure.error_code:
		CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED:
			_clear_pending()
			_end_session(SessionEndReason.REJECTED)
			_request_restart()
		CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED:
			_on_session_replaced()


## Failure of the access token: the failure of `RefreshToken`, or a `CONNECTION_FAILED` one when there is none.
static func _token_failure(failure: RequestFailure) -> GetAccessTokenResult:
	var result: GetAccessTokenResult = GetAccessTokenResult.new()
	if failure != null:
		result.failure = failure
		return result
	var connection: RequestFailure = RequestFailure.new()
	connection.kind = NetworkCore.FailureKind.CONNECTION_FAILED
	connection.request_name = "core/RefreshToken"
	result.failure = connection
	return result


## Frame code: queues the refresh when the access token is about to expire.
static func _on_frame() -> void:
	if _session == null or _frame_refresh_stopped or _frame_refresh_queued or _refresh_wait != null:
		return
	if not TimeCore.is_synced():
		return
	if _session.access_token_expires_at - TimeCore.get_server_time() > _refresh_margin_ms:
		return
	_frame_refresh_queued = true
	_frame_refresh_call.call_deferred()


static func _frame_refresh() -> void:
	_frame_refresh_queued = false
	if not _is_initialized or _session == null:
		return
	var life: RefCounted = _life
	var result: GetAccessTokenResult = await _refresh_token()
	if life == _life and not result.ok:
		_frame_refresh_stopped = true


static func _on_foreground_returned() -> void:
	_frame_refresh_stopped = false
	_write_pending_token()
	if _session != null:
		_refresh_token()


static func _on_session_replaced() -> void:
	if not _is_initialized or _session == null:
		return
	_end_session(SessionEndReason.REPLACED)
	if _replaced_popup_open:
		return
	_replaced_popup_open = true
	_show_session_replaced()


static func _show_session_replaced() -> void:
	var life: RefCounted = _life
	var labels: PackedStringArray = [ReservedString.auth_go_to_title()]
	var choice: Choice = await _choose(ReservedString.auth_session_replaced(), labels, -1)
	if life != _life:
		return
	_replaced_popup_open = false
	if choice == Choice.NOT_OPENED:
		LogCore.log_error(_TAG, "session replaced popup did not open")
		_request_restart()
	elif choice == Choice.FIRST:
		_request_restart()


# --- login token storage ---


## Storage operation on the item of the storage scope. Waits for the operations started before it.
static func _storage_call(op: StorageOp, text: String = "") -> _STORAGE.Outcome:
	if _storage_scope.is_empty() or _storage == null:
		LogCore.log_error(_TAG, "login token storage %s: no storage scope" % _op_name(op))
		return _STORAGE.Outcome.new(_STORAGE.Status.FAILED)
	var life: RefCounted = _life
	var wait: _WAIT = _WAIT.new()
	_waits.append(wait)
	_run_storage(_storage, op, _storage_scope, text, wait)
	if not wait.finished:
		await wait.done
	_waits.erase(wait)
	if life != _life or not wait.result is _STORAGE.Outcome:
		return _STORAGE.Outcome.new(_STORAGE.Status.FAILED)
	var outcome: _STORAGE.Outcome = wait.result as _STORAGE.Outcome
	if outcome.status != _STORAGE.Status.OK and outcome.status != _STORAGE.Status.NOT_FOUND:
		LogCore.log_error(_TAG, "login token storage %s: %s" % [_op_name(op), _STORAGE.status_name(outcome.status)])
	elif op == StorageOp.WRITE and outcome.status == _STORAGE.Status.NOT_FOUND:
		LogCore.log_error(_TAG, "login token storage write: NotFound")
		return _STORAGE.Outcome.new(_STORAGE.Status.FAILED)
	return outcome


## Runs one storage operation after the one started before it. `wait` gets the outcome; `null` drops it.
static func _run_storage(storage: _STORAGE, op: StorageOp, name: String, text: String, wait: _WAIT) -> void:
	var previous: _WAIT = _storage_queue.tail
	var mine: _WAIT = _WAIT.new()
	_storage_queue.tail = mine
	if previous != null and not previous.finished:
		await previous.done
	var outcome: _STORAGE.Outcome = null
	match op:
		StorageOp.READ:
			outcome = await storage.read_item(name)
		StorageOp.WRITE:
			outcome = await storage.write_item(name, text)
		_:
			outcome = await storage.remove_item(name)
	if _storage_queue.tail == mine:
		_storage_queue.tail = null
	mine.finish()
	if wait != null:
		wait.finish(outcome)


## Writes the storage item. `true` on success.
static func _write_item(token: String, linked: PackedInt32Array) -> bool:
	var written: _STORAGE.Outcome = await _storage_call(StorageOp.WRITE, _item_text(token, linked))
	return written.status == _STORAGE.Status.OK


## Writes the pending token. Clears it on success when it is still the same token.
static func _write_pending_token() -> void:
	if not _is_initialized or _pending_token.is_empty():
		return
	var life: RefCounted = _life
	var token: String = _pending_token
	if await _write_item(token, _pending_linked) and life == _life and _pending_token == token:
		_clear_pending()


static func _clear_pending() -> void:
	_pending_token = ""
	_pending_sent_token = ""
	_pending_linked = PackedInt32Array()


static func _item_text(token: String, linked: PackedInt32Array) -> String:
	var names: PackedStringArray = []
	for provider: int in linked:
		names.append(_provider_name(provider))
	return "{\"login_token\":%s,\"linked_providers\":%s}" % [JSON.stringify(token), JSON.stringify(names)]


## Login token and linked providers of a read storage item.
class _StoredItem extends RefCounted:
	## Empty when the item has no login token.
	var login_token: String = ""
	var linked: PackedInt32Array = PackedInt32Array()


# ogw:input_boundary
static func _parse_item(text: String) -> _StoredItem:
	var item: _StoredItem = _StoredItem.new()
	var json: JSON = JSON.new()
	if json.parse(text) != OK or not json.data is Dictionary:
		return item
	var data: Dictionary = json.data
	var token: Variant = data["login_token"] if data.has("login_token") else null
	if token is String:
		item.login_token = token
	var providers: Variant = data["linked_providers"] if data.has("linked_providers") else null
	if not providers is Array:
		return item
	var elements: Array = providers
	for element: Variant in elements:
		var value: int = -1
		if element is String:
			var name: String = element
			value = _provider_value(name)
		if value < 0:
			LogCore.log_warn(_TAG, "storage item: linked provider is not a LoginProvider element name")
			continue
		item.linked.append(value)
	return item


static func _provider_name(provider: int) -> String:
	match provider:
		CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST:
			return "LOGIN_PROVIDER_GUEST"
		CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE:
			return "LOGIN_PROVIDER_APPLE"
		CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE:
			return "LOGIN_PROVIDER_GOOGLE"
	return "LOGIN_PROVIDER_UNSPECIFIED"


## Value of a `LoginProvider` element name, or -1.
static func _provider_value(element: String) -> int:
	var providers: PackedInt32Array = [
		CoreContract.LoginProvider.LOGIN_PROVIDER_UNSPECIFIED,
		CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST,
		CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE,
		CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE,
	]
	for provider: int in providers:
		if _provider_name(provider) == element:
			return provider
	return -1


static func _op_name(op: StorageOp) -> String:
	match op:
		StorageOp.READ:
			return "read"
		StorageOp.WRITE:
			return "write"
	return "remove"


static func _file_error_name(error: LocalDataCore.FileError) -> String:
	match error:
		LocalDataCore.FileError.NONE:
			return "None"
		LocalDataCore.FileError.INVALID_PATH:
			return "InvalidPath"
		LocalDataCore.FileError.NOT_FOUND:
			return "NotFound"
		LocalDataCore.FileError.TOO_LARGE:
			return "TooLarge"
		LocalDataCore.FileError.NO_SPACE:
			return "NoSpace"
	return "Failed"


# --- age and privacy choices ---


static func prepare_consent() -> ConsentResult:
	if not _check("prepare_consent"):
		return ConsentResult.FAILED
	if _session == null:
		LogCore.log_error(_TAG, "prepare_consent: no session")
		return ConsentResult.FAILED
	var life: RefCounted = _life
	if _age_confirmation and _session.consent.age_confirmed_at == 0:
		var birth: int = await _ask_birth_year_month()
		if life != _life or birth == 0:
			return ConsentResult.FAILED
		var request: CoreContract.ConfirmAgeRequest = CoreContract.ConfirmAgeRequest.new()
		request.birth_year_month = birth
		var call: _CALL = await _send(request, false)
		if life != _life or call == null or not call.ok:
			return ConsentResult.FAILED
		var confirmed: CoreContract.ConfirmAgeResponse = call.response as CoreContract.ConfirmAgeResponse
		_take_consent(confirmed.consent if confirmed != null else null)
	if _session == null:
		return ConsentResult.FAILED
	if _session.consent.below_minimum_age:
		await _block_age()
		return ConsentResult.AGE_BLOCKED
	if _privacy_choices and _session.consent.privacy_version != _consent_version:
		var param: _POPUP_PARAM = _POPUP_PARAM.new()
		if not await _ask_choices(_privacy_popup_key, param):
			return ConsentResult.FAILED
		if life != _life or _session == null:
			return ConsentResult.FAILED
		if not await _update_consent(_choice_of(param.first_on), _choice_of(param.second_on)):
			return ConsentResult.FAILED
	if life != _life or _session == null:
		return ConsentResult.FAILED
	if _ad_push and _session.consent.push_ad_at == 0:
		var push_param: _POPUP_PARAM = _POPUP_PARAM.new()
		if not await _ask_choices(_push_popup_key, push_param):
			return ConsentResult.FAILED
		if life != _life:
			return ConsentResult.FAILED
		var pushed: bool = await update_push_consent(_choice_of(push_param.first_on), _choice_of(push_param.second_on))
		if life != _life or not pushed:
			return ConsentResult.FAILED
	if _session == null:
		return ConsentResult.FAILED
	if (
		CoreBuildInfo.platform == "ios"
		and _tracking_request
		and _session.consent.ad_personalization_allowed
		and _tracking_state() == CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
	):
		await _request_tracking()
		if life != _life or _session == null:
			return ConsentResult.FAILED
	if _tracking_state() != _session.consent.tracking:
		if not await _update_consent(_session.consent.ad_personalization, _session.consent.analytics):
			return ConsentResult.FAILED
	return ConsentResult.DONE if life == _life else ConsentResult.FAILED


static func open_privacy_choices() -> bool:
	if not _check("open_privacy_choices"):
		return false
	if _session == null:
		LogCore.log_error(_TAG, "open_privacy_choices: no session")
		return false
	if not _privacy_choices:
		return false
	var life: RefCounted = _life
	var param: _POPUP_PARAM = _POPUP_PARAM.new()
	param.first_on = _session.consent.ad_personalization == CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	param.second_on = _session.consent.analytics == CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
	if not await _ask_choices(_privacy_popup_key, param) or life != _life or _session == null:
		return false
	return await _update_consent(_choice_of(param.first_on), _choice_of(param.second_on))


static func is_privacy_choices_enabled() -> bool:
	if not _check("is_privacy_choices_enabled"):
		return false
	return _privacy_choices


static func is_ad_push_enabled() -> bool:
	if not _check("is_ad_push_enabled"):
		return false
	return _ad_push


static func get_consent() -> ConsentInfo:
	if not _check("get_consent"):
		return ConsentInfo.new()
	if _session == null:
		LogCore.log_error(_TAG, "get_consent: no session")
		return ConsentInfo.new()
	return _consent_info()


static func update_push_consent(push_ad: CoreContract.ConsentChoice, push_night: CoreContract.ConsentChoice) -> bool:
	if not _check("update_push_consent"):
		return false
	if _session == null:
		LogCore.log_error(_TAG, "update_push_consent: no session")
		return false
	if not _ad_push:
		LogCore.log_error(_TAG, "update_push_consent: ad push is off")
		return false
	if not _is_answer(push_ad) or not _is_answer(push_night):
		LogCore.log_error(_TAG, "update_push_consent: a choice is not GRANTED or DENIED")
		return false
	var life: RefCounted = _life
	var before: CoreContract.ConsentUserState = _session.consent
	var request: CoreContract.UpdatePushConsentRequest = CoreContract.UpdatePushConsentRequest.new()
	request.push_ad = push_ad
	request.push_night = push_night
	var call: _CALL = await _send(request, false)
	if life != _life or call == null or not call.ok:
		return false
	var response: CoreContract.UpdatePushConsentResponse = call.response as CoreContract.UpdatePushConsentResponse
	var after: CoreContract.ConsentUserState = response.consent if response != null else null
	if after != null:
		var args: FormatArgs = FormatArgs.new()
		if after.push_ad != before.push_ad and _is_answer(after.push_ad):
			args.clear()
			args.set_int("date", after.push_ad_at)
			var granted: bool = after.push_ad == CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
			MessageCore.show_toast(
				ReservedString.auth_push_ad_granted() if granted else ReservedString.auth_push_ad_denied(), args
			)
		if after.push_night != before.push_night and _is_answer(after.push_night):
			args.clear()
			args.set_int("date", after.push_night_at)
			var night_granted: bool = after.push_night == CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
			MessageCore.show_toast(
				ReservedString.auth_push_night_granted() if night_granted else ReservedString.auth_push_night_denied(),
				args
			)
	_take_consent(after)
	return true


static func report_ad_consent(personalized: bool) -> bool:
	if not _check("report_ad_consent"):
		return false
	if _session == null:
		LogCore.log_error(_TAG, "report_ad_consent: no session")
		return false
	var choice: CoreContract.ConsentChoice = _choice_of(personalized)
	if choice == _session.consent.ad_personalization:
		return true
	var request: CoreContract.UpdateConsentRequest = _consent_request(choice, _session.consent.analytics)
	var life: RefCounted = _life
	var call: _CALL = await _send(request, true)
	if life != _life or call == null or not call.ok:
		return false
	var response: CoreContract.UpdateConsentResponse = call.response as CoreContract.UpdateConsentResponse
	_take_consent(response.consent if response != null else null)
	return true


## `UpdateConsent` with `ad_personalization`, `analytics` and the device tracking state. The caller passes the
## `ConsentUserState` value for `ad` when it did not ask; `analytics` is `UNSPECIFIED` while privacy choices are off.
static func _update_consent(ad: CoreContract.ConsentChoice, analytics: CoreContract.ConsentChoice) -> bool:
	var life: RefCounted = _life
	var call: _CALL = await _send(_consent_request(ad, analytics), false)
	if life != _life or call == null or not call.ok:
		return false
	var response: CoreContract.UpdateConsentResponse = call.response as CoreContract.UpdateConsentResponse
	_take_consent(response.consent if response != null else null)
	return true


static func _consent_request(
	ad: CoreContract.ConsentChoice, analytics: CoreContract.ConsentChoice
) -> CoreContract.UpdateConsentRequest:
	var request: CoreContract.UpdateConsentRequest = CoreContract.UpdateConsentRequest.new()
	request.privacy_version = _consent_version
	request.ad_personalization = ad
	request.analytics = analytics if _privacy_choices else CoreContract.ConsentChoice.CONSENT_CHOICE_UNSPECIFIED
	request.tracking = _tracking_state()
	return request


## Puts a response `consent` in the session and does consent apply.
static func _take_consent(consent: CoreContract.ConsentUserState) -> void:
	if consent == null or _session == null:
		return
	_session.consent = consent
	_apply_consent()


## Consent apply: tells `LogCore` the analytics consent and publishes `ConsentChangedEvent` when `ConsentInfo` changed.
static func _apply_consent() -> void:
	var info: ConsentInfo = _consent_info()
	LogCore.set_analytics_allowed(info.analytics_allowed)
	var before: ConsentInfo = _applied_consent if _applied_consent != null else ConsentInfo.new()
	_applied_consent = info
	if info.equals(before):
		return
	var event: ConsentChangedEvent = EventCore.acquire(ConsentChangedEvent) as ConsentChangedEvent
	event.consent = info
	EventCore.publish(event)


static func _consent_info() -> ConsentInfo:
	var consent: CoreContract.ConsentUserState = _session.consent
	var tracking: CoreContract.TrackingStatus = _tracking_state()
	var info: ConsentInfo = ConsentInfo.new()
	info.age_confirmed = consent.age_confirmed_at != 0
	info.age_from = consent.age_from
	info.age_to = consent.age_to
	info.child = consent.child
	info.below_consent_age = consent.below_consent_age
	info.ad_personalization_allowed = (
		consent.ad_personalization_allowed
		and (
			tracking == CoreContract.TrackingStatus.TRACKING_STATUS_AUTHORIZED
			or tracking == CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
		)
	)
	info.analytics_allowed = consent.analytics_allowed
	info.tracking = tracking
	info.push_ad = consent.push_ad
	info.push_night = consent.push_night
	return info


## Below the minimum age: server `auth` deleted the account.
static func _block_age() -> void:
	var life: RefCounted = _life
	var session: _SESSION = _session
	_session = null
	_clear_pending()
	var removed: _STORAGE.Outcome = await _storage_call(StorageOp.REMOVE)
	if life != _life:
		return
	if removed.status != _STORAGE.Status.OK and removed.status != _STORAGE.Status.NOT_FOUND:
		LogCore.log_error(_TAG, "age block: storage item was not removed")
	var marker: FileResult = LocalDataCore.write_file(_AGE_BLOCK_MARKER, PackedByteArray([_MARKER_BYTE]))
	if not marker.ok:
		LogCore.log_error(_TAG, "age block marker write %s" % _file_error_name(marker.error))
	if session != null:
		_end_session(SessionEndReason.AGE_BLOCKED)


## Birth year and month from the age popup; opens it again when it closes without confirm. 0 on failure.
static func _ask_birth_year_month() -> int:
	var life: RefCounted = _life
	while life == _life:
		var param: _POPUP_PARAM = _POPUP_PARAM.new()
		param.max_age_years = _max_age_years
		if not await _show_popup(_age_popup_key, param):
			if life == _life:
				LogCore.log_error(_TAG, "age popup did not open")
			return 0
		if param.confirmed and param.birth_year_month != 0:
			return param.birth_year_month
	return 0


## Opens the privacy popup or the push consent popup with `param` and waits. A close without confirm is two
## `DENIED`. `false` when it did not open.
static func _ask_choices(key: String, param: _POPUP_PARAM) -> bool:
	var life: RefCounted = _life
	if not await _show_popup(key, param):
		if life == _life:
			LogCore.log_error(_TAG, "consent popup %s did not open" % key)
		return false
	if not param.confirmed:
		param.first_on = false
		param.second_on = false
	return life == _life


static func _choice_of(on: bool) -> CoreContract.ConsentChoice:
	return CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED if on else CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED


static func _is_answer(choice: int) -> bool:
	return (
		choice == CoreContract.ConsentChoice.CONSENT_CHOICE_GRANTED
		or choice == CoreContract.ConsentChoice.CONSENT_CHOICE_DENIED
	)


## Device tracking state: the OS value on `ios`, `NOT_APPLICABLE` on other platforms.
static func _tracking_state() -> CoreContract.TrackingStatus:
	if _fake_tracking >= 0:
		return _fake_tracking as CoreContract.TrackingStatus
	if CoreBuildInfo.platform != "ios" or _tracking == null:
		return CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	return _tracking.get_status()


static func _request_tracking() -> void:
	if _fake_tracking >= 0 or _tracking == null:
		return
	var tracking: _TRACKING = _tracking
	var wait: _WAIT = _WAIT.new()
	_waits.append(wait)
	var job: Callable = func() -> void:
		await tracking.request()
		wait.finish()
	job.call()
	if not wait.finished:
		await wait.done
	_waits.erase(wait)


# --- account ---


static func link_account(provider: CoreContract.LoginProvider) -> LinkStatus:
	if not _check("link_account"):
		return LinkStatus.FAILED
	if not _is_social(provider):
		LogCore.log_error(_TAG, "link_account: not a social provider")
		return LinkStatus.FAILED
	if not _is_supported(provider):
		LogCore.log_error(_TAG, "link_account: the provider is not supported")
		return LinkStatus.FAILED
	var life: RefCounted = _life
	var signed: SocialAdapter.SignInResult = await _sign_in(provider)
	if life != _life:
		return LinkStatus.FAILED
	if signed.status == SocialAdapter.SignInStatus.CANCELLED:
		return LinkStatus.CANCELLED
	if signed.status != SocialAdapter.SignInStatus.SUCCESS:
		return LinkStatus.FAILED
	var request: CoreContract.LinkAccountRequest = CoreContract.LinkAccountRequest.new()
	request.provider = provider
	request.credential = signed.credential
	var call: _CALL = await _send(request, true)
	if life != _life or call == null:
		return LinkStatus.FAILED
	if not call.ok:
		if call.error_code == CoreContract.CoreError.CORE_ERROR_ALREADY_LINKED:
			return LinkStatus.ALREADY_LINKED
		return LinkStatus.FAILED
	var response: CoreContract.LinkAccountResponse = call.response as CoreContract.LinkAccountResponse
	if response == null or _session == null:
		return LinkStatus.FAILED
	_session.linked_providers = response.linked_providers
	var token: String = _session.login_token
	if _pending_token == token:
		_pending_linked = response.linked_providers
	if await _write_item(token, response.linked_providers):
		if life == _life and _pending_token == token:
			_clear_pending()
	elif life == _life:
		LogCore.log_error(_TAG, "link_account: storage item was not written again")
	return LinkStatus.SUCCESS


static func switch_account(provider: CoreContract.LoginProvider) -> LoginResult:
	if not _check("switch_account"):
		return _login_result(LoginStatus.FAILED)
	if not _is_social(provider):
		LogCore.log_error(_TAG, "switch_account: not a social provider")
		return _login_result(LoginStatus.FAILED)
	if not _is_supported(provider):
		LogCore.log_error(_TAG, "switch_account: the provider is not supported")
		return _login_result(LoginStatus.FAILED)
	if not _terms_agreed:
		LogCore.log_error(_TAG, "switch_account: prepare_terms has not returned Agreed")
		return _login_result(LoginStatus.FAILED)
	var life: RefCounted = _life
	var signed: SocialAdapter.SignInResult = await _sign_in(provider)
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if signed.status == SocialAdapter.SignInStatus.CANCELLED:
		return _login_result(LoginStatus.CANCELLED)
	if signed.status != SocialAdapter.SignInStatus.SUCCESS:
		return _login_result(LoginStatus.FAILED)
	var request: CoreContract.LoginRequest = CoreContract.LoginRequest.new()
	request.provider = provider
	request.credential = signed.credential
	request.agreements = _agreements()
	var sent: AuthSendResult = await _send_auth(request, "", false, "")
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if sent == null or not sent.ok:
		return _login_failure(sent)
	var response: CoreContract.LoginResponse = sent.response as CoreContract.LoginResponse
	if response == null or response.result == null:
		LogCore.log_error(_TAG, "switch_account: response has no result")
		return _login_result(LoginStatus.FAILED)
	var written: bool = await _write_item(response.result.login_token, response.result.linked_providers)
	if life != _life:
		return _login_result(LoginStatus.FAILED)
	if written:
		_clear_pending()
	_publish_session_ended(SessionEndReason.SWITCH)
	_request_restart()
	if not written:
		return _login_result(LoginStatus.FAILED)
	var result: LoginResult = _login_result(LoginStatus.SUCCESS)
	result.user_id = response.result.user_id
	result.public_code = response.result.public_code
	return result


static func logout() -> void:
	if not _check("logout"):
		return
	var life: RefCounted = _life
	await _send(CoreContract.LogoutRequest.new(), true)
	if life != _life:
		return
	await _forget_account(SessionEndReason.LOGOUT)


static func withdraw() -> bool:
	if not _check("withdraw"):
		return false
	var life: RefCounted = _life
	var call: _CALL = await _send(CoreContract.WithdrawRequest.new(), true)
	if life != _life or call == null or not call.ok:
		return false
	LocalDataCore.remove_value(LocalDataCore.FileKind.DEVICE, _KEY_TERMS_VERSION)
	LocalDataCore.remove_value(LocalDataCore.FileKind.DEVICE, _KEY_PRIVACY_TERMS_VERSION)
	await _forget_account(SessionEndReason.WITHDRAW)
	return true


## Logout and withdrawal: removes the storage item, the pending token and the session, then asks for a restart.
static func _forget_account(reason: SessionEndReason) -> void:
	var life: RefCounted = _life
	_clear_pending()
	var removed: _STORAGE.Outcome = await _storage_call(StorageOp.REMOVE)
	if life != _life:
		return
	if removed.status != _STORAGE.Status.OK and removed.status != _STORAGE.Status.NOT_FOUND:
		LogCore.log_error(_TAG, "storage item was not removed")
	_end_session(reason)
	_request_restart()


static func issue_deletion_code() -> DeletionCodeResult:
	if not _check("issue_deletion_code"):
		return DeletionCodeResult.new()
	var life: RefCounted = _life
	var request: CoreContract.IssueDeletionCodeRequest = CoreContract.IssueDeletionCodeRequest.new()
	var response: CoreContract.IssueDeletionCodeResponse = null
	if _session != null:
		var call: _CALL = await _send(request, true)
		if life != _life or call == null or not call.ok:
			return DeletionCodeResult.new()
		response = call.response as CoreContract.IssueDeletionCodeResponse
	elif _ban_session != null:
		var sent: AuthSendResult = await _send_auth(request, _ban_session.access_token, true, _ban_session.signing_key)
		if life != _life or sent == null or not sent.ok:
			return DeletionCodeResult.new()
		response = sent.response as CoreContract.IssueDeletionCodeResponse
	else:
		LogCore.log_error(_TAG, "issue_deletion_code: no session and no ban session")
		return DeletionCodeResult.new()
	var result: DeletionCodeResult = DeletionCodeResult.new()
	if response == null:
		return result
	result.ok = true
	result.code = response.code
	result.expires_at = response.expires_at
	result.url = response.url
	return result


## Ends the session: clears it and the consent, removes the `SessionProvider` and publishes `SessionEndedEvent`.
static func _end_session(reason: SessionEndReason) -> void:
	_session = null
	_provider = null
	_refresh_wait = null
	_applied_consent = null
	NetworkCore.set_session_provider(null)
	LogCore.set_analytics_allowed(false)
	_publish_session_ended(reason)


static func _publish_session_ended(reason: SessionEndReason) -> void:
	var event: SessionEndedEvent = EventCore.acquire(SessionEndedEvent) as SessionEndedEvent
	event.reason = reason
	EventCore.publish(event)


static func _request_restart() -> void:
	var event: RestartRequestedEvent = EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	event.module = _TAG
	EventCore.publish(event)


# --- awaited steps ---


## Sends an auth request with `NetworkCore.send_auth`. `null` when `release` cut the wait short.
static func _send_auth(request: ContractRequest, authorization: String, sign: bool, signing_key: String) -> AuthSendResult:
	var options: AuthSendOptions = AuthSendOptions.new()
	options.authorization = authorization
	options.sign = sign
	options.signing_key = signing_key
	var wait: _WAIT = _WAIT.new()
	_waits.append(wait)
	var job: Callable = func() -> void:
		var sent: AuthSendResult = await NetworkCore.send_auth(request, options)
		wait.finish(sent)
	job.call()
	if not wait.finished:
		await wait.done
	_waits.erase(wait)
	return wait.result as AuthSendResult


## Sends a session request with `NetworkCore.send`. `handled` is what the failure callback returns. `null` when
## `release` cut the wait short.
static func _send(request: ContractRequest, handled: bool) -> _CALL:
	var call: _CALL = _CALL.new(handled)
	var wait: _WAIT = _WAIT.new()
	_waits.append(wait)
	var job: Callable = func() -> void:
		call.ok = await NetworkCore.send(request, call.on_success, call.on_failure)
		wait.finish(call)
	job.call()
	if not wait.finished:
		await wait.done
	_waits.erase(wait)
	return wait.result as _CALL


static func _sign_in(provider: int) -> SocialAdapter.SignInResult:
	var adapter: SocialAdapter = _social_adapters[provider] if _social_adapters.has(provider) else null
	if adapter == null:
		return SocialAdapter.SignInResult.new()
	var wait: _WAIT = _WAIT.new()
	_waits.append(wait)
	var job: Callable = func() -> void:
		var signed: SocialAdapter.SignInResult = await adapter.sign_in()
		wait.finish(signed)
	job.call()
	if not wait.finished:
		await wait.done
	_waits.erase(wait)
	if not wait.result is SocialAdapter.SignInResult:
		return SocialAdapter.SignInResult.new()
	return wait.result as SocialAdapter.SignInResult


## Opens a core popup with `UICore.open_popup` and waits until it closes. `false` when it did not open.
static func _show_popup(key: String, param: _POPUP_PARAM) -> bool:
	var life: RefCounted = _life
	var popup_wait: _POPUP_WAIT = _POPUP_WAIT.new()
	param.on_result = popup_wait.on_result
	_popup_waits.append(popup_wait)
	var opened: UICore.PopupOpenResult = await UICore.open_popup(key, param, popup_wait.on_hidden)
	if life != _life or opened != UICore.PopupOpenResult.OPENED:
		_popup_waits.erase(popup_wait)
		return false
	if not popup_wait.finished:
		await popup_wait.done
	_popup_waits.erase(popup_wait)
	return life == _life


## Opens a system popup with one button per label and waits until it closes. `back` is the back button index or -1.
static func _choose(body: String, labels: PackedStringArray, back: int) -> Choice:
	var life: RefCounted = _life
	var popup_wait: _POPUP_WAIT = _POPUP_WAIT.new()
	var callbacks: Array[Callable] = [popup_wait.on_button_0, popup_wait.on_button_1, popup_wait.on_button_2]
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = body
	for i: int in labels.size():
		var button: SystemPopupButton = SystemPopupButton.new()
		button.label = labels[i]
		button.callback = callbacks[i]
		param.buttons.append(button)
	param.back_button = back
	_popup_waits.append(popup_wait)
	var opened: bool = await UICore.open_system_popup(param, popup_wait.on_hidden)
	if life != _life or not opened:
		_popup_waits.erase(popup_wait)
		return Choice.NOT_OPENED if life == _life else Choice.HIDDEN
	if not popup_wait.finished:
		await popup_wait.done
	_popup_waits.erase(popup_wait)
	match popup_wait.choice:
		0:
			return Choice.FIRST
		1:
			return Choice.SECOND
	return Choice.HIDDEN


## Asks the browser to keep the storage of this origin. `false` when the request cannot be made.
static func _request_persist() -> bool:
	if _test_persist_requester.is_valid():
		return _test_persist_requester.call() == true
	return _WEB_STORAGE.request_persist()


## Opens `url` with the OS. `true` when it opened.
static func _open_url(url: String) -> bool:
	if _test_url_opener.is_valid():
		return _test_url_opener.call(url) == true
	return OS.shell_open(url) == OK


static func _login_result(status: LoginStatus) -> LoginResult:
	var result: LoginResult = LoginResult.new()
	result.status = status
	return result


static func _is_provider(provider: int) -> bool:
	return provider == CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST or _is_social(provider)


static func _is_social(provider: int) -> bool:
	return (
		provider == CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE
		or provider == CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE
	)
