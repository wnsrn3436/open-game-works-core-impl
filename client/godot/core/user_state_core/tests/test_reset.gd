extends "res://core/user_state_core/tests/support/user_state_test_case.gd"
## Counts with a reset, mission progress, the live event round reset, offers, periods, live event rounds and the
## core test fixtures `live-event-round` and `attendance-progress`.

const RESET_AT: int = 1720000000000
const HOUR: int = 3600000
const MINUTE: int = 60000
# Round 2 starts of the live events of the core test data.
const SHOP_EVENT_ROUND_2: int = 1800144000000
const IAP_EVENT_ROUND_2: int = 1768176000000
const MISSION_EVENT_ROUND_2: int = 1802044800000
const ATTENDANCE_EVENT_ROUND_2: int = 1804464000000
const OFFER_EVENT_ROUND_1: int = 1800057600000
const OFFER_EVENT_ROUND_2: int = 1800662400000
## End of `[live_event_once]`.
const ONCE_END: int = 1798848000000


func shop_state(count: int, reset_at: int, event_round: int = 0) -> CoreContract.ShopPurchaseUserState:
	var state: CoreContract.ShopPurchaseUserState = CoreContract.ShopPurchaseUserState.new()
	state.count = count
	state.reset_at = reset_at
	state.event_round = event_round
	return state


func iap_state(count: int, reset_at: int, event_round: int = 0) -> CoreContract.IapPurchaseUserState:
	var state: CoreContract.IapPurchaseUserState = CoreContract.IapPurchaseUserState.new()
	state.count = count
	state.reset_at = reset_at
	state.event_round = event_round
	return state


func mission_state(progress: int, claimed: bool, reset_at: int, event_round: int = 0) -> CoreContract.MissionProgressUserState:
	var state: CoreContract.MissionProgressUserState = CoreContract.MissionProgressUserState.new()
	state.progress = progress
	state.claimed = claimed
	state.reset_at = reset_at
	state.event_round = event_round
	return state


func put_shop(id_name: String, state: CoreContract.ShopPurchaseUserState) -> int:
	var id: int = id_of(id_name)
	state.id = id
	put_state("ShopPurchaseUserState", id, state)
	return id


func put_iap(id_name: String, state: CoreContract.IapPurchaseUserState) -> int:
	var id: int = id_of(id_name)
	state.id = id
	put_state("IapPurchaseUserState", id, state)
	return id


func put_mission(id_name: String, state: CoreContract.MissionProgressUserState) -> int:
	var id: int = id_of(id_name)
	state.id = id
	put_state("MissionProgressUserState", id, state)
	return id


func put_offer(id_name: String, started_at: int, trigger_count: int) -> int:
	var state: CoreContract.OfferUserState = CoreContract.OfferUserState.new()
	state.id = id_of(id_name)
	state.started_at = started_at
	state.trigger_count = trigger_count
	put_state("OfferUserState", state.id, state)
	return state.id


func test_counts_reset_when_reset_at_is_reached() -> void:
	await start()
	var shop: int = put_shop("[shop_daily]", shop_state(2, RESET_AT))
	var iap: int = put_iap("[iap_daily_pack]", iap_state(3, RESET_AT))
	var ad: CoreContract.AdRewardCountUserState = CoreContract.AdRewardCountUserState.new()
	ad.id = id_of("[ad_rewarded_daily]")
	ad.count = 4
	ad.reset_at = RESET_AT
	put_state("AdRewardCountUserState", ad.id, ad)
	var counter: CoreContract.ResetCounterUserState = CoreContract.ResetCounterUserState.new()
	counter.id = id_of("[reset_counter_daily]")
	counter.count = 5
	counter.reset_at = RESET_AT
	put_state("ResetCounterUserState", counter.id, counter)
	sync_to(RESET_AT + MARGIN_MS - 1)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 2)
	assert_eq(UserStateCore.get_iap_purchase_count(iap), 3)
	assert_eq(UserStateCore.get_ad_reward_count(ad.id), 4)
	assert_eq(UserStateCore.get_reset_counter(counter.id), 5)
	sync_to(RESET_AT + MARGIN_MS)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 0)
	assert_eq(UserStateCore.get_iap_purchase_count(iap), 0)
	assert_eq(UserStateCore.get_ad_reward_count(ad.id), 0)
	assert_eq(UserStateCore.get_reset_counter(counter.id), 0)


