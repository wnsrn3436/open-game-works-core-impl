import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type * as GameData from '../../../generated/data/game_data.ts';
import { check_mail_input, mail_input_from_json, mail_to_json, type MailItems, type MailLimits } from '../mail_input.ts';
import { start_mail_server, stop_all, type MailServer } from './helpers.ts';

const LIMITS: MailLimits = { max_args: 2, max_arg_length: 8, max_attachments: 2, max_expire_ms: 1000n };
const INT = CoreContract.MailArgKind.MAIL_ARG_KIND_INT;
const TEXT = CoreContract.MailArgKind.MAIL_ARG_KIND_TEXT;

/** Data where every template exists; the attachment check of `item-ledger` is the test's `items_pass`. */
const DATA = { MailTemplateTable: { has_row: (id: number) => id !== 404 } } as unknown as GameData.DataSet;
let items_pass = true;
let ms: MailServer;

beforeAll(async () => {
  ms = await start_mail_server();
});

afterAll(() => {
  stop_all();
});

/** `item-ledger` `make_item_amount`. */
function item_amount(item_id: number, amount: bigint): CoreContract.ItemAmount {
  return ms.ledger.make_item_amount(item_id, amount);
}

/** `item-ledger` `read_amount` and `make_item_amount` of a server instance; `check_add_items` is `items_pass`. */
const ITEMS: MailItems = {
  check_items: () => items_pass,
  read_amount: (item) => ms.ledger.read_amount(item),
  make_item_amount: (item_id, amount) => item_amount(item_id, amount),
};

function check(input: unknown, allow_no_expiry = false): ReturnType<typeof check_mail_input> {
  return check_mail_input(input, DATA, LIMITS, allow_no_expiry, ITEMS);
}

describe('mail input checks', () => {
  it('fills the defaults of a mail input with only template_id', () => {
    const result = check({ template_id: 7 });
    expect(result.ok && result.mail).toEqual({ template_id: 7, args: [], attachments: [], extra_id: 0, expire_ms: 0n, no_expiry: false, once_key: '' });
  });

  it('sets the MailArg kind from the value content code gives', () => {
    const result = check({ template_id: 1, args: [{ name: 'count', int_value: -3n }, { name: 'name', text_value: 'Ann' }] });
    expect(result.ok && result.mail.args.map((arg) => [arg.name, arg.kind, arg.int_value, arg.text_value])).toEqual([
      ['count', INT, -3n, ''],
      ['name', TEXT, 0n, 'Ann'],
    ]);
  });

  it('refuses a MailArg whose field outside its kind is not the default value', () => {
    expect(check({ template_id: 1, args: [{ name: 'a', int_value: 1n, text_value: 'x' }] }).ok).toBe(false);
    expect(check({ template_id: 1, args: [{ name: 'a', text_value: 'x', int_value: 1n, kind: TEXT }] }).ok).toBe(false);
    expect(check({ template_id: 1, args: [{ name: 'a', int_value: 1n, text_value: '' }] }).ok).toBe(true);
    expect(check({ template_id: 1, args: [{ name: 'a', text_value: 'x', int_value: 0n, kind: TEXT }] }).ok).toBe(true);
    expect(check({ template_id: 1, args: [{ name: 'a' }] }).ok).toBe(false);
    expect(check({ template_id: 1, args: [{ name: 'a', int_value: 2n ** 63n }] }).ok).toBe(false);
  });

  it('refuses args, text_value bytes and attachments over the limits', () => {
    const three = [1n, 2n, 3n].map((value) => ({ name: `a${String(value)}`, int_value: value }));
    expect(check({ template_id: 1, args: three }).ok).toBe(false);
    expect(check({ template_id: 1, args: [{ name: 'a', text_value: '12345678' }] }).ok).toBe(true);
    expect(check({ template_id: 1, args: [{ name: 'a', text_value: '가나다' }] }).ok).toBe(false);
    const items = [item_amount(1, 1n), item_amount(2, 1n), item_amount(3, 1n)];
    expect(check({ template_id: 1, attachments: items.slice(0, 2) }).ok).toBe(true);
    expect(check({ template_id: 1, attachments: items }).ok).toBe(false);
  });

  it('refuses a template ID the mail_template table does not have and attachments item-ledger.check_add_items refuses', () => {
    expect(check({ template_id: 404 }).ok).toBe(false);
    items_pass = false;
    try {
      expect(check({ template_id: 1, attachments: [item_amount(1, 1n)] }).ok).toBe(false);
      expect(check({ template_id: 1 }).ok).toBe(true);
    } finally {
      items_pass = true;
    }
  });

  it('refuses an expire_ms below 0 or over mailbox.maxExpireMs', () => {
    expect(check({ template_id: 1, expire_ms: -1n }).ok).toBe(false);
    expect(check({ template_id: 1, expire_ms: 1001n }).ok).toBe(false);
    expect(check({ template_id: 1, expire_ms: 1000n }).ok).toBe(true);
  });

  it('takes no_expiry true only where grant_or_mail allows it', () => {
    expect(check({ template_id: 1, no_expiry: true }).ok).toBe(false);
    expect(check({ template_id: 1, no_expiry: true }, true).ok).toBe(true);
  });

  it('refuses fields of the wrong type', () => {
    for (const input of [null, [], { template_id: 1.5 }, { template_id: 1, extra_id: '2' }, { template_id: 1, once_key: 3 }, { template_id: 1, args: {} }]) {
      expect(check(input).ok).toBe(false);
    }
  });
});

