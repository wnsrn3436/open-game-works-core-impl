// Linux Secret Service through libsecret: one item per name in the default collection, with the schema below and the
// attribute `name`, holding the UTF-8 text. libsecret is loaded at run time, so a system without it gets no singleton
// instead of failing to load this library. An operation never unlocks a collection or an item, which would show the
// OS unlock window: a locked collection or item is `STATUS_DENIED`, and a session without a default collection is
// `STATUS_UNSUPPORTED`.

#include "backend.h"

#include <dlfcn.h>
#include <libsecret/secret.h>

namespace ogw {

namespace {

const SecretSchema SCHEMA = {
	"io.github.wnsrn3436.ogw.SecureStorage",
	SECRET_SCHEMA_NONE,
	{
			{ "name", SECRET_SCHEMA_ATTRIBUTE_STRING },
			{ nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING },
	},
	0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr
};

// The libsecret and GLib functions this file calls, read from the loaded libsecret.
struct Api {
	decltype(&secret_service_get_sync) service_get_sync;
	decltype(&secret_collection_for_alias_sync) collection_for_alias_sync;
	decltype(&secret_collection_get_locked) collection_get_locked;
	decltype(&secret_collection_search_sync) collection_search_sync;
	decltype(&secret_item_create_sync) item_create_sync;
	decltype(&secret_item_delete_sync) item_delete_sync;
	decltype(&secret_item_get_locked) item_get_locked;
	decltype(&secret_item_get_secret) item_get_secret;
	decltype(&secret_value_new) value_new;
	decltype(&secret_value_get) value_get;
	decltype(&secret_value_unref) value_unref;
	decltype(&secret_error_get_quark) error_get_quark;
	decltype(&g_hash_table_new) hash_table_new;
	decltype(&g_hash_table_insert) hash_table_insert;
	decltype(&g_hash_table_unref) hash_table_unref;
	decltype(&g_str_hash) str_hash;
	decltype(&g_str_equal) str_equal;
	decltype(&g_list_free_full) list_free_full;
	decltype(&g_object_unref) object_unref;
	decltype(&g_error_free) error_free;
	decltype(&g_utf8_validate) utf8_validate;
};

Api api = {};
bool loaded = false;

template <typename T>
bool find(void *library, const char *symbol, T &out) {
	out = reinterpret_cast<T>(dlsym(library, symbol));
	return out != nullptr;
}

bool load() {
	void *library = dlopen("libsecret-1.so.0", RTLD_NOW | RTLD_LOCAL);
	if (library == nullptr) {
		return false;
	}
	// GLib and GObject are dependencies of libsecret, so its handle finds their functions too.
	bool found = find(library, "secret_service_get_sync", api.service_get_sync) &&
			find(library, "secret_collection_for_alias_sync", api.collection_for_alias_sync) &&
			find(library, "secret_collection_get_locked", api.collection_get_locked) &&
			find(library, "secret_collection_search_sync", api.collection_search_sync) &&
			find(library, "secret_item_create_sync", api.item_create_sync) &&
			find(library, "secret_item_delete_sync", api.item_delete_sync) &&
			find(library, "secret_item_get_locked", api.item_get_locked) &&
			find(library, "secret_item_get_secret", api.item_get_secret) &&
			find(library, "secret_value_new", api.value_new) &&
			find(library, "secret_value_get", api.value_get) &&
			find(library, "secret_value_unref", api.value_unref) &&
			find(library, "secret_error_get_quark", api.error_get_quark) &&
			find(library, "g_hash_table_new", api.hash_table_new) &&
			find(library, "g_hash_table_insert", api.hash_table_insert) &&
			find(library, "g_hash_table_unref", api.hash_table_unref) &&
			find(library, "g_str_hash", api.str_hash) &&
			find(library, "g_str_equal", api.str_equal) &&
			find(library, "g_list_free_full", api.list_free_full) &&
			find(library, "g_object_unref", api.object_unref) &&
			find(library, "g_error_free", api.error_free) &&
			find(library, "g_utf8_validate", api.utf8_validate);
	if (!found) {
		dlclose(library);
		api = {};
	}
	return found;
}

// Status of a failed call, and frees `error`.
int32_t status_of(GError *error) {
	int32_t status = STATUS_FAILED;
	if (error != nullptr && error->domain == api.error_get_quark() && error->code == SECRET_ERROR_IS_LOCKED) {
		status = STATUS_DENIED;
	}
	if (error != nullptr) {
		api.error_free(error);
	}
	return status;
}

// The unlocked default collection of the session's Secret Service. On failure null, with `status` set.
SecretCollection *open_collection(int32_t &status) {
	GError *error = nullptr;
	SecretService *service = api.service_get_sync(SECRET_SERVICE_OPEN_SESSION, nullptr, &error);
	if (service == nullptr) {
		// No Secret Service on the session bus, or no session bus.
		if (error != nullptr) {
			api.error_free(error);
		}
		status = STATUS_UNSUPPORTED;
		return nullptr;
	}
	SecretCollection *collection =
			api.collection_for_alias_sync(service, SECRET_COLLECTION_DEFAULT, SECRET_COLLECTION_NONE, nullptr, &error);
	api.object_unref(service);
	if (collection == nullptr) {
		// Without an error the session has no default collection, and making one would show an OS window.
		status = error == nullptr ? STATUS_UNSUPPORTED : status_of(error);
		return nullptr;
	}
	if (api.collection_get_locked(collection)) {
		api.object_unref(collection);
		status = STATUS_DENIED;
		return nullptr;
	}
	return collection;
}

// Attributes of the item `name`. The table keeps pointers into `name`.
GHashTable *attributes_of(const std::string &name) {
	GHashTable *attributes = api.hash_table_new(api.str_hash, api.str_equal);
	api.hash_table_insert(attributes, (gpointer) "name", (gpointer)name.c_str());
	return attributes;
}

// Items of `name` in `collection`. On failure `status` is set; an empty list with `STATUS_OK` is no item.
GList *search(SecretCollection *collection, const std::string &name, SecretSearchFlags flags, int32_t &status) {
	GHashTable *attributes = attributes_of(name);
	GError *error = nullptr;
	GList *items = api.collection_search_sync(collection, &SCHEMA, attributes,
			(SecretSearchFlags)(SECRET_SEARCH_ALL | flags), nullptr, &error);
	api.hash_table_unref(attributes);
	status = error == nullptr ? STATUS_OK : status_of(error);
	return items;
}

void free_items(GList *items) {
	if (items != nullptr) {
		api.list_free_full(items, api.object_unref);
	}
}

} // namespace

namespace backend {

bool available() {
	static bool tried = false;
	if (!tried) {
		tried = true;
		loaded = load();
	}
	return loaded;
}

Result read(const std::string &name) {
	int32_t status = STATUS_FAILED;
	SecretCollection *collection = open_collection(status);
	if (collection == nullptr) {
		return { status, "" };
	}
	GList *items = search(collection, name, SECRET_SEARCH_LOAD_SECRETS, status);
	api.object_unref(collection);
	if (status != STATUS_OK) {
		free_items(items);
		return { status, "" };
	}
	if (items == nullptr) {
		return { STATUS_NOT_FOUND, "" };
	}
	SecretItem *item = (SecretItem *)items->data;
	Result result = { STATUS_FAILED, "" };
	if (api.item_get_locked(item)) {
		result.status = STATUS_DENIED;
	} else {
		SecretValue *value = api.item_get_secret(item);
		if (value != nullptr) {
			gsize length = 0;
			const gchar *bytes = api.value_get(value, &length);
			if (bytes != nullptr && api.utf8_validate(bytes, (gssize)length, nullptr)) {
				result = { STATUS_OK, std::string(bytes, (size_t)length) };
			}
			api.value_unref(value);
		}
	}
	free_items(items);
	return result;
}

Result write(const std::string &name, const std::string &text) {
	int32_t status = STATUS_FAILED;
	SecretCollection *collection = open_collection(status);
	if (collection == nullptr) {
		return { status, "" };
	}
	GHashTable *attributes = attributes_of(name);
	SecretValue *value = api.value_new(text.data(), (gssize)text.size(), "text/plain");
	std::string label = "ogw-secure-storage " + name;
	GError *error = nullptr;
	SecretItem *item = api.item_create_sync(collection, &SCHEMA, attributes, label.c_str(), value,
			SECRET_ITEM_CREATE_REPLACE, nullptr, &error);
	api.value_unref(value);
	api.hash_table_unref(attributes);
	api.object_unref(collection);
	if (item == nullptr) {
		return { status_of(error), "" };
	}
	api.object_unref(item);
	return { STATUS_OK, "" };
}

Result remove(const std::string &name) {
	int32_t status = STATUS_FAILED;
	SecretCollection *collection = open_collection(status);
	if (collection == nullptr) {
		return { status, "" };
	}
	GList *items = search(collection, name, SECRET_SEARCH_NONE, status);
	api.object_unref(collection);
	if (status != STATUS_OK) {
		free_items(items);
		return { status, "" };
	}
	if (items == nullptr) {
		return { STATUS_NOT_FOUND, "" };
	}
	for (GList *at = items; at != nullptr && status == STATUS_OK; at = at->next) {
		SecretItem *item = (SecretItem *)at->data;
		if (api.item_get_locked(item)) {
			status = STATUS_DENIED;
			break;
		}
		GError *error = nullptr;
		if (!api.item_delete_sync(item, nullptr, &error)) {
			status = status_of(error);
		}
	}
	free_items(items);
	return { status, "" };
}

} // namespace backend

} // namespace ogw
