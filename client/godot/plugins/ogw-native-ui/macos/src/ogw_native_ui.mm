#include "ogw_native_ui.h"

#include <godot_cpp/classes/display_server.hpp>
#include <godot_cpp/core/class_db.hpp>

#import <AppKit/AppKit.h>
#import <StoreKit/StoreKit.h>

// Delegate of one share picker: tells the singleton once when the picker closes, with or without a chosen service.
@interface OgwNativeUiPickerDelegate : NSObject <NSSharingServicePickerDelegate>
@property(nonatomic, assign) ogw::OgwNativeUi *owner;
@property(nonatomic, assign) int64_t shareId;
@end

@implementation OgwNativeUiPickerDelegate

- (void)sharingServicePicker:(NSSharingServicePicker *)sharingServicePicker
		didChooseSharingService:(NSSharingService *)service {
	ogw::OgwNativeUi *owner = self.owner;
	self.owner = nullptr;
	if (owner != nullptr) {
		owner->finish_share(self.shareId, ogw::OgwNativeUi::STATUS_CLOSED);
	}
}

@end

namespace ogw {

OgwNativeUi::OgwNativeUi() {}

OgwNativeUi::~OgwNativeUi() {
	if (delegate != nullptr) {
		OgwNativeUiPickerDelegate *d = (__bridge_transfer OgwNativeUiPickerDelegate *)delegate;
		d.owner = nullptr;
		delegate = nullptr;
	}
	if (picker != nullptr) {
		NSSharingServicePicker *p = (__bridge_transfer NSSharingServicePicker *)picker;
		p.delegate = nil;
		picker = nullptr;
	}
}

bool OgwNativeUi::request_review() {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
	[SKStoreReviewController requestReview];
#pragma clang diagnostic pop
	return true;
}

int64_t OgwNativeUi::start_share(const godot::String &text, const godot::PackedByteArray &png) {
	if (open_share != 0) {
		return 0;
	}
	godot::DisplayServer *display = godot::DisplayServer::get_singleton();
	if (display == nullptr) {
		return 0;
	}
	NSView *view = (__bridge NSView *)(void *)display->window_get_native_handle(godot::DisplayServer::WINDOW_VIEW, 0);
	if (view == nil || view.window == nil) {
		return 0;
	}
	NSMutableArray *items = [NSMutableArray array];
	if (!text.is_empty()) {
		[items addObject:[NSString stringWithUTF8String:text.utf8().get_data()]];
	}
	if (!png.is_empty()) {
		NSData *data = [NSData dataWithBytes:png.ptr() length:(NSUInteger)png.size()];
		NSImage *image = [[NSImage alloc] initWithData:data];
		if (image == nil) {
			return 0;
		}
		[items addObject:image];
	}
	if (items.count == 0) {
		return 0;
	}
	int64_t id = next_id++;
	OgwNativeUiPickerDelegate *d = [[OgwNativeUiPickerDelegate alloc] init];
	d.owner = this;
	d.shareId = id;
	NSSharingServicePicker *p = [[NSSharingServicePicker alloc] initWithItems:items];
	p.delegate = d;
	open_share = id;
	open_share_dropped = false;
	picker = (__bridge_retained void *)p;
	delegate = (__bridge_retained void *)d;
	NSRect bounds = view.bounds;
	NSRect anchor = NSMakeRect(NSMidX(bounds), NSMidY(bounds), 1, 1);
	[p showRelativeToRect:anchor ofView:view preferredEdge:NSRectEdgeMinY];
	return id;
}

godot::PackedInt32Array OgwNativeUi::take_share_result(int64_t id) {
	godot::PackedInt32Array out;
	if (id == open_share && !open_share_dropped) {
		return out;
	}
	if (results.has(id)) {
		out.push_back(results[id]);
		results.erase(id);
		return out;
	}
	out.push_back(STATUS_FAILED);
	return out;
}

void OgwNativeUi::cancel_share(int64_t id) {
	results.erase(id);
	if (id == open_share) {
		// The picker stays on screen until the user closes it; its result is not kept.
		open_share_dropped = true;
	}
}

void OgwNativeUi::finish_share(int64_t id, int32_t status) {
	// The picker calls this from its delegate: the picker and the delegate are released after the call returns.
	void *old_picker = picker;
	void *old_delegate = delegate;
	picker = nullptr;
	delegate = nullptr;
	if (old_picker != nullptr || old_delegate != nullptr) {
		dispatch_async(dispatch_get_main_queue(), ^{
			if (old_delegate != nullptr) {
				OgwNativeUiPickerDelegate *d = (__bridge_transfer OgwNativeUiPickerDelegate *)old_delegate;
				d.owner = nullptr;
			}
			if (old_picker != nullptr) {
				NSSharingServicePicker *p = (__bridge_transfer NSSharingServicePicker *)old_picker;
				p.delegate = nil;
			}
		});
	}
	if (id != open_share) {
		return;
	}
	open_share = 0;
	if (!open_share_dropped) {
		results[id] = status;
	}
	open_share_dropped = false;
}

void OgwNativeUi::_bind_methods() {
	godot::ClassDB::bind_method(godot::D_METHOD("request_review"), &OgwNativeUi::request_review);
	godot::ClassDB::bind_method(godot::D_METHOD("start_share", "text", "png"), &OgwNativeUi::start_share);
	godot::ClassDB::bind_method(godot::D_METHOD("take_share_result", "id"), &OgwNativeUi::take_share_result);
	godot::ClassDB::bind_method(godot::D_METHOD("cancel_share", "id"), &OgwNativeUi::cancel_share);
}

} // namespace ogw
