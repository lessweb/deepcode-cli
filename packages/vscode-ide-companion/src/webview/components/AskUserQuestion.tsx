import { useCallback } from "react";
import { Button } from "@/webview/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/webview/components/ui/field";
import { Checkbox } from "@/webview/components/ui/checkbox";
import { Textarea } from "@/webview/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/webview/components/ui/radio-group";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { buildAskUserQuestionReply } from "@/webview/utils";

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  multiSelect?: boolean;
  options?: QuestionOption[];
}

interface ToolData {
  ok: boolean;
  name: string;
  output: string;
  metadata?: {
    kind?: string;
    questions?: Question[];
  };
}

interface AskUserQuestionProps {
  toolData: ToolData;
}
const answerSchema = z
  .object({
    question: z.string(),
    options: z.array(z.string()).optional(),
    other: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const opts = data.options ?? [];
    const oth = data.other ?? "";
    if (opts.length === 0 && oth.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Please answer the question.",
        path: ["other"],
      });
    }
  });

const formSchema = z.object({
  answers: z.array(answerSchema),
});

export type AnswerFormValues = z.infer<typeof formSchema>;

export default function AskUserQuestion({ toolData }: AskUserQuestionProps) {
  const questions = toolData.metadata?.questions || [];

  const form = useForm<AnswerFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      answers: questions.map((q) => ({
        question: q.question,
        options: [] as string[],
        other: "",
      })),
    },
  });

  // 实时监听每个问题的答案，用于决定是否禁用提交按钮
  const watchedAnswers = form.watch("answers");
  const allEmpty =
    watchedAnswers?.every((a) => {
      const opts = a?.options ?? [];
      const oth = a?.other ?? "";
      return opts.length === 0 && oth.trim().length === 0;
    }) ?? true;

  const onSubmit = useCallback(
    (data: AnswerFormValues) => {
      console.log(JSON.stringify(data.answers));
      const reply = buildAskUserQuestionReply(data?.answers || []);
      console.log("reply:", JSON.stringify(reply));
      if (!reply.ok) {
        console.log("reply.error:", reply.error || "Please answer the question.");
        form.setError("answers", { message: reply.error || "Please answer the question." });
        return;
      }
      // sendUserPromptText(reply.text);
    },
    [form]
  );

  if (questions.length === 0) {
    return <div className="text-sm text-muted-foreground">{toolData.output || "No questions were provided."}</div>;
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">The agent needs your input before it can continue. </div>
        {questions.map((q, qIdx) => (
          <Card key={qIdx} size="sm">
            <CardHeader>
              <CardTitle>{q.question || `Question ${qIdx + 1}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {q.multiSelect ? (
                  (q.options || []).map((opt, optIdx) => (
                    <Controller
                      key={optIdx}
                      name={`answers.${qIdx}.options`}
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field
                          data-invalid={fieldState.invalid}
                          className="flex items-start gap-2 cursor-pointer text-sm"
                          orientation="horizontal"
                        >
                          <Checkbox
                            id={`q-${qIdx}-${optIdx}`}
                            checked={field.value?.includes(opt.label) ?? false}
                            onCheckedChange={(checked) => {
                              const newValue = checked
                                ? [...(field.value || []), opt.label]
                                : field.value
                                  ? field.value.filter((v) => v !== opt.label)
                                  : [];
                              field.onChange(newValue);
                            }}
                          />
                          <FieldContent>
                            <FieldLabel htmlFor={`q-${qIdx}-${optIdx}`}>
                              <span className="font-medium">{opt.label}</span>
                            </FieldLabel>
                            {opt.description && (
                              <FieldDescription className="block text-xs text-muted-foreground">
                                {opt.description}
                              </FieldDescription>
                            )}
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                          </FieldContent>
                        </Field>
                      )}
                    />
                  ))
                ) : (
                  <Controller
                    name={`answers.${qIdx}.options`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <RadioGroup
                        value={field.value?.[0] ?? ""}
                        onValueChange={(val) => field.onChange([val])}
                        aria-invalid={fieldState.invalid}
                      >
                        {(q.options || []).map((opt, optIdx) => (
                          <Field orientation="horizontal" key={optIdx} data-invalid={fieldState.invalid}>
                            <RadioGroupItem
                              value={opt.label}
                              id={`q-${qIdx}-${optIdx}`}
                              aria-invalid={fieldState.invalid}
                            />
                            <FieldContent>
                              <FieldLabel htmlFor={`q-${qIdx}-${optIdx}`}>
                                <span className="font-medium">{opt.label}</span>
                              </FieldLabel>
                              {opt.description && (
                                <FieldDescription className="block text-xs text-muted-foreground">
                                  {opt.description}
                                </FieldDescription>
                              )}
                            </FieldContent>
                          </Field>
                        ))}
                      </RadioGroup>
                    )}
                  />
                )}
                <Controller
                  name={`answers.${qIdx}.other`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field className="pt-1" data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`q-${qIdx}-other`} className="text-xs text-muted-foreground">
                        Other
                      </FieldLabel>
                      <Textarea
                        {...field}
                        id={`q-${qIdx}-other`}
                        className="w-full mt-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm resize-none"
                        rows={2}
                        placeholder="Type your answer if none of the options fit"
                        data-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Field orientation="horizontal" className="flex justify-end gap-2">
                <Button type="submit" disabled={allEmpty}>
                  Submit
                </Button>
              </Field>
            </CardFooter>
          </Card>
        ))}
      </div>
    </form>
  );
}
