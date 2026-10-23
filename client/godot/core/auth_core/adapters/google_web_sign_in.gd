extends RefCounted
## Google sign-in of the browser runtime: Google Identity Services gives an ID token for the server client ID. The
## page script keeps its state in `window.__ogwGoogle`, which this object reads once a frame.

const _START: String = """(function(){var s=window.__ogwGoogle={state:0,token:"",owner:%s};var id=%s;
function done(v){if(s.state===0){s.state=v;}}
function run(){try{google.accounts.id.initialize({client_id:id,callback:function(r){if(r&&r.credential){s.token=r.credential;done(1);}else{done(3);}}});
google.accounts.id.prompt(function(n){if(n.isNotDisplayed()){done(3);}else if(n.isSkippedMoment()){done(2);}
else if(n.isDismissedMoment()&&n.getDismissedReason()!=="credential_returned"){done(2);}});}catch(e){done(3);}}
if(window.google&&google.accounts&&google.accounts.id){run();}else{var t=document.createElement("script");
t.src="https://accounts.google.com/gsi/client";t.async=true;t.onload=run;t.onerror=function(){done(3);};document.head.appendChild(t);}
return "0";})()"""
const _POLL: String = """(function(){var s=window.__ogwGoogle;if(!s){return "3";}return String(s.state)+s.token;})()"""
## Removes the page state when its `owner` is the text that fills `%s`: a later sign-in's state stays.
const _DROP: String = """(function(){var s=window.__ogwGoogle;if(s&&s.owner===%s){delete window.__ogwGoogle;}
return "0";})()"""

## True after `stop`: the wait ends with `FAILED`.
var _stopped: bool = false


## Ends a running `sign_in` with `FAILED` at its next frame.
func stop() -> void:
	_stopped = true


func sign_in(client_id: String) -> SocialAdapter.SignInResult:
	var owner: String = JSON.stringify(str(get_instance_id()))
	if client_id.is_empty() or _eval(_START % [owner, JSON.stringify(client_id)]) != "0":
		return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.FAILED)
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	while tree != null:
		await tree.process_frame
		if _stopped:
			break
		var reply: String = _eval(_POLL)
		var state: String = reply.substr(0, 1)
		if state == "1" and reply.length() > 1:
			_eval(_DROP % owner)
			return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.SUCCESS, reply.substr(1))
		if state == "2":
			return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.CANCELLED)
		if state != "0":
			return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.FAILED)
	# The page state goes with the wait: a later sign-in starts a new one, and a late credential is not kept.
	_eval(_DROP % owner)
	return SocialAdapter.SignInResult.new(SocialAdapter.SignInStatus.FAILED)


# ogw:input_boundary
func _eval(code: String) -> String:
	var reply: Variant = JavaScriptBridge.eval(code, true)
	if reply is String:
		var text: String = reply
		return text
	return "3"
