import { canonical_json } from '../../storage/canonical_json.ts';
import {
  deploy_list_bytes,
  deploy_list_cache_control,
  file_cache_control,
  FormatError,
  next_sequence,
  parse_deploy_list_input,
  referenced_files,
  unknown_data_versions,
} from '../deploy_list.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const DATA_VERSION = 'p1-d1';

function valid_input(): Record<string, unknown> {
  return {
    app: { android: { min_version: '1.0.0', recommended_version: '1.2.0', store_url: 'https://play.example.com/app' } },
    patches: {
      '1.2.0': {
        data_version: DATA_VERSION,
        data_files: [{ name: 'item.bin', size: 10, sha256: SHA_A }],
        translation_files: [{ language: 'ko', name: 'ko.bin', size: 5, sha256: SHA_B }],
        bundle_files: [{ bundle: 'ui', name: 'ui.pck', size: 7, sha256: SHA_C }],
      },
    },
  };
}

/** `valid_input()` with `change` applied to the patch entry `1.2.0`. */
function with_patch(change: (patch: Record<string, unknown>) => void): Record<string, unknown> {
  const input = valid_input();
  change((input.patches as Record<string, Record<string, unknown>>)['1.2.0'] as Record<string, unknown>);
  return input;
}

function rejects(input: unknown): void {
  expect(() => parse_deploy_list_input(input)).toThrow(FormatError);
}

describe('publish_deploy_list step 1 format', () => {
  it('accepts a valid input', () => {
    const parsed = parse_deploy_list_input(valid_input());
    expect(parsed.patches['1.2.0']?.data_version).toBe(DATA_VERSION);
    expect(referenced_files(parsed)).toEqual([
      { sha256: SHA_A, size: 10 },
      { sha256: SHA_B, size: 5 },
      { sha256: SHA_C, size: 7 },
    ]);
  });

  it('rejects a repeated name in one list and across the lists of one patch entry', () => {
    rejects(with_patch((p) => {
      p.data_files = [{ name: 'x.bin', size: 1, sha256: SHA_A }, { name: 'x.bin', size: 1, sha256: SHA_B }];
    }));
    rejects(with_patch((p) => {
      p.bundle_files = [{ bundle: 'ui', name: 'item.bin', size: 1, sha256: SHA_C }];
    }));
  });

  it('accepts the same name in two patch entries', () => {
    const input = valid_input();
    const patches = input.patches as Record<string, unknown>;
    patches['1.3.0'] = patches['1.2.0'];
    expect(() => parse_deploy_list_input(input)).not.toThrow();
  });

  it('rejects names that start with . or end with .tmp or .bak, and names outside [a-z0-9_.-]', () => {
    for (const name of ['.hidden', 'item.tmp', 'item.bak', 'Item.bin', 'item bin', 'item/bin', '']) {
      rejects(with_patch((p) => {
        p.data_files = [{ name, size: 1, sha256: SHA_A }];
      }));
    }
  });

  it('rejects a repeated language in translation_files', () => {
    rejects(with_patch((p) => {
      p.translation_files = [
        { language: 'ko', name: 'ko1.bin', size: 1, sha256: SHA_A },
        { language: 'ko', name: 'ko2.bin', size: 1, sha256: SHA_B },
      ];
    }));
  });

  it('rejects size 0 and sizes that are not integers', () => {
    for (const size of [0, -1, 1.5, '1', null, true]) {
      rejects(with_patch((p) => {
        p.data_files = [{ name: 'a.bin', size, sha256: SHA_A }];
      }));
    }
  });

  it('rejects a sha256 that is not 64 lowercase hex', () => {
    for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      rejects(with_patch((p) => {
        p.data_files = [{ name: 'a.bin', size: 1, sha256 }];
      }));
    }
  });

  it('rejects unknown fields at every level', () => {
    rejects({ ...valid_input(), extra: 1 });
    const app = valid_input();
    (app.app as Record<string, Record<string, unknown>>).android = { min_version: '1.0.0', recommended_version: '1.0.0', store_url: 'https://a.example.com', extra: 1 };
    rejects(app);
    rejects(with_patch((p) => {
      p.extra = 1;
    }));
    rejects(with_patch((p) => {
      p.data_files = [{ name: 'a.bin', size: 1, sha256: SHA_A, extra: 1 }];
    }));
  });

  it('rejects missing fields and an unknown platform', () => {
    rejects({ app: {} });
    rejects(with_patch((p) => {
      delete p.bundle_files;
    }));
    const input = valid_input();
    (input.app as Record<string, unknown>).playstation = { min_version: '1.0.0', recommended_version: '1.0.0', store_url: 'https://a.example.com' };
    rejects(input);
  });

  it('rejects wrong version forms in app and in patches keys', () => {
    for (const version of ['1.0', '1.0.0.0', 'v1.0.0', '01.0.0', '1.0.0-beta', '']) {
      const input = valid_input();
      (input.app as Record<string, Record<string, unknown>>).android = { min_version: version, recommended_version: '2.0.0', store_url: 'https://a.example.com' };
      rejects(input);
      const patches = valid_input();
      (patches.patches as Record<string, unknown>)[version] = (patches.patches as Record<string, unknown>)['1.2.0'];
      rejects(patches);
    }
  });

  it('rejects min_version above recommended_version, comparing numbers', () => {
    const input = valid_input();
    (input.app as Record<string, Record<string, unknown>>).android = { min_version: '1.10.0', recommended_version: '1.9.0', store_url: 'https://a.example.com' };
    rejects(input);
    (input.app as Record<string, Record<string, unknown>>).android = { min_version: '1.9.0', recommended_version: '1.10.0', store_url: 'https://a.example.com' };
    expect(() => parse_deploy_list_input(input)).not.toThrow();
  });

  it('rejects a store_url that is not https', () => {
    for (const store_url of ['http://a.example.com', 'not a url', 'ftp://a.example.com']) {
      const input = valid_input();
      (input.app as Record<string, Record<string, unknown>>).android = { min_version: '1.0.0', recommended_version: '1.0.0', store_url };
      rejects(input);
    }
  });
});

