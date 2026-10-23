extends "res://core/auth_core/adapters/token_storage.gd"
## Login token storage of the browser runtime: `window.localStorage` of the game origin, key `ogw.<name>`.

const _KEY_PREFIX: String = "ogw."


func read_item(name: String) -> Outcome:
	var reply: String = _eval(
		"(function(){try{var v=window.localStorage.getItem(%s);return v===null?\"1\":\"0\"+v;}catch(e){return \"4\";}})()"
		% JSON.stringify(_KEY_PREFIX + name)
	)
	return _outcome(reply)


func write_item(name: String, text: String) -> Outcome:
	var reply: String = _eval(
		"(function(){try{window.localStorage.setItem(%s,%s);return \"0\";}catch(e){return \"4\";}})()"
		% [JSON.stringify(_KEY_PREFIX + name), JSON.stringify(text)]
	)
	return _outcome(reply)


func remove_item(name: String) -> Outcome:
	var reply: String = _eval(
		(
			"(function(){try{var k=%s;if(window.localStorage.getItem(k)===null){return \"1\";}"
			+ "window.localStorage.removeItem(k);return \"0\";}catch(e){return \"4\";}})()"
		)
		% JSON.stringify(_KEY_PREFIX + name)
	)
	return _outcome(reply)


## Asks the browser not to clear the storage of this origin by itself. Does not wait for the answer. `false` when
## the request cannot be made.
static func request_persist() -> bool:
	if OS.get_name() != "Web":
		return false
	return _eval(
		"(function(){try{if(navigator.storage&&navigator.storage.persist){navigator.storage.persist();return \"0\";}}"
		+ "catch(e){}return \"4\";})()"
	) == "0"


# ogw:input_boundary
static func _eval(code: String) -> String:
	if OS.get_name() != "Web":
		return "3"
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return "4"


func _outcome(reply: String) -> Outcome:
	if reply.is_empty():
		return Outcome.new(Status.FAILED)
	var code: String = reply.substr(0, 1)
	if code == "0":
		return Outcome.new(Status.OK, reply.substr(1))
	if code == "1":
		return Outcome.new(Status.NOT_FOUND)
	if code == "3":
		return Outcome.new(Status.UNSUPPORTED)
	return Outcome.new(Status.FAILED)
