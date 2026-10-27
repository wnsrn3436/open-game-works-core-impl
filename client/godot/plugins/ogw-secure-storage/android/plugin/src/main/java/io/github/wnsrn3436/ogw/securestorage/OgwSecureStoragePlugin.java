package io.github.wnsrn3436.ogw.securestorage;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.godotengine.godot.Godot;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.UsedByGodot;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.HashMap;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * `OgwSecureStorage` singleton of Android: one text item per name in app-private storage, encrypted with an Android
 * Keystore key. Each item is the file `ogw_secure_storage/<name in URL-safe Base64>` under `Context.getNoBackupFilesDir()`,
 * which Auto Backup and device-to-device transfer skip. The file holds the 12-byte GCM nonce and the AES-256-GCM
 * ciphertext of the UTF-8 text, with the item name as associated data. The Keystore key `ogw-secure-storage` never
 * leaves the device and needs no user authentication, so an operation never shows an OS window. The operations run one
 * at a time on one background thread, in the order they started.
 */
public class OgwSecureStoragePlugin extends GodotPlugin {
	// Result status of an operation, the values of `TokenStorage.Status` of AuthCore.
	private static final int STATUS_OK = 0;
	private static final int STATUS_NOT_FOUND = 1;
	private static final int STATUS_FAILED = 4;

	private static final String KEYSTORE = "AndroidKeyStore";
	private static final String KEY_ALIAS = "ogw-secure-storage";
	private static final String TRANSFORMATION = "AES/GCM/NoPadding";
	private static final int NONCE_BYTES = 12;
	private static final int TAG_BITS = 128;
	private static final String FOLDER = "ogw_secure_storage";

	private enum Op { READ, WRITE, REMOVE }

	private static final class Result {
		final int status;
		/** Item text of a read that is `STATUS_OK`. */
		final String text;

		Result(int status, String text) {
			this.status = status;
			this.text = text;
		}
	}

	private final Object lock = new Object();
	private final ExecutorService queue = Executors.newSingleThreadExecutor();
	private long nextId = 1;
	/** Operations not ended yet whose caller still waits. */
	private final HashSet<Long> waiting = new HashSet<>();
	/** Ended operations the caller has not taken yet. */
	private final HashMap<Long, Result> results = new HashMap<>();

	public OgwSecureStoragePlugin(Godot godot) {
		super(godot);
	}

	@Override
	public String getPluginName() {
		return "OgwSecureStorage";
	}

	/** Starts reading the item `name`. The operation ID, or 0 when `name` is empty. */
	@UsedByGodot
	public long start_read(String name) {
		return start(Op.READ, name, null);
	}

	/** Starts writing `text` as the item `name`. The operation ID, or 0 when `name` is empty. */
	@UsedByGodot
	public long start_write(String name, String text) {
		return start(Op.WRITE, name, text == null ? "" : text);
	}

	/** Starts removing the item `name`. The operation ID, or 0 when `name` is empty. */
	@UsedByGodot
	public long start_remove(String name) {
		return start(Op.REMOVE, name, null);
	}

	/**
	 * Empty until operation `id` ends, then `[status, text]` once: `text` is the item text of a read that is
	 * `STATUS_OK`, else empty. `[STATUS_FAILED, ""]` for an ID with no operation.
	 */
	@UsedByGodot
	public String[] take_result(long id) {
		synchronized (lock) {
			if (waiting.contains(id)) {
				return new String[0];
			}
			Result result = results.remove(id);
			if (result == null) {
				result = new Result(STATUS_FAILED, "");
			}
			return new String[] { Integer.toString(result.status), result.text };
		}
	}

	/** The caller stopped waiting for operation `id`: its result is dropped. */
	@UsedByGodot
	public void cancel(long id) {
		synchronized (lock) {
			waiting.remove(id);
			results.remove(id);
		}
	}

	private long start(final Op op, final String name, final String text) {
		if (name == null || name.isEmpty()) {
			return 0;
		}
		final Context context = getContext();
		final long id;
		synchronized (lock) {
			id = nextId++;
			waiting.add(id);
		}
		queue.execute(() -> {
			Result result;
			try {
				result = run(context, op, name, text);
			} catch (RuntimeException e) {
				result = new Result(STATUS_FAILED, "");
			}
			synchronized (lock) {
				if (waiting.remove(id)) {
					results.put(id, result);
				}
			}
		});
		return id;
	}