describe('publish_deploy_list step 3 data version', () => {
  it('names entries whose data_version is neither client_data_version nor compat_client_data_version', () => {
    const parsed = parse_deploy_list_input(valid_input());
    expect(unknown_data_versions(parsed, DATA_VERSION, null)).toEqual([]);
    expect(unknown_data_versions(parsed, 'p2-d2', DATA_VERSION)).toEqual([]);
    expect(unknown_data_versions(parsed, 'p2-d2', 'p3-d3')).toEqual(['1.2.0']);
  });
});

describe('sequence', () => {
  it('is published_at without a stored deploy list and max(previous + 1, published_at) after one', () => {
    expect(next_sequence(null, 1000n)).toBe(1000n);
    expect(next_sequence(1000n, 1000n)).toBe(1001n);
    expect(next_sequence(1000n, 5000n)).toBe(5000n);
    expect(next_sequence(9000n, 5000n)).toBe(9001n);
  });
});

describe('serialization', () => {
  it('orders keys by UTF-8 bytes with no whitespace and writes bigint as an integer', () => {
    expect(canonical_json({ b: 1, a: [2, { d: 'x', c: true }], Z: null, big: 12345678901234567890n })).toBe(
      '{"Z":null,"a":[2,{"c":true,"d":"x"}],"b":1,"big":12345678901234567890}',
    );
    expect(canonical_json({ é: 1, z: 2 })).toBe('{"z":2,"é":1}');
  });

  it('writes the server fields and the operator fields of a deploy list', () => {
    const bytes = deploy_list_bytes(parse_deploy_list_input(valid_input()), { environment: 'LOCAL', sequence: 7n, published_at: 5n, file_base_url: 'files/' });
    const text = Buffer.from(bytes).toString('utf8');
    expect(text.startsWith('{"app":')).toBe(true);
    expect(text).not.toMatch(/\s/);
    expect(JSON.parse(text)).toMatchObject({ format: 1, environment: 'LOCAL', sequence: 7, published_at: 5, file_base_url: 'files/' });
  });
});

describe('Cache-Control', () => {
  it('is the cache time ms divided by 1000, rounded down', () => {
    expect(deploy_list_cache_control(60999)).toBe('public, max-age=60');
    expect(file_cache_control(31536000000)).toBe('public, max-age=31536000, immutable');
    expect(deploy_list_cache_control(999)).toBe('public, max-age=0');
  });
});
