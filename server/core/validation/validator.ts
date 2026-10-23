/** Runs the field validators the contract tool generated from `(ogw.v)`, by request name or module message name. */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';

/** The output of a validation that passed. */
export type Pass = 'pass';
export const PASS: Pass = 'pass';

/** A decoded contract message. */
export interface Message {
  encode(): Uint8Array;
}

type Validate = (message: Message, data: GameData.DataSet) => CoreContract.ValidationFailure | null;

interface MessageValidator {
  readonly message_class: abstract new () => Message;
  readonly validate: Validate;
}

/** The module messages `validate_message` checks. */
export type ModuleMessageName = 'MatchResult' | 'MatchInputLog' | 'PlaySessionResult' | 'PlaySessionStartOptions' | 'PlaySessionContinueOptions';

/** A validator of messages of one generated class. */
function validator<T extends Message>(messageClass: abstract new () => T, validate: (message: T, data: GameData.DataSet) => CoreContract.ValidationFailure | null): MessageValidator {
  return { message_class: messageClass, validate: validate as Validate };
}

function moduleMessageValidators(): ReadonlyMap<string, MessageValidator> {
  return new Map<ModuleMessageName, MessageValidator>([
    ['MatchResult', validator(GameContract.MatchResult, GameContract.validate_MatchResult)],
    ['MatchInputLog', validator(GameContract.MatchInputLog, GameContract.validate_MatchInputLog)],
    ['PlaySessionResult', validator(GameContract.PlaySessionResult, GameContract.validate_PlaySessionResult)],
    ['PlaySessionStartOptions', validator(GameContract.PlaySessionStartOptions, GameContract.validate_PlaySessionStartOptions)],
    ['PlaySessionContinueOptions', validator(GameContract.PlaySessionContinueOptions, GameContract.validate_PlaySessionContinueOptions)],
  ]);
}

/** No declaration to check: the field validator of a request the contract tool made none for. */
const NO_RULES: Validate = () => null;

/**
 * The validators of game `rpc`s and core `rpc`s by request name. A request the contract tool made no field validator
 * for has nothing to check and passes.
 */
function requestValidators(): ReadonlyMap<string, MessageValidator> {
  const out = new Map<string, MessageValidator>();
  for (const rpc of [...GameContract.RPCS, ...CoreContract.RPCS]) {
    out.set(rpc.name, { message_class: rpc.request_class, validate: rpc.validate ?? NO_RULES });
  }
  return out;
}

function run(validator: MessageValidator, what: string, message: Message, data: GameData.DataSet): Pass | CoreContract.ValidationFailure {
  if (!(message instanceof validator.message_class)) throw new TypeError(`${what} is not given its own message class`);
  return validator.validate(message, data) ?? PASS;
}

/** The field validators of one server instance's contract generated code and server build data. */
export class Validators {
  private readonly requests = requestValidators();
  private readonly messages = moduleMessageValidators();
  private readonly data: GameData.DataSet;

  constructor(data: GameData.DataSet) {
    this.data = data;
  }

  /** `validate_request`. Throws for a name that is not a request of the contract. */
  request(requestName: string, message: Message): Pass | CoreContract.ValidationFailure {
    const validator = this.requests.get(requestName);
    if (validator === undefined) throw new Error(`validate_request: request ${JSON.stringify(requestName)} is not a request of the contract`);
    return run(validator, `validate_request: request ${requestName}`, message, this.data);
  }

  /** `validate_message`. Throws for a name that is not a module message `validate_message` checks. */
  message(messageName: string, message: Message): Pass | CoreContract.ValidationFailure {
    const validator = this.messages.get(messageName);
    if (validator === undefined) throw new Error(`validate_message: ${JSON.stringify(messageName)} is not a message validate_message checks`);
    return run(validator, `validate_message: message ${messageName}`, message, this.data);
  }
}
