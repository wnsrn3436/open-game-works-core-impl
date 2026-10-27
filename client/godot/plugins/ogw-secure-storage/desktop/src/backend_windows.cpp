// Windows Credential Manager: one generic credential per item, target `ogw-secure-storage:<name>`, holding the UTF-8
// text as its blob. It is kept for this Windows user on this computer only (`CRED_PERSIST_LOCAL_MACHINE`, which does
// not roam with the user profile). The Credential Manager calls never show a window.

#include "backend.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincred.h>

namespace ogw {

namespace {

const wchar_t *const TARGET_PREFIX = L"ogw-secure-storage:";
const wchar_t *const USER_NAME = L"ogw-secure-storage";

// UTF-16 of the UTF-8 `text`; false when it is not valid UTF-8.
bool to_wide(const std::string &text, std::wstring &out) {
	out.clear();
	if (text.empty()) {
		return true;
	}
	int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), (int)text.size(), nullptr, 0);
	if (size <= 0) {
		return false;
	}
	out.resize((size_t)size);
	return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), (int)text.size(), &out[0], size) == size;
}

bool target_of(const std::string &name, std::wstring &out) {
	std::wstring wide;
	if (!to_wide(name, wide)) {
		return false;
	}
	out = TARGET_PREFIX + wide;
	return true;
}

int32_t status_of(DWORD error) {
	switch (error) {
		case ERROR_NOT_FOUND:
			return STATUS_NOT_FOUND;
		// The logon session has no credential set (e.g. a network or service logon).
		case ERROR_NO_SUCH_LOGON_SESSION:
			return STATUS_UNSUPPORTED;
		case ERROR_ACCESS_DENIED:
			return STATUS_DENIED;
		default:
			return STATUS_FAILED;
	}
}

} // namespace

namespace backend {

bool available() {
	return true;
}

Result read(const std::string &name) {
	std::wstring target;
	if (!target_of(name, target)) {
		return { STATUS_FAILED, "" };
	}
	PCREDENTIALW credential = nullptr;
	if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
		return { status_of(GetLastError()), "" };
	}
	std::string text((const char *)credential->CredentialBlob, (size_t)credential->CredentialBlobSize);
	CredFree(credential);
	std::wstring check;
	if (!to_wide(text, check)) {
		return { STATUS_FAILED, "" };
	}
	return { STATUS_OK, text };
}

Result write(const std::string &name, const std::string &text) {
	std::wstring target;
	if (!target_of(name, target) || text.size() > CRED_MAX_CREDENTIAL_BLOB_SIZE) {
		return { STATUS_FAILED, "" };
	}
	CREDENTIALW credential = {};
	credential.Type = CRED_TYPE_GENERIC;
	credential.TargetName = &target[0];
	credential.CredentialBlobSize = (DWORD)text.size();
	credential.CredentialBlob = (LPBYTE)text.data();
	credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
	credential.UserName = (LPWSTR)USER_NAME;
	if (!CredWriteW(&credential, 0)) {
		return { status_of(GetLastError()), "" };
	}
	return { STATUS_OK, "" };
}

Result remove(const std::string &name) {
	std::wstring target;
	if (!target_of(name, target)) {
		return { STATUS_FAILED, "" };
	}
	if (!CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0)) {
		return { status_of(GetLastError()), "" };
	}
	return { STATUS_OK, "" };
}

} // namespace backend

} // namespace ogw
