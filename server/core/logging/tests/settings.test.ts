import { readFileSync } from 'node:fs';

const SCHEMA = JSON.parse(readFileSync(new URL('../../../../settings/core-settings.schema.json', import.meta.url), 'utf8')) as { properties: Record<string, { minimum?: number }> };

describe('core settings schema', () => {
  it('gives the logging keys the minimums of the spec', () => {
    // maxEventParams: the param count of core_iap_granted. maxStringLength: the length of core_attendance_claimed.
    expect(SCHEMA.properties['logging.maxEventParams']?.minimum).toBe(5);
    expect(SCHEMA.properties['logging.maxStringLength']?.minimum).toBe('core_attendance_claimed'.length);
    expect(SCHEMA.properties['logging.analyticsSendTimeoutMs']?.minimum).toBe(1);
    expect(SCHEMA.properties['logging.analyticsDeletionMaxAttempts']?.minimum).toBe(1);
    expect(SCHEMA.properties['logging.analyticsDeletionIntervalMs']?.minimum).toBe(1);
    expect(SCHEMA.properties['logging.securityRepeatWindowMs']?.minimum).toBe(1);
  });
});
