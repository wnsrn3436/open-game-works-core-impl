class_name UserStateCoreDev
extends RefCounted
## DEV operations of `UserStateCore`.


## The cache as a JSON object in the form of the `user_state` of server `admin-api` `get_user`: the kind name in
## snake_case as the key, a single kind as its proto3 JSON object, a list kind as the array of its objects in `id`
## order. A kind with no object is left out. With `kind`, only that kind. An empty string on failure.
static func export_json(kind: GDScript = null) -> String:
	if not UserStateCore._is_initialized:
		LogCore.log_error(UserStateCore._TAG, "export_json: not initialized")
		return ""
	if kind != null and not UserStateCore._kinds_by_class.has(kind):
		LogCore.log_error(UserStateCore._TAG, "export_json: the kind is not a UserState kind of this build")
		return ""
	var parts: PackedStringArray = PackedStringArray()
	for cache: UserStateCore._KIND_CACHE in UserStateCore._kind_list:
		if kind != null and cache.kind_class != kind:
			continue
		var key: String = JSON.stringify(_snake_case(cache.name)) + ":"
		if not cache.is_list:
			if cache.single != null:
				parts.append(key + ContractJsonDev.to_json(cache.single))
			continue
		if cache.objects.is_empty():
			continue
		var ids: Array[int] = cache.objects.keys()
		ids.sort()
		var items: PackedStringArray = PackedStringArray()
		for id: int in ids:
			items.append(ContractJsonDev.to_json(cache.objects[id]))
		parts.append(key + "[" + ",".join(items) + "]")
	return "{" + ",".join(parts) + "}"


## Applies a delta the way `UserStateCore.apply_delta` applies a response's `user_state`. Core tests prepare the
## UserState with it.
static func apply_test_delta(delta: CoreContract.UserStateDelta) -> bool:
	if not UserStateCore._is_initialized:
		LogCore.log_error(UserStateCore._TAG, "apply_test_delta: not initialized")
		return false
	return UserStateCore._apply(delta, UserStateCore.DeltaSource.RESPONSE)


## `QuestUserState` → `quest_user_state`, as the contract tool names the kind keys.
static func _snake_case(kind_name: String) -> String:
	var out: String = ""
	for i: int in kind_name.length():
		var letter: String = kind_name[i]
		if i > 0 and letter != letter.to_lower():
			out += "_"
		out += letter.to_lower()
	return out