func test_counts_without_reset_at_and_without_an_object() -> void:
	await start()
	var shop: int = put_shop("[shop_once]", shop_state(1, 0))
	sync_to(RESET_AT * 2)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 1, "reset_at 0 never resets")
	assert_eq(UserStateCore.get_shop_purchase_count(id_of("[shop_basic]")), 0, "no object")
	assert_eq(UserStateCore.get_reset_counter(id_of("[reset_counter_never]")), 0)


func test_mission_progress_resets_before_reset_at() -> void:
	await start()
	var mission: int = put_mission("[mission_sum_daily]", mission_state(7, true, RESET_AT))
	sync_to(RESET_AT - MARGIN_MS - 1)
	var progress: GetMissionProgressResult = UserStateCore.get_mission_progress(mission)
	assert_eq([progress.progress, progress.claimed], [7, true])
	sync_to(RESET_AT - MARGIN_MS)
	progress = UserStateCore.get_mission_progress(mission)
	assert_eq([progress.progress, progress.claimed], [0, false])
	progress = UserStateCore.get_mission_progress(id_of("[mission_sum_forever]"))
	assert_eq([progress.progress, progress.claimed], [0, false], "no object")


func test_the_round_reset_of_a_repeated_live_event() -> void:
	await start()
	var shop: int = put_shop("[shop_event_pack]", shop_state(1, 0, 1))
	var consumable: int = put_iap("[iap_event_pack]", iap_state(1, 0, 1))
	var non_consumable: int = put_iap("[iap_event_unlock]", iap_state(1, 0, 1))
	var mission: int = put_mission("[mission_event]", mission_state(2, true, 0, 1))
	var calendar: int = id_of("[attendance_event_once]")
	var attendance: CoreContract.AttendanceUserState = CoreContract.AttendanceUserState.new()
	attendance.id = calendar
	attendance.day = 2
	attendance.claimed_day_number = 20879
	attendance.event_round = 1
	put_state("AttendanceUserState", calendar, attendance)
	# Between round 1 and round 2, and one ms before round 2 is reached: the stored values.
	for at: int in [SHOP_EVENT_ROUND_2 - HOUR, SHOP_EVENT_ROUND_2 + MARGIN_MS - 1]:
		sync_to(at)
		assert_eq(UserStateCore.get_shop_purchase_count(shop), 1, "shop at %d" % at)
	for at: int in [IAP_EVENT_ROUND_2 - HOUR, IAP_EVENT_ROUND_2 + MARGIN_MS - 1]:
		sync_to(at)
		assert_eq(UserStateCore.get_iap_purchase_count(consumable), 1, "Consumable at %d" % at)
	for at: int in [MISSION_EVENT_ROUND_2 - HOUR, MISSION_EVENT_ROUND_2 + MARGIN_MS - 1]:
		sync_to(at)
		var stored: GetMissionProgressResult = UserStateCore.get_mission_progress(mission)
		assert_eq([stored.progress, stored.claimed], [2, true], "mission at %d" % at)
	for at: int in [ATTENDANCE_EVENT_ROUND_2 - HOUR, ATTENDANCE_EVENT_ROUND_2 + MARGIN_MS - 1]:
		sync_to(at)
		var between: GetAttendanceResult = UserStateCore.get_attendance(calendar)
		assert_eq([between.day, between.next_day], [2, 0], "attendance at %d" % at)
	# Round 2 is reached: the values start again.
	sync_to(SHOP_EVENT_ROUND_2 + MARGIN_MS)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 0)
	sync_to(IAP_EVENT_ROUND_2 + MARGIN_MS)
	assert_eq(UserStateCore.get_iap_purchase_count(consumable), 0)
	assert_eq(UserStateCore.get_iap_purchase_count(non_consumable), 1, "NonConsumable has no round reset")
	sync_to(MISSION_EVENT_ROUND_2 + MARGIN_MS)
	var reset: GetMissionProgressResult = UserStateCore.get_mission_progress(mission)
	assert_eq([reset.progress, reset.claimed], [0, false])
	sync_to(ATTENDANCE_EVENT_ROUND_2 + MARGIN_MS)
	var again: GetAttendanceResult = UserStateCore.get_attendance(calendar)
	assert_eq([again.day, again.next_day], [0, 1])


