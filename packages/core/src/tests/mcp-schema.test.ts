import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { prepareMcpInputSchema, type McpInputSchema } from "../mcp/mcp-schema";

test("MCP parameters preserve definitions, reference namespaces and root constraints", () => {
  const original: McpInputSchema = {
    type: "object",
    required: ["body", "legacy", "modern"],
    additionalProperties: false,
    properties: {
      body: { $ref: "#/$defs/CreateDelegationRequest" },
      legacy: { allOf: [{ $ref: "#/definitions/Value" }], description: "Legacy value" },
      modern: { $ref: "#/$defs/Value" },
      escaped: { $ref: "#/$defs/a~1b~0c" },
    },
    $defs: {
      CreateDelegationRequest: {
        type: "object",
        properties: { resource: { type: "string" } },
        required: ["resource"],
        additionalProperties: false,
      },
      Value: { type: "integer" },
      "a/b~c": { type: "boolean" },
    },
    definitions: { Value: { type: "string" } },
    allOf: [{ minProperties: 3 }],
  };
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  assert.deepEqual(parameters, original);
  assert.notEqual(parameters, original);
  assert.equal(validateArguments, undefined);
  const validate = new Ajv({ strict: false }).compile(JSON.parse(JSON.stringify(parameters)));
  assert.equal(validate({ body: { resource: "x" }, legacy: "x", modern: 1, escaped: true }), true);
  assert.equal(validate({ body: {}, legacy: "x", modern: 1 }), false);
  assert.equal(validate({ body: { resource: "x" }, legacy: 1, modern: "x" }), false);
});

test("MCP parameters preserve recursive references without expanding them", () => {
  const original: McpInputSchema = {
    type: "object",
    properties: { node: { $ref: "#/$defs/TreeNode" } },
    $defs: {
      TreeNode: { type: "object", properties: { child: { $ref: "#/$defs/TreeNode" } } },
    },
  };
  const { parameters } = prepareMcpInputSchema(original);
  assert.deepEqual(parameters, original);
  assert.equal(new Ajv({ strict: false }).validate(parameters, { node: { child: {} } }), true);
});

test("MCP parameters retain allOf constraints and leave enum/default/examples data untouched", () => {
  const literal = { allOf: [{ x: 1 }], items: [{ $ref: "#/$defs/Missing" }] };
  const original: McpInputSchema = {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: { resource: { type: "string" }, region: { type: "string" } },
        allOf: [{ required: ["resource"] }],
        required: ["region"],
      },
      payload: { enum: [literal], default: literal, examples: [literal] },
    },
  };
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  assert.deepEqual(parameters, original);
  assert.equal(validateArguments, undefined);
  const validate = new Ajv({ strict: false }).compile(parameters);
  assert.equal(validate({ body: { region: "us" } }), false);
  assert.equal(validate({ body: { region: "us", resource: "x" }, payload: literal }), true);
});

function tupleSchema(tail: unknown = false): McpInputSchema {
  return {
    type: "object",
    required: ["pair"],
    additionalProperties: false,
    properties: {
      pair: {
        type: "array",
        items: [{ type: "string" }, { type: "integer" }],
        additionalItems: tail,
        minItems: 2,
      },
      optional: { type: "string", default: "do not insert" },
    },
  };
}

test("tuple conversion widens model parameters but enforces original positions before dispatch", () => {
  const original = tupleSchema();
  const copy = structuredClone(original);
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  const modelValidate = new Ajv({ strict: false }).compile(parameters);
  assert.equal(modelValidate({ pair: [1, "x"] }), true);
  assert.equal(validateArguments!({ pair: ["x", 1] }), undefined);
  for (const args of [{ pair: [1, "x"] }, { pair: ["x", "1"] }, { pair: ["x"] }, { pair: ["x", 1, 2] }]) {
    assert.match(validateArguments!(args)!, /Invalid MCP tool arguments/);
  }
  assert.equal(modelValidate({ pair: ["x", 1, 2] }), false);
  assert.deepEqual(original, copy);
});

test("validation never coerces values, inserts defaults or removes additional properties", () => {
  const { validateArguments } = prepareMcpInputSchema(tupleSchema());
  for (const args of [{ pair: ["x", 1] }, { pair: ["x", "1"] }, { pair: ["x", 1], extra: "keep" }]) {
    const copy = structuredClone(args);
    const error = validateArguments!(args);
    assert.equal(error === undefined, typeof args.pair[1] === "number" && !("extra" in args));
    assert.deepEqual(args, copy);
    assert.equal("optional" in args, false);
  }
  const requiredDefault = tupleSchema();
  requiredDefault.required!.push("optional");
  assert.match(prepareMcpInputSchema(requiredDefault).validateArguments!({ pair: ["x", 1] })!, /required property/);
});

test("open and typed tuple tails remain allowed in the model schema and original validation", () => {
  for (const tail of [true, { type: "boolean" }]) {
    const original = tupleSchema(tail);
    const { parameters, validateArguments } = prepareMcpInputSchema(original);
    const args = { pair: ["x", 1, true] };
    assert.equal(new Ajv({ strict: false }).validate(parameters, args), true);
    assert.equal(validateArguments!(args), undefined);
    assert.match(validateArguments!({ pair: [1, "x", true] })!, /Invalid MCP tool arguments/);
    if (tail !== true) {
      assert.match(validateArguments!({ pair: ["x", 1, "wrong tail"] })!, /must be boolean/);
    }
  }
  const original = tupleSchema();
  delete (original.properties!.pair as Record<string, unknown>).additionalItems;
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  const args = { pair: ["x", 1, { any: "value" }] };
  assert.equal(new Ajv({ strict: false }).validate(parameters, args), true);
  assert.equal(validateArguments!(args), undefined);
});

