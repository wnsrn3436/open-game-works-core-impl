/**
 * Mail input (`mailbox` `## API`): the TypeScript form content code and core modules pass, its checks for
 * `MailResult.INVALID_INPUT`, and its JSON form (admin operation `mail` and the `mailbox_broadcast` `mail` column).
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';

/** A `MailArg` content code passes: an integer or a string. `kind` is set by `mailbox`. */
export type MailArgInput =
  | { readonly name: string; readonly int_value: bigint; readonly text_value?: string; readonly kind?: CoreContract.MailArgKind }
  | { readonly name: string; readonly text_value: string; readonly int_value?: bigint; readonly kind?: CoreContract.MailArgKind };

/** An `ItemAmount`: item ID value and the big encoding pair of the amount. */
export interface ItemAmountInput {
  readonly item_id: number;
  readonly amount: bigint;
  readonly big_amount: string;
}

/** Mail input: the object `send_mail` and `broadcast_mail` take. Fields left out take their default. */
export interface MailInput {
  readonly template_id: number;
  readonly args?: readonly MailArgInput[];
  readonly attachments?: readonly ItemAmountInput[];
  readonly extra_id?: number;
  readonly expire_ms?: bigint;
  readonly no_expiry?: boolean;
  readonly once_key?: string;
}

/** A mail input after its checks, in the form `mailbox` stores. */
export interface CheckedMail {
  readonly template_id: number;
  readonly args: CoreContract.MailArg[];
  readonly attachments: CoreContract.ItemAmount[];
  readonly extra_id: number;
  readonly expire_ms: bigint;
  readonly no_expiry: boolean;
  readonly once_key: string;
}

/** The limits of mail input (core settings of `mailbox`). */
export interface MailLimits {
  readonly max_args: number;
  readonly max_arg_length: number;
  readonly max_attachments: number;
  readonly max_expire_ms: bigint;
}

export type CheckResult = { readonly ok: true; readonly mail: CheckedMail } | { readonly ok: false; readonly reason: string };

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const INT32_MAX = 2 ** 31 - 1;
const DECIMAL_INTEGER = /^-?(0|[1-9][0-9]*)$/;
const text_encoder = new TextEncoder();

function fail(reason: string): CheckResult {
  return { ok: false, reason };
}

function is_record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_int32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -INT32_MAX - 1 && value <= INT32_MAX;
}

function is_int64(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= INT64_MIN && value <= INT64_MAX;
}

/** What mail input uses of `item-ledger`. */
export interface MailItems {
  /** `item-ledger.check_add_items` on a list: true when it is `OK`. */
  check_items(items: readonly CoreContract.ItemAmount[]): boolean;
  /** `item-ledger.read_amount`. */
  read_amount(item: CoreContract.ItemAmount): bigint | null;
  /** `item-ledger.make_item_amount`. */
  make_item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount;
}

/** The amount of an `ItemAmountInput` from content code or JSON. null when its fields are not a big encoding pair. */
export function amount_of(item: ItemAmountInput, items: MailItems): bigint | null {
  if (typeof item.amount !== 'bigint' || typeof item.big_amount !== 'string') return null;
  return items.read_amount(item as CoreContract.ItemAmount);
}

function check_arg(arg: unknown, limits: MailLimits): CoreContract.MailArg | string {
  if (!is_record(arg) || typeof arg.name !== 'string') return 'arg is not a MailArg';
  const has_int = arg.int_value !== undefined;
  const has_text = arg.text_value !== undefined;
  let kind = arg.kind;
  if (kind === undefined) kind = has_int ? CoreContract.MailArgKind.MAIL_ARG_KIND_INT : has_text ? CoreContract.MailArgKind.MAIL_ARG_KIND_TEXT : undefined;
  const out = new CoreContract.MailArg();
  out.name = arg.name;
  if (kind === CoreContract.MailArgKind.MAIL_ARG_KIND_INT) {
    if (!is_int64(arg.int_value)) return `arg ${arg.name} has no int64 int_value`;
    if (has_text && arg.text_value !== '') return `arg ${arg.name} is an integer with a text_value`;
    out.kind = kind;
    out.int_value = arg.int_value;
    return out;
  }
  if (kind === CoreContract.MailArgKind.MAIL_ARG_KIND_TEXT) {
    if (typeof arg.text_value !== 'string') return `arg ${arg.name} has no string text_value`;
    if (has_int && arg.int_value !== 0n) return `arg ${arg.name} is a string with an int_value`;
    if (text_encoder.encode(arg.text_value).length > limits.max_arg_length) return `arg ${arg.name} text_value is over the length limit`;
    out.kind = kind;
    out.text_value = arg.text_value;
    return out;
  }
  return `arg ${arg.name} has no kind`;
}