func test_the_round_reset_of_an_offer() -> void:
	await start()
	var offer: int = id_of("[offer_event]")
	var state: CoreContract.OfferUserState = CoreContract.OfferUserState.new()
	state.id = offer
	state.started_at = OFFER_EVENT_ROUND_1 + 1000
	state.trigger_count = 1
	state.event_round = 1
	put_state("OfferUserState", offer, state)
	sync_to(OFFER_EVENT_ROUND_1 + 30 * HOUR)
	assert_eq(UserStateCore.get_offer_ends_at(offer), OFFER_EVENT_ROUND_1 + 1000 + HOUR, "between the rounds")
	assert_false(UserStateCore.is_offer_active(offer))
	sync_to(OFFER_EVENT_ROUND_2 + MARGIN_MS - 1)
	assert_eq(UserStateCore.get_offer_ends_at(offer), OFFER_EVENT_ROUND_1 + 1000 + HOUR)
	sync_to(OFFER_EVENT_ROUND_2 + MARGIN_MS)
	assert_eq(UserStateCore.get_offer_ends_at(offer), 0, "round 2")
	assert_false(UserStateCore.is_offer_active(offer))


func test_an_offer_is_active_before_its_end() -> void:
	var started_at: int = RESET_AT
	await start()
	var offer: int = id_of("[offer_basic]")
	var state: CoreContract.OfferUserState = CoreContract.OfferUserState.new()
	state.id = offer
	state.started_at = started_at
	state.trigger_count = 1
	put_state("OfferUserState", offer, state)
	sync_to(started_at + HOUR - MARGIN_MS - 1)
	assert_true(UserStateCore.is_offer_active(offer))
	assert_eq(UserStateCore.get_offer_ends_at(offer), started_at + HOUR)
	sync_to(started_at + HOUR - MARGIN_MS)
	assert_false(UserStateCore.is_offer_active(offer))
	assert_eq(UserStateCore.get_offer_ends_at(offer), started_at + HOUR, "the end time stays")
	sync_to(started_at + 50 * HOUR)
	assert_eq(UserStateCore.get_offer_ends_at(offer), started_at + HOUR)
	state.trigger_count = 0
	put_state("OfferUserState", offer, state)
	assert_eq(UserStateCore.get_offer_ends_at(offer), 0, "trigger_count 0 reads as no state")
	assert_eq(UserStateCore.get_offer_ends_at(id_of("[offer_window]")), 0, "never triggered")


func test_an_offer_product_count_resets_when_the_offer_is_triggered_again() -> void:
	var first_start: int = RESET_AT
	var shop_first_end: int = first_start + HOUR
	var iap_first_end: int = first_start + 24 * HOUR
	await start()
	var shop: int = put_shop("[shop_offer_pack]", shop_state(1, shop_first_end))
	var iap: int = put_iap("[iap_offer_pack]", iap_state(1, iap_first_end))
	put_offer("[shop_offer]", first_start, 1)
	put_offer("[offer_iap]", first_start, 1)
	sync_to(first_start + 30 * MINUTE)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 1, "shop: reset_at is the offer end time")
	assert_eq(UserStateCore.get_iap_purchase_count(iap), 1, "iap: reset_at is the offer end time")
	# Triggered again before the first end time: the offer end time moves and the stored reset_at is not it.
	put_offer("[shop_offer]", first_start + 15 * MINUTE, 2)
	put_offer("[offer_iap]", first_start + 15 * MINUTE, 2)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 0, "shop: offer triggered again")
	assert_eq(UserStateCore.get_iap_purchase_count(iap), 0, "iap: offer triggered again")


func test_an_offer_product_count_resets_when_the_offer_reads_as_not_triggered() -> void:
	var first_start: int = RESET_AT
	await start()
	var shop: int = put_shop("[shop_offer_pack]", shop_state(1, first_start + HOUR))
	var iap: int = put_iap("[iap_offer_pack]", iap_state(1, first_start + 24 * HOUR))
	sync_to(first_start + 30 * MINUTE)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 0, "shop: no offer state")
	assert_eq(UserStateCore.get_iap_purchase_count(iap), 0, "iap: no offer state")
	put_offer("[shop_offer]", first_start, 0)
	put_offer("[offer_iap]", first_start, 0)
	assert_eq(UserStateCore.get_shop_purchase_count(shop), 0, "shop: trigger_count 0")
	assert_eq(UserStateCore.get_iap_purchase_count(iap), 0, "iap: trigger_count 0")


