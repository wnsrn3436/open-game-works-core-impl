#include "ogw_native_ui.h"

#include "core/config/engine.h"

#import <StoreKit/StoreKit.h>
#import <UIKit/UIKit.h>

static OgwNativeUi *singleton = nullptr;

// The foreground active window scene, or the first window scene when none is active.
static UIWindowScene *active_window_scene() {
	UIWindowScene *found = nil;
	for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
		if (![scene isKindOfClass:[UIWindowScene class]]) {
			continue;
		}
		if (scene.activationState == UISceneActivationStateForegroundActive) {
			return (UIWindowScene *)scene;
		}
		if (found == nil) {
			found = (UIWindowScene *)scene;
		}
	}
	return found;
}

// The view controller on top of the key window of the active scene; nil when there is none.
static UIViewController *top_view_controller() {
	UIWindowScene *scene = active_window_scene();
	if (scene == nil) {
		return nil;
	}
	UIWindow *window = nil;
	for (UIWindow *candidate in scene.windows) {
		if (candidate.isKeyWindow) {
			window = candidate;
			break;
		}
	}
	if (window == nil) {
		window = scene.windows.firstObject;
	}
	UIViewController *controller = window.rootViewController;
	while (controller.presentedViewController != nil) {
		controller = controller.presentedViewController;
	}
	return controller;
}

bool OgwNativeUi::request_review() {
	UIWindowScene *scene = active_window_scene();
	if (scene == nil) {
		return false;
	}
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
	[SKStoreReviewController requestReviewInScene:scene];
#pragma clang diagnostic pop
	return true;
}

int64_t OgwNativeUi::start_share(const String &text, const PackedByteArray &png) {
	if (open_share != 0) {
		return 0;
	}
	UIViewController *controller = top_view_controller();
	if (controller == nil) {
		return 0;
	}
	NSMutableArray *items = [NSMutableArray array];
	if (!text.is_empty()) {
		[items addObject:[NSString stringWithUTF8String:text.utf8().get_data()]];
	}
	if (!png.is_empty()) {
		NSData *data = [NSData dataWithBytes:png.ptr() length:(NSUInteger)png.size()];
		UIImage *image = [UIImage imageWithData:data];
		if (image == nil) {
			return 0;
		}
		[items addObject:image];
	}
	if (items.count == 0) {
		return 0;
	}
	int64_t id = next_id++;
	UIActivityViewController *sheet = [[UIActivityViewController alloc] initWithActivityItems:items
																		applicationActivities:nil];
	sheet.completionWithItemsHandler = ^(UIActivityType activityType, BOOL completed, NSArray *returnedItems,
			NSError *activityError) {
		if (singleton != nullptr) {
			singleton->finish_share(id, OgwNativeUi::STATUS_CLOSED);
		}
	};
	// iPad shows the share window as a popover, which needs an anchor.
	UIPopoverPresentationController *popover = sheet.popoverPresentationController;
	if (popover != nil) {
		UIView *view = controller.view;
		popover.sourceView = view;
		popover.sourceRect = CGRectMake(CGRectGetMidX(view.bounds), CGRectGetMidY(view.bounds), 1, 1);
		popover.permittedArrowDirections = 0;
	}
	open_share = id;
	open_share_dropped = false;
	[controller presentViewController:sheet animated:YES completion:nil];
	return id;
}

PackedInt32Array OgwNativeUi::take_share_result(int64_t id) {
	PackedInt32Array out;
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
		// The share window stays on screen until the user closes it; its result is not kept.
		open_share_dropped = true;
	}
}

void OgwNativeUi::finish_share(int64_t id, int32_t status) {
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
	ClassDB::bind_method(D_METHOD("request_review"), &OgwNativeUi::request_review);
	ClassDB::bind_method(D_METHOD("start_share", "text", "png"), &OgwNativeUi::start_share);
	ClassDB::bind_method(D_METHOD("take_share_result", "id"), &OgwNativeUi::take_share_result);
	ClassDB::bind_method(D_METHOD("cancel_share", "id"), &OgwNativeUi::cancel_share);
}

void ogw_native_ui_init() {
	GDREGISTER_CLASS(OgwNativeUi);
	singleton = memnew(OgwNativeUi);
	Engine::get_singleton()->add_singleton(Engine::Singleton("OgwNativeUi", singleton));
}

void ogw_native_ui_deinit() {
	if (singleton == nullptr) {
		return;
	}
	Engine::get_singleton()->remove_singleton("OgwNativeUi");
	memdelete(singleton);
	singleton = nullptr;
}
