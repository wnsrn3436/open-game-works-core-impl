extends UnitTestCase
## The launch value file of the page in the web shell (`core/web/ogw-shell.html`): only a DEV export, whose page sets
## `window.ogwDevExport` to `true`, reads the query parameter `ogw_launch_values`; an STG or PROD export starts as a page
## without it. The browser run is a DEV export, so the test fetches the page it runs in, takes the shell's
## `preloadLaunchValues` (the `ogw:launch-values` region) from it, and runs that code against a page with and without
## the marker, a `fetch` that answers the given HTTP status and an engine that counts the preloaded files.

## Runs the cases of `_CASES` and puts their results as JSON text into `window.__ogwShellTest`.
const _RUN: String = """(function(cases){window.__ogwShellTest=null;
fetch(window.location.pathname,{cache:"no-store"}).then(function(r){return r.text();}).then(function(html){
var b=html.indexOf("// ogw:launch-values begin");var e=html.indexOf("// ogw:launch-values end");
if(b<0||e<b){throw new Error("the page has no ogw:launch-values region");}var src=html.slice(b,e);
return Promise.all(cases.map(function(c){var calls={fetches:0,preloads:0};var origin=window.location.origin;
var w={location:{search:c.search,href:origin+"/app/index.html"+c.search,origin:origin}};
if(c.dev!==null){w.ogwDevExport=c.dev;}
var f=function(){calls.fetches++;return Promise.resolve({ok:c.status===200,status:c.status,
arrayBuffer:function(){return Promise.resolve(new ArrayBuffer(2));}});};
var en={preloadFile:function(){calls.preloads++;return Promise.resolve();}};
var p=new Function("window","engine","fetch",src+"\\nreturn preloadLaunchValues();")(w,en,f);
return p.then(function(a){return {args:a,error:"",fetches:calls.fetches,preloads:calls.preloads};},
function(err){return {args:[],error:String(err&&err.message),fetches:calls.fetches,preloads:calls.preloads};});}));
}).then(function(rs){window.__ogwShellTest=JSON.stringify({results:rs,error:""});},
function(err){window.__ogwShellTest=JSON.stringify({results:[],error:String(err&&err.message)});});
return "0";})(%s)"""
const _RESULT: String = """(window.__ogwShellTest===null||window.__ogwShellTest===undefined)?"":window.__ogwShellTest"""
const _PUT_BACK: String = """(function(){delete window.__ogwShellTest;return "0";})()"""
## Longest wait for the cases to end.
const _LIMIT_MS: int = 10000
const _ARGS: Array = ["--launch-values=/tmp/ogw_launch_values.json"]


func after_each() -> void:
	if OS.get_name() == "Web":
		_js(_PUT_BACK)
	await super()


# ogw:input_boundary
func _js(code: String) -> String:
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return ""


## Runs `cases` (`dev`: the `window.ogwDevExport` of the page, null when the page does not set it; `search`: the query
## of the page URL; `status`: the HTTP status `fetch` answers) and returns their results in order. Async.
func _run_cases(cases: Array) -> Array:
	assert_eq(_js(_RUN % JSON.stringify(cases)), "0")
	var until: int = Time.get_ticks_msec() + _LIMIT_MS
	while _js(_RESULT).is_empty() and Time.get_ticks_msec() < until:
		await UnitTestCore.wait_frames(1)
	var parsed: Variant = JSON.parse_string(_js(_RESULT))
	if not parsed is Dictionary:
		fail_test("the cases did not end within %d ms" % _LIMIT_MS)
		return []
	var reply: Dictionary = parsed
	assert_eq(str(reply.get("error", "")), "", "the shell code was taken from the page")
	var results: Array = reply.get("results", [])
	assert_eq(results.size(), cases.size())
	return results


func _check(result: Dictionary, args: Array, error: String, fetches: int, preloads: int, label: String) -> void:
	assert_eq(result.get("args", []), args, label)
	assert_eq(str(result.get("error", "")), error, label)
	assert_eq(int(result.get("fetches", -1)), fetches, label + ": fetches")
	assert_eq(int(result.get("preloads", -1)), preloads, label + ": preloaded files")


func test_page_of_the_browser_run_is_a_dev_export() -> void:
	if not UnitTestCore.require_platform(PackedStringArray(["web"])) or OS.get_name() != "Web":
		return
	assert_eq(_js("String(window.ogwDevExport)"), "true", "the DEV export sets the marker before the shell runs")


func test_export_without_the_marker_ignores_the_launch_value_parameter() -> void:
	if not UnitTestCore.require_platform(PackedStringArray(["web"])) or OS.get_name() != "Web":
		return
	var results: Array = await _run_cases([
		{"dev": null, "search": "?ogw_launch_values=x", "status": 200},
		{"dev": null, "search": "?ogw_launch_values=/missing.json", "status": 404},
		{"dev": null, "search": "?ogw_launch_values=/values.json", "status": 200},
		{"dev": false, "search": "?ogw_launch_values=/values.json", "status": 200},
		{"dev": "true", "search": "?ogw_launch_values=/values.json", "status": 200},
	])
	if results.size() != 5:
		return
	_check(results[0], [], "", 0, 0, "not a URL path, no marker")
	_check(results[1], [], "", 0, 0, "a file that cannot be fetched, no marker")
	_check(results[2], [], "", 0, 0, "an existing file, no marker")
	_check(results[3], [], "", 0, 0, "an existing file, marker false")
	_check(results[4], [], "", 0, 0, "an existing file, marker the text true")


func test_dev_export_reads_the_launch_value_parameter() -> void:
	if not UnitTestCore.require_platform(PackedStringArray(["web"])) or OS.get_name() != "Web":
		return
	var results: Array = await _run_cases([
		{"dev": true, "search": "?ogw_launch_values=/values.json", "status": 200},
		{"dev": true, "search": "?ogw_launch_values=/missing.json", "status": 404},
		{"dev": true, "search": "?ogw_launch_values=x", "status": 200},
		{"dev": true, "search": "", "status": 200},
	])
	if results.size() != 4:
		return
	_check(results[0], _ARGS, "", 1, 1, "an existing file")
	_check(results[1], [], "launch value file /missing.json could not be read: HTTP 404", 1, 0, "a missing file")
	_check(results[2], [], "ogw_launch_values is not a URL path on the origin of the page: x", 0, 0, "not a URL path")
	_check(results[3], [], "", 0, 0, "no parameter")
