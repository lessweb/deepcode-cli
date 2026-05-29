import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "../tools/executor";

export type ValidationResult = { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

export function semanticBoolean(defaultValue = false) {
  return z.preprocess((value) => {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return value;
  }, z.boolean().default(defaultValue));
}

export function semanticInteger(label: string, options: { min?: number } = {}) {
  return z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim()) {
        return Number(value);
      }
      return value;
    },
    z
      .number()
      .int()
      .min(options.min ?? Number.MIN_SAFE_INTEGER, `${label} must be >= ${options.min ?? Number.MIN_SAFE_INTEGER}.`)
  );
}

export async function executeValidatedTool<TSchema extends z.ZodType<Record<string, unknown>>>(
  name: string,
  schema: TSchema,
  rawArgs: Record<string, unknown>,
  context: ToolExecutionContext,
  handler: (input: z.infer<TSchema>, context: ToolExecutionContext) => Promise<ToolExecutionResult>,
  options: {
    preprocess?: (args: Record<string, unknown>) => ValidationResult;
  } = {}
): Promise<ToolExecutionResult> {
  const preprocessed: ValidationResult = options.preprocess
    ? options.preprocess(rawArgs)
    : { ok: true, input: rawArgs };
  if (!preprocessed.ok) {
    return {
      ok: false,
      name,
      error: `InputValidationError: ${preprocessed.error}`,
    };
  }

  const parsed = schema.safeParse(preprocessed.input);
  if (!parsed.success) {
    return {
      ok: false,
      name,
      error: `InputValidationError: ${formatZodError(parsed.error)}`,
    };
  }

  return handler(parsed.data, context);
}

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid tool input.";
  }

  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
