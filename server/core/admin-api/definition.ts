/**
 * The checks of an admin operation object handed to `register_admin_operation` (`## error`): its form, its role,
 * a role `read` operation with `operation_id`, a content admin operation name without `game_`.
 */
import { EXPORTED_ROLES, type AdminOperation, type FieldMap, type FieldType } from './types.ts';

export const CONTENT_MODULE = 'game';

const SCALAR_KINDS = new Set(['int64', 'int32', 'bool', 'string', 'json']);
const QUERY_KINDS = new Set(['int64', 'int32', 'string']);

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_field_type(value: unknown): value is FieldType {
  if (!is_record(value) || typeof value.kind !== 'string') return false;
  if (SCALAR_KINDS.has(value.kind)) return true;
  switch (value.kind) {
    case 'enum':
      return Array.isArray(value.elements) && value.elements.length > 0 && value.elements.every((e) => typeof e === 'string');
    case 'array':
      return is_field_type(value.element);
    case 'object':
      return is_field_map(value.fields);
    case 'object_union':
      return is_record(value.fields) && Object.keys(value.fields).length > 0 && Object.values(value.fields).every(is_field_type);
    default:
      return false;
  }
}

function is_field_map(value: unknown): value is FieldMap {
  if (!is_record(value)) return false;
  return Object.values(value).every((spec) => is_record(spec) && is_field_type(spec.type) && (spec.optional === undefined || typeof spec.optional === 'boolean'));
}

function optional_function(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'function';
}

/** Form errors: the fields of the TypeScript form and their types. */
function form_errors(raw: Record<string, unknown>, label: string): string[] {
  const errors: string[] = [];
  if (raw.body !== 'json' && raw.body !== 'binary') errors.push(`${label} has a body form that is neither json nor binary`);
  if (!is_field_map(raw.input)) errors.push(`${label} has no input field map of {type, optional}`);
  if (typeof raw.handler !== 'function') errors.push(`${label} has no handler function`);
  if (!optional_function(raw.prepare) || !optional_function(raw.audit_args)) errors.push(`${label} has a prepare or audit_args that is not a function`);
  if (raw.user_target !== null && typeof raw.user_target !== 'string') errors.push(`${label} has a user_target that is neither a field name nor null`);
  return errors;
}

/** Rule errors of an operation whose form is right. */
function rule_errors(module: string, operation: AdminOperation, label: string): string[] {
  const errors: string[] = [];
  if (!(EXPORTED_ROLES as readonly string[]).includes(operation.role)) errors.push(`${label} has no role or a role outside ${EXPORTED_ROLES.join(', ')}`);
  if (operation.role === 'read' && Object.hasOwn(operation.input, 'operation_id')) errors.push(`${label} has role read and an operation_id input field`);
  if (module === CONTENT_MODULE && !operation.name.startsWith('game_')) errors.push(`content ${label} does not start with game_`);
  if (operation.body === 'binary') {
    const limit = operation.max_body_bytes;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) errors.push(`${label} is a binary body operation without a byte limit`);
    if (!Object.values(operation.input).every((spec) => QUERY_KINDS.has(spec.type.kind))) errors.push(`${label} is a binary body operation with a query field that is not int64, int32 or string`);
  }
  if (operation.user_target !== null && operation.input[operation.user_target]?.type.kind !== 'int64') errors.push(`${label} has a user_target that is not an int64 input field`);
  return errors;
}

/** The operation when it is a well formed admin operation, or its start failures. */
export function check_definition(module: string, raw: unknown): AdminOperation | string[] {
  if (!is_record(raw) || typeof raw.name !== 'string' || raw.name === '') return [`an admin operation of ${module} has no name`];
  const label = `admin operation ${raw.name} of ${module}`;
  const form = form_errors(raw, label);
  if (form.length > 0) return form;
  const operation = raw as unknown as AdminOperation;
  const rules = rule_errors(module, operation, label);
  return rules.length > 0 ? rules : operation;
}
