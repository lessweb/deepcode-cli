/**
 * Shared server service types.
 *
 * Summary:
 * Defines JSON-like payload types shared by server services during the HTTP
 * module split.
 *
 * Exports:
 * - JsonValue
 */
export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