function check_args(args: unknown, limits: MailLimits): CoreContract.MailArg[] | string {
  if (!Array.isArray(args)) return 'args is not a list';
  if (args.length > limits.max_args) return 'args are over the limit';
  const out: CoreContract.MailArg[] = [];
  for (const arg of args as readonly unknown[]) {
    const checked = check_arg(arg, limits);
    if (typeof checked === 'string') return checked;
    out.push(checked);
  }
  return out;
}

function check_expire_ms(value: unknown, limits: MailLimits): bigint | string {
  const ms = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value;
  if (typeof ms !== 'bigint') return 'expire_ms is not an integer';
  if (ms < 0n) return 'expire_ms is below 0';
  if (ms > limits.max_expire_ms) return 'expire_ms is over mailbox.maxExpireMs';
  return ms;
}

function check_scalars(input: Readonly<Record<string, unknown>>, allow_no_expiry: boolean): string | null {
  const { extra_id, no_expiry, once_key } = input;
  if (!is_int32(input.template_id)) return 'template_id is not an int32';
  if (extra_id !== undefined && !is_int32(extra_id)) return 'extra_id is not an int32';
  if (no_expiry !== undefined && typeof no_expiry !== 'boolean') return 'no_expiry is not a bool';
  if (no_expiry === true && !allow_no_expiry) return 'no_expiry is true outside grant_or_mail';
  if (once_key !== undefined && typeof once_key !== 'string') return 'once_key is not a string';
  return null;
}

function check_attachments(attachments: unknown, limits: MailLimits, items: MailItems): CoreContract.ItemAmount[] | string {
  if (!Array.isArray(attachments)) return 'attachments is not a list';
  if (attachments.length > limits.max_attachments) return 'attachments are over the limit';
  const out: CoreContract.ItemAmount[] = [];
  for (const item of attachments as readonly unknown[]) {
    if (!is_record(item) || !is_int32(item.item_id)) return 'attachment is not an ItemAmount';
    const amount = amount_of(item as unknown as ItemAmountInput, items);
    if (amount === null) return 'attachment is not an ItemAmount';
    out.push(items.make_item_amount(item.item_id, amount));
  }
  if (out.length > 0 && !items.check_items(out)) return 'attachments do not pass item-ledger.check_add_items';
  return out;
}

/**
 * Checks a mail input for `MailResult.INVALID_INPUT` with the server build data and `item-ledger.check_add_items`.
 * `allow_no_expiry` is true only for the `send_mail` of `grant_or_mail` step 3.
 */
export function check_mail_input(
  input: unknown,
  data: GameData.DataSet,
  limits: MailLimits,
  allow_no_expiry: boolean,
  items: MailItems,
): CheckResult {
  if (!is_record(input)) return fail('mail input is not an object');
  const scalar = check_scalars(input, allow_no_expiry);
  if (scalar !== null) return fail(scalar);
  const template_id = input.template_id as number;
  if (!data.MailTemplateTable.has_row(template_id)) return fail(`template ${String(template_id)} is not in the mail_template table`);
  const args = check_args(input.args ?? [], limits);
  if (typeof args === 'string') return fail(args);
  const attachments = check_attachments(input.attachments ?? [], limits, items);
  if (typeof attachments === 'string') return fail(attachments);
  const expire_ms = check_expire_ms(input.expire_ms ?? 0n, limits);
  if (typeof expire_ms === 'string') return fail(expire_ms);
  return {
    ok: true,
    mail: {
      template_id,
      args,
      attachments,
      extra_id: (input.extra_id as number | undefined) ?? 0,
      expire_ms,
      no_expiry: input.no_expiry === true,
      once_key: (input.once_key as string | undefined) ?? '',
    },
  };
}

