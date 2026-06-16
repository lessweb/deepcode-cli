import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

type AskUserQuestionOption = {
  label: string;
  description?: string;
};

type AskUserQuestionItem = {
  question: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
};

type AskUserQuestionMetadata = {
  kind: "ask_user_question";
  questions: AskUserQuestionItem[];
};

export async function handleAskUserQuestionTool(
  args: Record<string, unknown>,
  _context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const questions = parseQuestions(args.questions);
  if (!questions.ok) {
    return {
      ok: false,
      name: "AskUserQuestion",
      error: questions.error,
    };
  }

  const metadata: AskUserQuestionMetadata = {
    kind: "ask_user_question",
    questions: questions.value,
  };

  return {
    ok: true,
    name: "AskUserQuestion",
    output: buildQuestionSummary(questions.value),
    metadata,
    awaitUserResponse: true,
  };
}

function parseQuestions(raw: unknown): { ok: true; value: AskUserQuestionItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error: '"questions" must be a non-empty array.',
    };
  }

  const questions: AskUserQuestionItem[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        error: `Question at index ${index} must be an object.`,
      };
    }

    const question =
      typeof (item as { question?: unknown }).question === "string"
        ? (item as { question: string }).question.trim()
        : "";
    if (!question) {
      return {
        ok: false,
        error: `Question at index ${index} is missing a non-empty "question" string.`,
      };
    }

    const rawOptions = (item as { options?: unknown }).options;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      return {
        ok: false,
        error: `Question at index ${index} must include a non-empty "options" array.`,
      };
    }

    const options: AskUserQuestionOption[] = [];
    for (let optionIndex = 0; optionIndex < rawOptions.length; optionIndex += 1) {
      const option = rawOptions[optionIndex];
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return {
          ok: false,
          error: `Option ${optionIndex} for question ${index} must be an object.`,
        };
      }

      const label =
        typeof (option as { label?: unknown }).label === "string" ? (option as { label: string }).label.trim() : "";
      if (!label) {
        return {
          ok: false,
          error: `Option ${optionIndex} for question ${index} is missing a non-empty "label" string.`,
        };
      }

      const description =
        typeof (option as { description?: unknown }).description === "string"
          ? (option as { description: string }).description.trim()
          : undefined;

      options.push({
        label,
        description: description || undefined,
      });
    }

    const multiSelect =
      typeof (item as { multiSelect?: unknown }).multiSelect === "boolean"
        ? (item as { multiSelect: boolean }).multiSelect
        : undefined;

    questions.push({
      question,
      multiSelect,
      options,
    });
  }

  return {
    ok: true,
    value: questions,
  };
}

function buildQuestionSummary(questions: AskUserQuestionItem[]): string {
  const lines = ["Waiting for user input."];

  questions.forEach((item, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${item.question}`);
    lines.push(`   Mode: ${item.multiSelect ? "multi-select" : "single-select"}`);
    item.options.forEach((option) => {
      lines.push(`   - ${option.label}`);
      if (option.description) {
        lines.push(`     ${option.description}`);
      }
    });
    lines.push("   - Other");
  });

  return lines.join("\n");
}
