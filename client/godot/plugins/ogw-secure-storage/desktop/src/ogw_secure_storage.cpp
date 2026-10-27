#include "ogw_secure_storage.h"

#include "backend.h"

#include <godot_cpp/core/class_db.hpp>

#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace ogw {

namespace {

enum class Op { READ, WRITE, REMOVE };

struct Job {
	int64_t id;
	Op op;
	std::string name;
	std::string text;
};

Result run(const Job &job) {
	switch (job.op) {
		case Op::READ:
			return backend::read(job.name);
		case Op::WRITE:
			return backend::write(job.name, job.text);
		case Op::REMOVE:
			return backend::remove(job.name);
	}
	return { STATUS_FAILED, "" };
}

} // namespace

struct SecureStorageState {
	std::mutex mutex;
	std::condition_variable wake;
	bool stopping = false;
	int64_t next_id = 1;
	// Started operations the operation thread has not run yet, in start order.
	std::deque<Job> queue;
	// Operations not ended yet whose caller still waits.
	std::unordered_set<int64_t> waiting;
	// Ended operations the caller has not taken yet.
	std::unordered_map<int64_t, Result> results;
};

namespace {

void work(SecureStorageState *state) {
	std::unique_lock<std::mutex> lock(state->mutex);
	while (true) {
		state->wake.wait(lock, [state] { return state->stopping || !state->queue.empty(); });
		if (state->queue.empty()) {
			return;
		}
		Job job = std::move(state->queue.front());
		state->queue.pop_front();
		lock.unlock();
		Result result = run(job);
		lock.lock();
		if (state->waiting.erase(job.id) > 0) {
			state->results[job.id] = std::move(result);
		}
	}
}

int64_t start_operation(SecureStorageState *state, Op op, const godot::String &name, const godot::String &text) {
	if (name.is_empty()) {
		return 0;
	}
	Job job = { 0, op, std::string(name.utf8().get_data()), "" };
	if (op == Op::WRITE) {
		godot::CharString bytes = text.utf8();
		job.text.assign(bytes.get_data(), (size_t)bytes.length());
	}
	int64_t id = 0;
	{
		std::lock_guard<std::mutex> lock(state->mutex);
		id = state->next_id++;
		job.id = id;
		state->waiting.insert(id);
		state->queue.push_back(std::move(job));
	}
	state->wake.notify_one();
	return id;
}

} // namespace

OgwSecureStorage::OgwSecureStorage() :
		state(std::make_unique<SecureStorageState>()) {
	worker = std::thread(work, state.get());
}

OgwSecureStorage::~OgwSecureStorage() {
	{
		std::lock_guard<std::mutex> lock(state->mutex);
		state->stopping = true;
	}
	state->wake.notify_one();
	worker.join();
}

int64_t OgwSecureStorage::start_read(const godot::String &name) {
	return start_operation(state.get(), Op::READ, name, godot::String());
}

int64_t OgwSecureStorage::start_write(const godot::String &name, const godot::String &text) {
	return start_operation(state.get(), Op::WRITE, name, text);
}

int64_t OgwSecureStorage::start_remove(const godot::String &name) {
	return start_operation(state.get(), Op::REMOVE, name, godot::String());
}

godot::PackedStringArray OgwSecureStorage::take_result(int64_t id) {
	godot::PackedStringArray out;
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
	out.push_back(godot::String::num_int64(result.status));
	out.push_back(godot::String::utf8(result.text.data(), (int)result.text.size()));
	return out;
}

void OgwSecureStorage::cancel(int64_t id) {
	std::lock_guard<std::mutex> lock(state->mutex);
	state->waiting.erase(id);
	state->results.erase(id);
}

void OgwSecureStorage::_bind_methods() {
	godot::ClassDB::bind_method(godot::D_METHOD("start_read", "name"), &OgwSecureStorage::start_read);
	godot::ClassDB::bind_method(godot::D_METHOD("start_write", "name", "text"), &OgwSecureStorage::start_write);
	godot::ClassDB::bind_method(godot::D_METHOD("start_remove", "name"), &OgwSecureStorage::start_remove);
	godot::ClassDB::bind_method(godot::D_METHOD("take_result", "id"), &OgwSecureStorage::take_result);
	godot::ClassDB::bind_method(godot::D_METHOD("cancel", "id"), &OgwSecureStorage::cancel);
}

} // namespace ogw