describe('big encoding pair', () => {
  it('keeps an attachment amount over 2^53−1 in big_amount and refuses a big_amount that is not a big integer', () => {
    const big = 2n ** 53n;
    const result = check({ template_id: 1, attachments: [{ item_id: 4, amount: 0n, big_amount: big.toString() }, { item_id: 5, amount: big - 1n, big_amount: '' }] });
    expect(result.ok && result.mail.attachments.map((item) => [item.item_id, item.amount, item.big_amount])).toEqual([
      [4, 0n, big.toString()],
      [5, big - 1n, ''],
    ]);
    expect(check({ template_id: 1, attachments: [{ item_id: 4, amount: 0n, big_amount: '01' }] }).ok).toBe(false);
    expect(check({ template_id: 1, attachments: [{ item_id: 4, amount: 1, big_amount: '' }] }).ok).toBe(false);
  });
});

describe('mail input JSON', () => {
  it('reads the admin form of args, int64 as integers or decimal strings', () => {
    const input = mail_input_from_json({
      template_id: 3,
      args: [
        { name: 'count', value: { int_value: '9007199254740993' } },
        { name: 'name', value: { text_value: 'Bo' } },
        { name: 'small', value: { int_value: 4 } },
      ],
      attachments: [{ item_id: 2, amount: '5' }],
      expire_ms: 60000,
    });
    expect(input).toEqual({
      template_id: 3,
      args: [
        { name: 'count', int_value: 9007199254740993n },
        { name: 'name', text_value: 'Bo' },
        { name: 'small', int_value: 4n },
      ],
      attachments: [{ item_id: 2, amount: 5n, big_amount: '' }],
      extra_id: 0,
      expire_ms: 60000n,
      no_expiry: false,
      once_key: '',
    });
  });

  it('refuses JSON that is not the mail input form', () => {
    for (const json of [
      { template_id: 1, unknown: 1 },
      { template_id: 1, args: [{ name: 'a', value: { int_value: 1, text_value: 'x' } }] },
      { template_id: 1, args: [{ name: 'a', value: { int_value: 1.5 } }] },
      { template_id: 1, args: [{ name: 'a', value: { int_value: '1e3' } }] },
      { template_id: 1, expire_ms: '-0x1' },
      { template_id: 1, no_expiry: 1 },
      { template_id: '1' },
    ]) {
      expect(mail_input_from_json(json)).toBeNull();
    }
  });

  it('writes a checked mail so that reading it back gives the same checked mail', () => {
    const result = check({
      template_id: 5,
      args: [{ name: 'n', int_value: -2n }, { name: 't', text_value: 'hi' }],
      attachments: [item_amount(8, 2n ** 60n)],
      extra_id: 4,
      expire_ms: 900n,
    });
    if (!result.ok) throw new Error(result.reason);
    const json: unknown = JSON.parse(JSON.stringify(mail_to_json(result.mail)));
    const again = check(mail_input_from_json(json));
    expect(again.ok && again.mail).toEqual(result.mail);
  });
});
