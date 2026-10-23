package io.github.wnsrn3436.ogw.nativeui;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;

import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

import org.godotengine.godot.Godot;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.UsedByGodot;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashMap;

/**
 * `OgwNativeUi` singleton of Android: the store review request window (Google Play In-App Review API) and the share
 * window (Android Sharesheet, `ACTION_SEND`). Godot calls the methods on its own thread; the windows open on the UI
 * thread.
 */
public class OgwNativeUiPlugin extends GodotPlugin {
	private static final int STATUS_CLOSED = 0;
	private static final int STATUS_FAILED = 1;
	/** Request code of the share window's activity result. */
	private static final int SHARE_REQUEST_CODE = 0x4E55;
	private static final String SHARE_FOLDER = "ogw_native_ui_share";
	private static final String SHARE_FILE = "share.png";
	private static final String AUTHORITY_SUFFIX = ".ogwnativeui.fileprovider";

	private final Object lock = new Object();
	private long nextId = 1;
	/** Share whose window is on screen; 0 when none. */
	private long openShare = 0;
	/** True when the caller stopped waiting for `openShare`: its result is not kept. */
	private boolean openShareDropped = false;
	/** Ended shares the caller has not taken yet: ID to status. */
	private final HashMap<Long, Integer> results = new HashMap<>();

	public OgwNativeUiPlugin(Godot godot) {
		super(godot);
	}

	@NonNull
	@Override
	public String getPluginName() {
		return "OgwNativeUi";
	}

	/** Asks Google Play for the store review request window. True when the request was handed to Google Play. */
	@UsedByGodot
	public boolean request_review() {
		final Activity activity = getActivity();
		if (activity == null) {
			return false;
		}
		final ReviewManager manager;
		try {
			manager = ReviewManagerFactory.create(activity);
		} catch (RuntimeException e) {
			return false;
		}
		runOnUiThread(() -> manager.requestReviewFlow().addOnCompleteListener(task -> {
			if (!task.isSuccessful()) {
				return;
			}
			ReviewInfo info = task.getResult();
			manager.launchReviewFlow(activity, info);
		}));
		return true;
	}

	/**
	 * Opens the share window with `text` and the PNG `png` (empty for none). The operation ID, or 0 when the window
	 * cannot open (no activity, a share window still on screen, or the PNG could not be written).
	 */
	@UsedByGodot
	public long start_share(String text, byte[] png) {
		final Activity activity = getActivity();
		if (activity == null) {
			return 0;
		}
		final long id;
		synchronized (lock) {
			if (openShare != 0) {
				return 0;
			}
			id = nextId++;
			openShare = id;
			openShareDropped = false;
		}
		final Intent send;
		try {
			send = shareIntent(activity, text == null ? "" : text, png == null ? new byte[0] : png);
		} catch (IOException | IllegalArgumentException e) {
			synchronized (lock) {
				openShare = 0;
			}
			return 0;
		}
		final Intent chooser = Intent.createChooser(send, null);
		runOnUiThread(() -> {
			try {
				activity.startActivityForResult(chooser, SHARE_REQUEST_CODE);
			} catch (RuntimeException e) {
				finishShare(id, STATUS_FAILED);
			}
		});
		return id;
	}

	/** Empty until share `id` closes, then `[status]` once. `[1]` for an ID with no share. */
	@UsedByGodot
	public int[] take_share_result(long id) {
		synchronized (lock) {
			if (id == openShare && !openShareDropped) {
				return new int[0];
			}
			Integer status = results.remove(id);
			return new int[] { status == null ? STATUS_FAILED : status };
		}
	}

	/** The caller stopped waiting for share `id`: its result is dropped. */
	@UsedByGodot
	public void cancel_share(long id) {
		synchronized (lock) {
			results.remove(id);
			if (id == openShare) {
				// The share window stays on screen until the user closes it; its result is not kept.
				openShareDropped = true;
			}
		}
	}

	@Override
	public void onMainActivityResult(int requestCode, int resultCode, Intent data) {
		if (requestCode != SHARE_REQUEST_CODE) {
			return;
		}
		long id;
		synchronized (lock) {
			id = openShare;
		}
		if (id != 0) {
			finishShare(id, STATUS_CLOSED);
		}
	}

	private void finishShare(long id, int status) {
		synchronized (lock) {
			if (id != openShare) {
				return;
			}
			openShare = 0;
			if (!openShareDropped) {
				results.put(id, status);
			}
			openShareDropped = false;
		}
	}

	/** `ACTION_SEND` of the text and the PNG. The PNG is written to the app cache and shared through the FileProvider. */
	private static Intent shareIntent(Activity activity, String text, byte[] png) throws IOException {
		Intent send = new Intent(Intent.ACTION_SEND);
		if (!text.isEmpty()) {
			send.putExtra(Intent.EXTRA_TEXT, text);
		}
		if (png.length == 0) {
			send.setType("text/plain");
			return send;
		}
		File folder = new File(activity.getCacheDir(), SHARE_FOLDER);
		if (!folder.isDirectory() && !folder.mkdirs()) {
			throw new IOException("could not create " + folder);
		}
		File file = new File(folder, SHARE_FILE);
		try (FileOutputStream out = new FileOutputStream(file)) {
			out.write(png);
		}
		Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + AUTHORITY_SUFFIX, file);
		send.setType("image/png");
		send.putExtra(Intent.EXTRA_STREAM, uri);
		send.setClipData(ClipData.newRawUri("", uri));
		send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
		return send;
	}
}
