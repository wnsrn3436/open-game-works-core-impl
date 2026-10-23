/** The `chat` `## settings` values of the module input. */

export interface ChatSettings {
  readonly world_channel_count: number;
  readonly max_text_length: number;
  readonly min_interval_ms: number;
  readonly max_fetch_count: number;
  readonly poll_interval_ms: number;
  readonly retention_ms: number;
  readonly allow_child: boolean;
  readonly max_channel_list_count: number;
  readonly channel_poll_interval_ms: number;
  readonly max_system_text_bytes: number;
  readonly nickname_lookup_count: number;
  readonly room_code_length: number;
  readonly room_code_alphabet: string;
}

function integer(settings: Readonly<Record<string, unknown>>, key: string, min: number): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new TypeError(`chat: setting ${key} is not an integer of ${String(min)} or more`);
  return value;
}

/** Reads the settings of `chat` `## settings`. A missing or wrong value throws. */
export function read_settings(settings: Readonly<Record<string, unknown>>): ChatSettings {
  const allow_child = settings['chat.allowChild'];
  if (typeof allow_child !== 'boolean') throw new TypeError('chat: setting chat.allowChild is not a boolean');
  const alphabet = settings['matchmaker.roomCodeAlphabet'];
  if (typeof alphabet !== 'string') throw new TypeError('chat: setting matchmaker.roomCodeAlphabet is not a string');
  return {
    world_channel_count: integer(settings, 'chat.worldChannelCount', 0),
    max_text_length: integer(settings, 'chat.maxTextLength', 1),
    min_interval_ms: integer(settings, 'chat.minIntervalMs', 0),
    max_fetch_count: integer(settings, 'chat.maxFetchCount', 1),
    poll_interval_ms: integer(settings, 'chat.pollIntervalMs', 0),
    retention_ms: integer(settings, 'chat.retentionMs', 0),
    allow_child,
    max_channel_list_count: integer(settings, 'chat.maxChannelListCount', 1),
    channel_poll_interval_ms: integer(settings, 'chat.channelPollIntervalMs', 0),
    max_system_text_bytes: integer(settings, 'chat.maxSystemTextBytes', 1),
    nickname_lookup_count: integer(settings, 'nickname.maxLookupCount', 1),
    room_code_length: integer(settings, 'matchmaker.roomCodeLength', 1),
    room_code_alphabet: alphabet,
  };
}
