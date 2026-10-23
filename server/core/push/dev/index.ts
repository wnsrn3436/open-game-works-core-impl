/** The DEV code of `push`: fake adapters for the keys that select `fake` and that the server instance was not given. */
import type { Push } from '../index.ts';
import { create_fake_adapter } from './adapters/fake.ts';

/** `push` has no `## DEV` operation. DEV code instances make the fake adapters here before server start. */
export type PushDev = Record<string, never>;

export function create_push_dev(push: Push): PushDev {
  push.use_fake_adapters((key) => create_fake_adapter(key).adapter);
  return {};
}