func test_is_in_period() -> void:
	var end: int = RESET_AT
	await start()
	sync_to(end - MARGIN_MS - 1)
	assert_true(UserStateCore.is_in_period(0, end, 0))
	assert_true(UserStateCore.is_in_period(0, 0, 0))
	sync_to(end - MARGIN_MS)
	assert_false(UserStateCore.is_in_period(0, end, 0))
	assert_false(UserStateCore.is_in_period(end + 1, 0, 0), "start_at not reached")
	assert_true(UserStateCore.is_in_period(end - MARGIN_MS * 2, 0, 0), "start_at reached")
	assert_false(UserStateCore.is_in_period(0, 0, id_of("[live_event_once]")), "no active round")
	sync_to(ONCE_END - 2 * HOUR)
	assert_true(UserStateCore.is_in_period(0, 0, id_of("[live_event_once]")), "an active round")


func test_a_round_ends_margin_before_its_end_time() -> void:
	await start()
	var event: int = id_of("[live_event_once]")
	sync_to(ONCE_END - MARGIN_MS - 1)
	var active: GetLiveEventRoundResult = UserStateCore.get_live_event_round(event)
	assert_eq([active.round, active.end_at], [1, ONCE_END])
	sync_to(ONCE_END - MARGIN_MS)
	var ended: GetLiveEventRoundResult = UserStateCore.get_live_event_round(event)
	assert_eq([ended.round, ended.start_at, ended.end_at], [0, 0, 0])


func test_a_live_event_not_in_the_table() -> void:
	await start()
	var missing: GetLiveEventRoundResult = UserStateCore.get_live_event_round(987654321)
	assert_eq([missing.round, missing.start_at, missing.end_at], [0, 0, 0])
	assert_eq(UserStateCore.get_live_event_round(987654321).round, 0)
	assert_eq(errors(), 1, "one error log per ID value")
	assert_eq(UserStateCore.get_live_event_round(987654322).round, 0)
	assert_eq(errors(), 1)


## Core test fixture `live-event-round`: the event and the server time, and the expected `get_round`.
func test_core_fixture_live_event_round() -> void:
	set_int("TimeCore.reachMarginMs", 0)
	await start()
	assert_gt(_run_round_fixture(), 0, "cases")


## Core test fixture `attendance-progress`: the calendar, its `AttendanceUserState` or none and the server time, and
## the expected `day` and `next_day`.
func test_core_fixture_attendance_progress() -> void:
	set_int("TimeCore.reachMarginMs", 0)
	await start()
	assert_gt(_run_attendance_fixture(), 0, "cases")


# ogw:input_boundary
func _run_round_fixture() -> int:
	var cases: PackedStringArray = fixture_cases("live-event-round")
	for text: String in cases:
		var case: Dictionary = JSON.parse_string(text)
		var input: Dictionary = case["input"]
		var expected: Dictionary = case["expected"]
		var case_name: String = case["name"]
		sync_to(json_int(input["time"]))
		var round_now: GetLiveEventRoundResult = UserStateCore.get_live_event_round(id_of(str(input["event"])))
		assert_eq(round_now.round, json_int(expected["round"]), case_name + ": round")
		assert_eq(round_now.start_at, json_int(expected["start_at"]), case_name + ": start_at")
		assert_eq(round_now.end_at, json_int(expected["end_at"]), case_name + ": end_at")
	return cases.size()


# ogw:input_boundary
func _run_attendance_fixture() -> int:
	var cases: PackedStringArray = fixture_cases("attendance-progress")
	for text: String in cases:
		var case: Dictionary = JSON.parse_string(text)
		var input: Dictionary = case["input"]
		var expected: Dictionary = case["expected"]
		var case_name: String = case["name"]
		var calendar: int = id_of(str(input["calendar"]))
		var full: CoreContract.UserStateDelta = new_delta(true)
		if input["state"] is Dictionary:
			var stored: Dictionary = input["state"]
			var state: CoreContract.AttendanceUserState = CoreContract.AttendanceUserState.new()
			state.id = calendar
			state.day = json_int(stored["day"])
			state.claimed_day_number = json_int(stored["claimed_day_number"])
			state.reset_at = json_int(stored["reset_at"])
			state.event_round = json_int(stored["event_round"])
			add_upsert(full, "AttendanceUserState", calendar, state)
		assert_true(UserStateCoreDev.apply_test_delta(full), case_name)
		sync_to(json_int(input["time"]))
		var progress: GetAttendanceResult = UserStateCore.get_attendance(calendar)
		assert_eq(progress.day, json_int(expected["day"]), case_name + ": day")
		assert_eq(progress.next_day, json_int(expected["next_day"]), case_name + ": next_day")
	return cases.size()
