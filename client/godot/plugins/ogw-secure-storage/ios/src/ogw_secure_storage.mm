#include "ogw_secure_storage.h"

#include "core/config/engine.h"

#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

#import <Foundation/Foundation.h>
#import <Security/Security.h>

namespace {

enum class Op { READ, WRITE, REMOVE };

struct Result {
	int32_t status;
	// UTF-8 item text of a read that is `STATUS_OK`.
	std::string text;
};

NSString *const SERVICE = @"ogw-secure-storage";

NSMutableDictionary *item_query(NSString *name) {
	NSMutableDictionary *query = [NSMutableDictionary dictionary];
	query[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
	query[(__bridge id)kSecAttrService] = SERVICE;
	query[(__bridge id)kSecAttrAccount] = name;
	query[(__bridge id)kSecAttrSynchronizable] = @NO;
	return query;
}

int32_t status_of(OSStatus status) {
	switch (status) {
		case errSecSuccess:
			return OgwSecureStorage::STATUS_OK;
		case errSecItemNotFound:
			return OgwSecureStorage::STATUS_NOT_FOUND;
		case errSecInteractionNotAllowed:
		case errSecAuthFailed:
		case errSecUserCanceled:
			return OgwSecureStorage::STATUS_DENIED;
		case errSecNotAvailable:
		case errSecMissingEntitlement:
			return OgwSecureStorage::STATUS_UNSUPPORTED;
		default:
			return OgwSecureStorage::STATUS_FAILED;
	}
}

// Runs one operation on the queue. `data` is the text of a write.
Result run(Op op, NSString *name, NSData *data) {
	NSMutableDictionary *query = item_query(name);
	switch (op) {
		case Op::READ: {
			query[(__bridge id)kSecReturnData] = @YES;
			query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
			CFTypeRef found = nullptr;
			OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
			if (status != errSecSuccess) {
				return { status_of(status), "" };
			}
			id value = (__bridge_transfer id)found;
			if (![value isKindOfClass:[NSData class]]) {
				return { OgwSecureStorage::STATUS_FAILED, "" };
			}
			NSData *bytes = (NSData *)value;
			if ([[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding] == nil) {
				return { OgwSecureStorage::STATUS_FAILED, "" };
			}
			return { OgwSecureStorage::STATUS_OK, std::string((const char *)bytes.bytes, (size_t)bytes.length) };
		}
		case Op::WRITE: {
			NSMutableDictionary *values = [NSMutableDictionary dictionary];
			values[(__bridge id)kSecValueData] = data;
			values[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
			NSMutableDictionary *item = [query mutableCopy];
			[item addEntriesFromDictionary:values];
			OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, nullptr);
			if (status == errSecDuplicateItem) {
				status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)values);
			}
			return { status_of(status), "" };
		}
		case Op::REMOVE:
			return { status_of(SecItemDelete((__bridge CFDictionaryRef)query)), "" };
	}
	return { OgwSecureStorage::STATUS_FAILED, "" };
}

} // namespace

struct SecureStorageState {
	std::mutex mutex;
	int64_t next_id = 1;
	// Operations not ended yet whose caller still waits.
	std::unordered_set<int64_t> waiting;
	// Ended operations the caller has not taken yet.
	std::unordered_map<int64_t, Result> results;
	// Serial queue of the operations.
	dispatch_queue_t queue = nil;
};

namespace {

OgwSecureStorage *singleton = nullptr;

int64_t start_operation(const std::shared_ptr<SecureStorageState> &state, Op op, const String &name,
		const String &text) {
	if (name.is_empty()) {
		return 0;
	}
	NSString *item = [NSString stringWithUTF8String:name.utf8().get_data()];
	NSData *data = nil;
	if (op == Op::WRITE) {
		CharString bytes = text.utf8();
		data = [NSData dataWithBytes:bytes.get_data() length:(NSUInteger)bytes.length()];
	}
	int64_t id = 0;
	{
		std::lock_guard<std::mutex> lock(state->mutex);
		id = state->next_id++;
		state->waiting.insert(id);
	}
	std::shared_ptr<SecureStorageState> shared = state;
	dispatch_async(state->queue, ^{
		Result result = run(op, item, data);
		std::lock_guard<std::mutex> lock(shared->mutex);
		if (shared->waiting.erase(id) > 0) {
			shared->results[id] = std::move(result);
		}
	});
	return id;
}

} // namespace

OgwSecureStorage::OgwSecureStorage() :
		state(std::make_shared<SecureStorageState>()) {
	state->queue = dispatch_queue_create("ogw-secure-storage", DISPATCH_QUEUE_SERIAL);
}

OgwSecureStorage::~OgwSecureStorage() {}

int64_t OgwSecureStorage::start_read(const String &name) {
	return start_operation(state, Op::READ, name, String());
}

int64_t OgwSecureStorage::start_write(const String &name, const String &text) {
	return start_operation(state, Op::WRITE, name, text);
}

int64_t OgwSecureStorage::start_remove(const String &name) {
	return start_operation(state, Op::REMOVE, name, String());
}

PackedStringArray OgwSecureStorage::take_result(int64_t id) {
	PackedStringArray out;
	Result result = { STATUS_FAILED, "" };
	{
		std::lock_guard<std::mutex> lock(state->mutex);
		if (state->waiting.count(id) > 0) {
			return out;
		}
		auto found = state->results.find(id);
		if (found != state->results.end()) {
			result = std::move(found->second);
			state->results.erase(found);
		}
	}
	out.push_back(itos(result.status));
	out.push_back(String::utf8(result.text.data(), (int)result.text.size()));
	return out;
}

void OgwSecureStorage::cancel(int64_t id) {
	std::lock_guard<std::mutex> lock(state->mutex);
	state->waiting.erase(id);
	state->results.erase(id);
}

void OgwSecureStorage::_bind_methods() {
	ClassDB::bind_method(D_METHOD("start_read", "name"), &OgwSecureStorage::start_read);
	ClassDB::bind_method(D_METHOD("start_write", "name", "text"), &OgwSecureStorage::start_write);
	ClassDB::bind_method(D_METHOD("start_remove", "name"), &OgwSecureStorage::start_remove);
	ClassDB::bind_method(D_METHOD("take_result", "id"), &OgwSecureStorage::take_result);
	ClassDB::bind_method(D_METHOD("cancel", "id"), &OgwSecureStorage::cancel);
}

void ogw_secure_storage_init() {
	GDREGISTER_CLASS(OgwSecureStorage);
	singleton = memnew(OgwSecureStorage);
	Engine::get_singleton()->add_singleton(Engine::Singleton("OgwSecureStorage", singleton));
}

void ogw_secure_storage_deinit() {
	if (singleton == nullptr) {
		return;
	}
	Engine::get_singleton()->remove_singleton("OgwSecureStorage");
	memdelete(singleton);
	singleton = nullptr;
}
