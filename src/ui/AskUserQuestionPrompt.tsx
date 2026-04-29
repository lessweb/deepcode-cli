import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import type { AskUserQuestionAnswers, AskUserQuestionItem } from "./askUserQuestion";
import { useTerminalInput } from "./PromptInput";

type Props = {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: AskUserQuestionAnswers) => void;
  onCancel: () => void;
};

const OTHER_VALUE = "__other__";

type OptionEntry = {
  label: string;
  description?: string;
  value: string;
  isOther?: boolean;
};

export function AskUserQuestionPrompt({ questions, onSubmit, onCancel }: Props): React.ReactElement | null {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserQuestionAnswers>({});
  const [selectedValues, setSelectedValues] = useState<Record<number, string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const question = questions[questionIndex];
  const options = useMemo(() => buildOptions(question), [question]);
  const selectedForQuestion = selectedValues[questionIndex] ?? [];
  const otherText = otherTexts[questionIndex] ?? "";
  const isCurrentOther = options[cursorIndex]?.isOther === true;

  useEffect(() => {
    if (!statusMessage) {
      return;
    }
    const timer = setTimeout(() => setStatusMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    setQuestionIndex(0);
    setCursorIndex(0);
    setAnswers({});
    setSelectedValues({});
    setOtherTexts({});
    setStatusMessage(null);
  }, [questions]);

  useEffect(() => {
    if (cursorIndex >= options.length) {
      setCursorIndex(Math.max(0, options.length - 1));
    }
  }, [cursorIndex, options.length]);

  useTerminalInput((input, key) => {
    if (!question) {
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }

    if (key.tab || key.rightArrow) {
      moveQuestion(1);
      return;
    }

    if (key.leftArrow) {
      moveQuestion(-1);
      return;
    }

    if (key.upArrow) {
      setCursorIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setCursorIndex((index) => Math.min(options.length - 1, index + 1));
      return;
    }

    if (key.backspace && isCurrentOther) {
      setOtherTexts((prev) => ({
        ...prev,
        [questionIndex]: (prev[questionIndex] ?? "").slice(0, -1)
      }));
      return;
    }

    if (key.return) {
      commitCurrentQuestion();
      return;
    }

    if (isCurrentOther && input && !key.ctrl && !key.meta && !input.startsWith("\u001B")) {
      const sanitized = input.replace(/\r/g, "");
      if (sanitized) {
        setOtherTexts((prev) => ({
          ...prev,
          [questionIndex]: `${prev[questionIndex] ?? ""}${sanitized}`
        }));
      }
      return;
    }

    if (question.multiSelect && input === " " && !key.ctrl && !key.meta) {
      toggleCurrentOption();
      return;
    }

    if (question.multiSelect && input && /^[1-9]$/.test(input)) {
      const nextIndex = Number(input) - 1;
      if (nextIndex >= 0 && nextIndex < options.length) {
        toggleOption(options[nextIndex]?.value ?? "");
      }
    }
  });

  if (!question) {
    return null;
  }

  function moveQuestion(direction: -1 | 1): void {
    if (questions.length <= 1) {
      return;
    }
    setQuestionIndex((index) => Math.max(0, Math.min(questions.length - 1, index + direction)));
    setCursorIndex(0);
  }

  function toggleCurrentOption(): void {
    const value = options[cursorIndex]?.value;
    if (value) {
      toggleOption(value);
    }
  }

  function toggleOption(value: string): void {
    setSelectedValues((prev) => {
      const current = prev[questionIndex] ?? [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...prev, [questionIndex]: next };
    });
  }

  function commitCurrentQuestion(): void {
    const answer = buildAnswerForQuestion(question, options[cursorIndex], selectedForQuestion, otherText);
    if (!answer) {
      setStatusMessage(question.multiSelect
        ? "Select at least one option with Space, or type an Other answer."
        : "Select an option, or type an Other answer.");
      return;
    }

    const nextAnswers = {
      ...answers,
      [question.question]: answer
    };
    setAnswers(nextAnswers);

    if (questionIndex >= questions.length - 1) {
      onSubmit(nextAnswers);
      return;
    }

    setQuestionIndex((index) => index + 1);
    setCursorIndex(0);
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>Answer questions</Text>
        <Text dimColor>  {questionIndex + 1}/{questions.length}</Text>
      </Box>
      {questions.length > 1 ? <QuestionTabs questions={questions} currentIndex={questionIndex} answers={answers} /> : null}
      <Text bold>{question.question}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const isCursor = index === cursorIndex;
          const isSelected = option.isOther
            ? selectedForQuestion.includes(OTHER_VALUE) || Boolean(otherText.trim())
            : selectedForQuestion.includes(option.value) || answers[question.question] === option.label;
          const marker = question.multiSelect ? (isSelected ? "[x]" : "[ ]") : (isSelected ? "●" : "○");
          return (
            <Box key={option.value} flexDirection="column">
              <Text color={isCursor ? "cyanBright" : undefined}>
                {isCursor ? "› " : "  "}{marker} <Text bold={isCursor}>{option.label}</Text>
              </Text>
              {option.isOther ? (
                <Box marginLeft={4} marginTop={0} borderStyle="single" borderColor={isCursor ? "cyanBright" : "gray"} paddingX={1} width={64}>
                  {otherText ? (
                    <Text color="white">{otherText}{isCursor ? <Text color="cyanBright">▌</Text> : null}</Text>
                  ) : (
                    <Text dimColor>{isCursor ? "type your answer here" : "type a custom answer"}</Text>
                  )}
                </Box>
              ) : null}
              {option.description ? (
                <Text dimColor>      {option.description}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {statusMessage ?? (isCurrentOther
            ? "Type your answer · Backspace edit · Enter submit/next · ↑ choose presets · Esc type manually"
            : question.multiSelect
              ? "↑/↓ move · Space toggle · Enter submit/next · Tab switch · Esc type manually"
              : "↑/↓ move · Enter select/next · Tab switch · Esc type manually")}
        </Text>
      </Box>
    </Box>
  );
}

function QuestionTabs({
  questions,
  currentIndex,
  answers
}: {
  questions: AskUserQuestionItem[];
  currentIndex: number;
  answers: AskUserQuestionAnswers;
}): React.ReactElement {
  return (
    <Box marginBottom={1}>
      {questions.map((question, index) => {
        const answered = Boolean(answers[question.question]);
        const label = ` ${answered ? "✓" : "□"} Q${index + 1} `;
        return (
          <Text key={question.question} inverse={index === currentIndex} color={answered ? "green" : undefined}>
            {label}
          </Text>
        );
      })}
    </Box>
  );
}

function buildOptions(question: AskUserQuestionItem | undefined): OptionEntry[] {
  if (!question) {
    return [];
  }
  return [
    ...question.options.map((option) => ({
      label: option.label,
      description: option.description,
      value: option.label
    })),
    {
      label: "Other",
      value: OTHER_VALUE,
      isOther: true
    }
  ];
}

function buildAnswerForQuestion(
  question: AskUserQuestionItem,
  focusedOption: OptionEntry | undefined,
  selectedValues: string[],
  otherText: string
): string | null {
  const trimmedOther = otherText.trim();
  if (question.multiSelect) {
    const labels = selectedValues
      .filter((value) => value !== OTHER_VALUE)
      .map((value) => value.trim())
      .filter(Boolean);
    if (selectedValues.includes(OTHER_VALUE) && !trimmedOther) {
      return null;
    }
    if (trimmedOther) {
      labels.push(trimmedOther);
    }
    return labels.length > 0 ? labels.join(", ") : null;
  }

  if (!focusedOption) {
    return null;
  }
  if (focusedOption.isOther) {
    return trimmedOther || null;
  }
  return focusedOption.label;
}
