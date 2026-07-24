import type { CarouselApi } from "@/webview/components/ui/carousel";
import { Carousel, CarouselContent, CarouselItem } from "@/webview/components/ui/carousel";
import React, { useCallback, useEffect } from "react";
import { Card, CardContent } from "@/webview/components/ui/card";
import { Button } from "@/webview/components/ui/button";
import { ChevronDownIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { buildAskUserQuestionReply } from "@/webview/utils";
import * as z from "zod";
import { useChat } from "@/webview/context";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/webview/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/webview/components/ui/field";
import { Checkbox } from "@/webview/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/webview/components/ui/radio-group";
import { Input } from "@/webview/components/ui/input";

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

interface AskQuestionCarouselProps {
  questions: Question[];
  onClose: () => void;
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

const AskQuestionCarousel: React.FC<AskQuestionCarouselProps> = ({ questions, onClose }) => {
  const { actions } = useChat();
  const [api, setApi] = React.useState<CarouselApi>();
  const [open, setOpen] = React.useState(true);
  const [current, setCurrent] = React.useState(0);
  const [count, setCount] = React.useState(0);

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
    watchedAnswers?.every((a: { options?: string[]; other?: string }) => {
      const opts = a?.options ?? [];
      const oth = a?.other ?? "";
      return opts.length === 0 && oth.trim().length === 0;
    }) ?? true;

  const onSubmit = useCallback(
    async (data: AnswerFormValues) => {
      console.log(JSON.stringify(data.answers));
      const reply = buildAskUserQuestionReply(data?.answers || []);
      console.log("reply:", JSON.stringify(reply));
      if (!reply.ok) {
        console.log("reply.error:", reply.error || "Please answer the question.");
        form.setError("answers", { message: reply.error || "Please answer the question." });
        return;
      }

      // Build Q&A summary
      const summary = questions
        .map((q, idx) => {
          const ans = data.answers[idx];
          const ansText =
            (ans?.options && ans.options.length > 0 ? ans.options.join(", ") : "") +
            (ans?.options && ans.options.length > 0 && ans?.other ? "; " : "") +
            (ans?.other ?? "");
          return `Q: ${q.question}\nA: ${ansText || "(无回答)"}`;
        })
        .join("\n\n");

      // // Insert system message via RPC (persisted in session)
      // try {
      //   await chatService.addSystemMessage(summary, { kind: "ask_user_question_summary" });
      // } catch (err) {
      //   console.error("Failed to add system message:", err);
      // }

      // Close the carousel
      onClose?.();

      // Send the user reply to backend
      actions.sendPrompt(summary || "", [], [], { askUserQuestionSummary: true });
    },
    [form, actions, questions, onClose]
  );

  useEffect(() => {
    if (!api) {
      return;
    }
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);
    api.on("select", () => {
      setCurrent(api.selectedScrollSnap() + 1);
    });
  }, [api]);

  if (!questions || questions.length === 0) {
    return null;
  }

  return (
    <form className="w-full max-w-237.5 mx-auto min-w-sm px-4 py-2" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="border border-primary rounded-md w-full">
        <CardContent>
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <div className="group flex justify-between items-center cursor-pointer px-2 w-full">
                <span className="text-primary truncate">{questions[0]?.question || `Question ${current}`}</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose?.();
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                  <ChevronDownIcon className="ml-auto size-4 group-data-[state=open]:rotate-180" />
                </div>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col items-start gap-2 text-sm">
              <Carousel setApi={setApi} className="w-full">
                <CarouselContent>
                  {questions.map((q, index) => (
                    <CarouselItem key={index}>
                      <Card className="m-0 rounded-none border border-x-0 border-primary py-0" size="sm">
                        <CardContent className="p-4">
                          <FieldGroup className="gap-0">
                            {q.multiSelect ? (
                              (q.options || []).map((opt: { label: string; description?: string }, optIdx: number) => (
                                <Controller
                                  key={optIdx}
                                  name={`answers.${index}.options`}
                                  control={form.control}
                                  render={({ field, fieldState }) => (
                                    <Field
                                      data-invalid={fieldState.invalid}
                                      className="flex items-start gap-2 cursor-pointer text-sm"
                                      orientation="horizontal"
                                    >
                                      <Checkbox
                                        id={`q-${index}-${optIdx}`}
                                        checked={field.value?.includes(opt.label) ?? false}
                                        onCheckedChange={(checked) => {
                                          const newValue = checked
                                            ? [...(field.value || []), opt.label]
                                            : field.value
                                              ? field.value.filter((v: string) => v !== opt.label)
                                              : [];
                                          field.onChange(newValue);
                                        }}
                                      />
                                      <FieldContent>
                                        <FieldLabel htmlFor={`q-${index}-${optIdx}`}>
                                          <span className="font-medium cursor-pointer text-xs">{opt.label}</span>
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
                                name={`answers.${index}.options`}
                                control={form.control}
                                render={({ field, fieldState }) => (
                                  <RadioGroup
                                    value={field.value?.[0] ?? ""}
                                    onValueChange={(val) => field.onChange([val])}
                                    aria-invalid={fieldState.invalid}
                                  >
                                    {(q.options || []).map(
                                      (opt: { label: string; description?: string }, optIdx: number) => (
                                        <Field orientation="horizontal" key={optIdx} data-invalid={fieldState.invalid}>
                                          <RadioGroupItem
                                            value={opt.label}
                                            id={`q-${index}-${optIdx}`}
                                            aria-invalid={fieldState.invalid}
                                          />
                                          <FieldContent>
                                            <FieldLabel htmlFor={`q-${index}-${optIdx}`}>
                                              <span className="font-medium cursor-pointer text-xs">{opt.label}</span>
                                            </FieldLabel>
                                            {opt.description && (
                                              <FieldDescription className="block text-xs text-muted-foreground">
                                                {opt.description}
                                              </FieldDescription>
                                            )}
                                          </FieldContent>
                                        </Field>
                                      )
                                    )}
                                  </RadioGroup>
                                )}
                              />
                            )}
                            <Controller
                              name={`answers.${index}.other`}
                              control={form.control}
                              render={({ field, fieldState }) => (
                                <Field className="pt-1" data-invalid={fieldState.invalid}>
                                  <FieldLabel htmlFor={`q-${index}-other`} className="text-xs">
                                    Other
                                  </FieldLabel>
                                  <Input
                                    {...field}
                                    id={`q-${index}-other`}
                                    className="w-full mt-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm resize-none"
                                    placeholder="Type your answer if none of the options fit"
                                    data-invalid={fieldState.invalid}
                                  />
                                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                              )}
                            />
                          </FieldGroup>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <div className="flex justify-between items-center text-center text-sm">
          <div className="flex items-center gap-1">
            <Button variant="ghost" disabled={!api?.canScrollPrev()} size="icon" onClick={() => api?.scrollPrev()}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" disabled={!api?.canScrollNext()} size="icon" onClick={() => api?.scrollNext()}>
              <ChevronRight />
            </Button>
            <span className="text-xs">
              {current}/{count}
            </span>
          </div>
          <div className="pr-2">
            <Button type="submit" size="sm" className="text-xs" disabled={allEmpty}>
              Submit
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
};

export default AskQuestionCarousel;