test("tuple conversion retains stricter maxItems and does not require optional positions", () => {
  const original = tupleSchema();
  const pair = original.properties!.pair as Record<string, unknown>;
  delete pair.minItems;
  pair.maxItems = 1;
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  assert.equal((parameters.properties.pair as Record<string, unknown>).maxItems, 1);
  assert.equal(validateArguments!({ pair: [] }), undefined);
  assert.equal(validateArguments!({ pair: ["x"] }), undefined);
  assert.match(validateArguments!({ pair: ["x", 1] })!, /more than 1 items/);
});

test("nested, referenced and recursive tuples are converted and checked against the entire original schema", () => {
  const original: McpInputSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    type: "object",
    properties: { node: { $ref: "#/$defs/Node" } },
    $defs: {
      Node: {
        type: "object",
        properties: {
          pairs: { type: "array", items: tupleSchema().properties!.pair },
          child: { $ref: "#/$defs/Node" },
          email: { type: "string", format: "email" },
        },
      },
    },
  };
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  const node = parameters.$defs!.Node as any;
  assert.equal(Array.isArray(node.properties.pairs.items.items), false);
  assert.equal(validateArguments!({ node: { child: { pairs: [["x", 1]], email: "a@example.com" } } }), undefined);
  assert.match(validateArguments!({ node: { child: { pairs: [[1, "x"]] } } })!, /Invalid MCP tool arguments/);
  assert.match(validateArguments!({ node: { email: "invalid" } })!, /format "email"/);
});

test("draft 2020-12 prefixItems use their original positional and tail constraints", () => {
  const original: McpInputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      pair: { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }], items: false },
    },
  };
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  assert.equal("prefixItems" in (parameters.properties.pair as object), false);
  assert.equal(validateArguments!({ pair: ["x", 1] }), undefined);
  assert.equal(validateArguments!({ pair: [] }), undefined);
  assert.match(validateArguments!({ pair: [1, "x"] })!, /Invalid MCP tool arguments/);
  assert.match(validateArguments!({ pair: ["x", 1, 2] })!, /Invalid MCP tool arguments/);
});

test("schema maps, dependencies and conditionals are visited without confusing property names with keywords", () => {
  const tuple = tupleSchema().properties!.pair;
  const original: McpInputSchema = {
    type: "object",
    properties: { items: { type: "array", items: { type: "string" } }, allOf: { type: "string" } },
    patternProperties: { "^tuple": tuple },
    dependencies: { items: ["allOf"], allOf: { properties: { dependent: tuple } } },
    if: { required: ["flag"] },
    then: { properties: { conditional: tuple } },
    additionalProperties: tuple as Record<string, unknown>,
  };
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  assert.deepEqual(parameters.properties, original.properties);
  assert.deepEqual((parameters.dependencies as any).items, ["allOf"]);
  assert.equal(Array.isArray((parameters.additionalProperties as any).items), false);
  assert.equal(validateArguments!({ tupleOne: ["x", 1] }), undefined);
  assert.match(validateArguments!({ tupleOne: [1, "x"] })!, /Invalid MCP tool arguments/);
});

test("unresolvable references and unsupported dialects fail closed without blocking normalization", () => {
  for (const extra of [
    { $schema: "https://example.com/unsupported-schema" },
    { allOf: [{ $ref: "https://example.com/unavailable" }] },
    { allOf: [{ $ref: "#/$defs/Missing" }] },
  ]) {
    const { parameters, validateArguments } = prepareMcpInputSchema({ ...tupleSchema(), ...extra });
    assert.ok(parameters.properties.pair);
    assert.match(validateArguments!({ pair: ["x", 1] })!, /Cannot validate MCP tool arguments/);
    assert.match(validateArguments!({ pair: ["x", 1] })!, /Cannot validate MCP tool arguments/);
  }
});

test("references into converted tuple members and tails keep resolving, including scoped and escaped paths", () => {
  const nested = {
    $id: "https://example.com/nested",
    type: "object",
    properties: {
      pairs: { type: "array", items: [{ type: "array", items: [{ type: "string" }] }] },
      label: { $ref: "#/properties/pairs/items/0/items/0" },
    },
  };
  const original: McpInputSchema = {
    type: "object",
    properties: {
      "pair /~#": { type: "array", items: [nested], additionalItems: { type: "boolean" } },
      tail: { $ref: "#/properties/pair%20~1~0%23/additionalItems" },
    },
  };
  const { parameters, validateArguments } = prepareMcpInputSchema(original);
  const validate = new Ajv({ strict: false }).compile(parameters);
  const args = { "pair /~#": [{ pairs: [["x"]], label: "x" }, true], tail: true };
  assert.equal(validate(args), true);
  assert.equal(validateArguments!(args), undefined);
  assert.equal(validate({ tail: "wrong" }), false);
  assert.equal(validate({ "pair /~#": [{ label: 1 }] }), false);
});