function int64_json(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) return null;
  const parsed = BigInt(value);
  return parsed >= INT64_MIN && parsed <= INT64_MAX ? parsed : null;
}

function only_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function arg_from_json(json: unknown): MailArgInput | null {
  if (!is_record(json) || !only_keys(json, ['name', 'value']) || typeof json.name !== 'string' || !is_record(json.value)) return null;
  const value = json.value;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  if (keys[0] === 'int_value') {
    const int_value = int64_json(value.int_value);
    return int_value === null ? null : { name: json.name, int_value };
  }
  if (keys[0] === 'text_value' && typeof value.text_value === 'string') return { name: json.name, text_value: value.text_value };
  return null;
}

function item_from_json(json: unknown): ItemAmountInput | null {
  if (!is_record(json) || !only_keys(json, ['item_id', 'amount', 'big_amount']) || !is_int32(json.item_id)) return null;
  const amount = int64_json(json.amount ?? 0);
  const big_amount = json.big_amount ?? '';
  if (amount === null || typeof big_amount !== 'string') return null;
  return { item_id: json.item_id, amount, big_amount };
}

function list_from_json<T>(json: unknown, read: (item: unknown) => T | null): T[] | null {
  if (json === undefined) return [];
  if (!Array.isArray(json)) return null;
  const out: T[] = [];
  for (const item of json as readonly unknown[]) {
    const value = read(item);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

const MAIL_JSON_KEYS = ['template_id', 'args', 'attachments', 'extra_id', 'expire_ms', 'no_expiry', 'once_key'];

/**
 * A mail input from its JSON form: `args` is `array<object{name: string, value: object union{int_value: int64,
 * text_value: string}}>`, `int64` values are JSON integers or decimal strings. null when the JSON is not that form.
 * Limits and data are checked later by `check_mail_input`.
 */
export function mail_input_from_json(json: unknown): MailInput | null {
  if (!is_record(json) || !only_keys(json, MAIL_JSON_KEYS)) return null;
  const args = list_from_json(json.args, arg_from_json);
  const attachments = list_from_json(json.attachments, item_from_json);
  const expire_ms = int64_json(json.expire_ms ?? 0);
  const scalars = scalars_from_json(json);
  if (args === null || attachments === null || expire_ms === null || scalars === null) return null;
  return { ...scalars, args, attachments, expire_ms };
}

function scalars_from_json(json: Readonly<Record<string, unknown>>): Pick<Required<MailInput>, 'template_id' | 'extra_id' | 'no_expiry' | 'once_key'> | null {
  const { template_id, extra_id = 0, no_expiry = false, once_key = '' } = json;
  if (!is_int32(template_id) || !is_int32(extra_id) || typeof no_expiry !== 'boolean' || typeof once_key !== 'string') return null;
  return { template_id, extra_id, no_expiry, once_key };
}

/** The JSON form of a checked mail. `int64` values are decimal strings. */
export function mail_to_json(mail: CheckedMail): Record<string, unknown> {
  return {
    template_id: mail.template_id,
    args: mail.args.map((arg) => ({
      name: arg.name,
      value: arg.kind === CoreContract.MailArgKind.MAIL_ARG_KIND_INT ? { int_value: arg.int_value.toString() } : { text_value: arg.text_value },
    })),
    attachments: mail.attachments.map((item) => ({ item_id: item.item_id, amount: item.amount.toString(), big_amount: item.big_amount })),
    extra_id: mail.extra_id,
    expire_ms: mail.expire_ms.toString(),
    no_expiry: mail.no_expiry,
    once_key: mail.once_key,
  };
}
