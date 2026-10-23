import type { Logging } from '../index.ts';
import { create_fake_adapter } from './adapters/fake.ts';

export { create_fake_adapter } from './adapters/fake.ts';
export type { FakeAnalyticsController, FakeCall } from './adapters/fake.ts';

/** `logging` has no `## DEV` operation. */
export type LoggingDev = Record<string, never>;

/**
 * The DEV code of the server instance's `logging`: adapter name `fake` makes a fake analytics adapter when the server
 * instance gives none. Called before `begin_start`.
 */
export function create_logging_dev(logging: Logging): LoggingDev {
  logging.include_dev_code({ create_fake_analytics: () => create_fake_adapter('analytics').adapter });
  return {};
}
