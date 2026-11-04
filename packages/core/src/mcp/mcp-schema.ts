import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import Ajv2019 from "ajv/dist/2019.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export type McpInputSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
  $defs?: Record<string, unknown>;
  definitions?: Record<string, unknown>;
  [keyword: string]: unknown;
};

export type PreparedMcpInputSchema = {
  parameters: McpInputSchema & { properties: Record<string, unknown> };
  validateArguments?: (args: Record<string, unknown>) => string | undefined;
};

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const SCHEMA_ARRAYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMAS = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
]);

/** Keep references and composition intact; only adapt tuples for the model API. */
export function prepareMcpInputSchema(inputSchema?: McpInputSchema): PreparedMcpInputSchema {
  const original: McpInputSchema = structuredClone(
    isObject(inputSchema) ? inputSchema : { type: "object", properties: {} }
  );
  let hasTuples = false;
  let hasPrefixItems = false;

  const locations = new Map<string, string>();
  const references: Array<{ node: Record<string, unknown>; sourceRoot: string; targetRoot: string }> = [];

  const visit = (node: unknown, source = "", target = "", sourceRoot = "", targetRoot = ""): unknown => {
    locations.set(source, target);
    if (!isObject(node)) return node;
    if (typeof node.$id === "string" && !node.$id.startsWith("#")) {
      sourceRoot = source;
      targetRoot = target;
    }
    const child = (schema: unknown, from: string[], to = from) =>
      visit(schema, pointer(source, ...from), pointer(target, ...to), sourceRoot, targetRoot);
    const modern = Array.isArray(node.prefixItems);
    const tuple = modern ? node.prefixItems : node.items;
    const out: Record<string, unknown> = Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        if (Array.isArray(tuple) && ["items", "prefixItems", "additionalItems"].includes(key)) {
          return [key, value]; // Converted below, with reference locations recorded.
        }
        if ((SCHEMA_MAPS.has(key) || key === "dependencies") && isObject(value)) {
          return [
            key,
            Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, child(schema, [key, name])])),
          ];
        }
        if (SCHEMA_ARRAYS.has(key) && Array.isArray(value)) {
          return [key, value.map((schema, index) => child(schema, [key, String(index)]))];
        }
        return [key, SCHEMAS.has(key) ? child(value, [key]) : value];
      })
    );

    if (Array.isArray(tuple)) {
      hasTuples = true;
      hasPrefixItems ||= modern;
      const tupleKey = modern ? "prefixItems" : "items";
      const tailKey = modern ? "items" : "additionalItems";
      const tail = node[tailKey];
      const alternatives = tuple.map((schema, index) =>
        child(schema, [tupleKey, String(index)], ["items", "anyOf", String(index)])
      );
      // An omitted tail is unconstrained. Keep every branch, including an open
      // tail, so valid server arguments and references into tuple items survive.
      alternatives.push(child(tail ?? {}, [tailKey], ["items", "anyOf", String(tuple.length)]));
      out.items = { anyOf: alternatives };
      if (tail === false) {
        out.maxItems = typeof out.maxItems === "number" ? Math.min(out.maxItems, tuple.length) : tuple.length;
      }
      delete out.prefixItems;
      delete out.additionalItems;
    }
    references.push({ node: out, sourceRoot, targetRoot });
    return out;
  };

  const parameters = visit(structuredClone(original)) as PreparedMcpInputSchema["parameters"];
  // Tuple conversion relocates schemas such as /items/0. Rewrite only local
  // schema references, never strings in defaults, enums or examples.
  for (const { node, sourceRoot, targetRoot } of references) {
    for (const keyword of ["$ref", "$dynamicRef", "$recursiveRef"]) {
      const ref = node[keyword];
      if (typeof ref !== "string" || (ref !== "#" && !ref.startsWith("#/"))) continue;
      let fragment: string;
      try {
        fragment = decodeURIComponent(ref.slice(1));
      } catch {
        continue;
      }
      const relocated = locations.get(sourceRoot + fragment);
      if (relocated !== undefined && relocated !== sourceRoot + fragment) {
        node[keyword] = "#" + encodeURI(relocated.slice(targetRoot.length)).replace(/#/g, "%23");
      }
    }
  }
  parameters.properties ??= {};
  if (!hasTuples) return { parameters };

  // Compile lazily so one unsupported server schema cannot prevent discovery
  // of other tools. Compilation failures still block this tool's execution.
  let validate: ValidateFunction | undefined;
  let compilationError: string | undefined;
  return {
    parameters,
    validateArguments(args) {
      if (!validate && !compilationError) {
        try {
          const dialect = original.$schema;
          const Validator =
            dialect === "https://json-schema.org/draft/2020-12/schema" || (!dialect && hasPrefixItems)
              ? Ajv2020
              : dialect === "https://json-schema.org/draft/2019-09/schema"
                ? Ajv2019
                : Ajv;
          const ajv = new Validator({
            strict: false,
            coerceTypes: false,
            useDefaults: false,
            removeAdditional: false,
          });
          addFormats(ajv);
          validate = ajv.compile(original as AnySchema);
          if ("$async" in validate && validate.$async) throw new Error("Asynchronous schemas are not supported.");
        } catch (error) {
          validate = undefined;
          compilationError = `Cannot validate MCP tool arguments: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (compilationError) return compilationError;
      if (validate!(args)) return undefined;
      const error = validate!.errors?.[0];
      return `Invalid MCP tool arguments at ${error?.instancePath || "/"}: ${error?.message ?? "schema validation failed"}.`;
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointer(base: string, ...parts: string[]): string {
  return base + parts.map((part) => "/" + part.replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}