	private static Result run(Context context, Op op, String name, String text) {
		if (context == null) {
			return new Result(STATUS_FAILED, "");
		}
		File file = itemFile(context, name);
		byte[] associated = name.getBytes(StandardCharsets.UTF_8);
		switch (op) {
			case READ:
				return read(file, associated);
			case WRITE:
				return write(file, associated, text);
			case REMOVE:
				if (!file.exists()) {
					return new Result(STATUS_NOT_FOUND, "");
				}
				return new Result(file.delete() ? STATUS_OK : STATUS_FAILED, "");
		}
		return new Result(STATUS_FAILED, "");
	}

	private static File itemFile(Context context, String name) {
		String encoded = Base64.encodeToString(name.getBytes(StandardCharsets.UTF_8),
				Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
		return new File(new File(context.getNoBackupFilesDir(), FOLDER), encoded);
	}

	private static Result read(File file, byte[] associated) {
		if (!file.exists()) {
			return new Result(STATUS_NOT_FOUND, "");
		}
		try {
			byte[] stored = readAll(file);
			if (stored.length < NONCE_BYTES) {
				return new Result(STATUS_FAILED, "");
			}
			SecretKey key = key(false);
			if (key == null) {
				return new Result(STATUS_FAILED, "");
			}
			Cipher cipher = Cipher.getInstance(TRANSFORMATION);
			cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, stored, 0, NONCE_BYTES));
			cipher.updateAAD(associated);
			byte[] plain = cipher.doFinal(stored, NONCE_BYTES, stored.length - NONCE_BYTES);
			String text = StandardCharsets.UTF_8.newDecoder()
					.onMalformedInput(CodingErrorAction.REPORT)
					.onUnmappableCharacter(CodingErrorAction.REPORT)
					.decode(ByteBuffer.wrap(plain))
					.toString();
			return new Result(STATUS_OK, text);
		} catch (IOException | GeneralSecurityException e) {
			return new Result(STATUS_FAILED, "");
		}
	}

	private static Result write(File file, byte[] associated, String text) {
		File folder = file.getParentFile();
		if (folder == null || (!folder.isDirectory() && !folder.mkdirs())) {
			return new Result(STATUS_FAILED, "");
		}
		File temporary = new File(folder, file.getName() + ".tmp");
		try {
			SecretKey key = key(true);
			if (key == null) {
				return new Result(STATUS_FAILED, "");
			}
			Cipher cipher = Cipher.getInstance(TRANSFORMATION);
			// The Keystore makes the nonce: a caller-chosen nonce is refused for an encryption key.
			cipher.init(Cipher.ENCRYPT_MODE, key);
			cipher.updateAAD(associated);
			byte[] sealed = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
			byte[] nonce = cipher.getIV();
			if (nonce == null || nonce.length != NONCE_BYTES) {
				return new Result(STATUS_FAILED, "");
			}
			try (FileOutputStream out = new FileOutputStream(temporary)) {
				out.write(nonce);
				out.write(sealed);
				out.getFD().sync();
			}
			if (!temporary.renameTo(file)) {
				temporary.delete();
				return new Result(STATUS_FAILED, "");
			}
			return new Result(STATUS_OK, "");
		} catch (IOException | GeneralSecurityException e) {
			temporary.delete();
			return new Result(STATUS_FAILED, "");
		}
	}

	private static byte[] readAll(File file) throws IOException {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try (FileInputStream in = new FileInputStream(file)) {
			byte[] buffer = new byte[4096];
			int count;
			while ((count = in.read(buffer)) != -1) {
				out.write(buffer, 0, count);
			}
		}
		return out.toByteArray();
	}

	/** The Keystore key of the items; when `create` is true, made first when it does not exist. Null without one. */
	private static SecretKey key(boolean create) throws GeneralSecurityException, IOException {
		KeyStore store = KeyStore.getInstance(KEYSTORE);
		store.load(null);
		KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
		if (entry instanceof KeyStore.SecretKeyEntry) {
			return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
		}
		if (!create) {
			return null;
		}
		KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
		generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
				KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
				.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
				.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
				.setKeySize(256)
				.build());
		return generator.generateKey();
	}
}
