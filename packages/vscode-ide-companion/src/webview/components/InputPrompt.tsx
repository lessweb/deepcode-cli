import React, { useCallback, useEffect, useRef, useState } from "react";
import SkillsPanel from "@/webview/components/SkillsPanel";
import SkillsTags from "@/webview/components/SkillsTags";
import ContextIndicator from "@/webview/components/ContextIndicator";
import { PromptAttachments } from "@/webview/components/PromptAttachments";
import type { ActiveEditor, EditingMessage, SessionMessage, SkillInfo, TokenTelemetry } from "@/webview/types";
import { FileCodeIcon, Hand, Reply, Square, SquareChartGantt } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/webview/components/ui/input-group";
import { Separator } from "@/webview/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { cn } from "@/webview/lib/utils";
import { Field, FieldDescription, FieldGroup } from "./ui/field";
import { Spinner } from "@/webview/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/webview/components/ui/dropdown-menu";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/webview/components/ui/item";
import { usePromptAttachments } from "@/webview/hooks/usePromptAttachments";

export interface InputPromptProps {
  loading: boolean;
  selectedSkills: SkillInfo[];
  availableSkills: SkillInfo[];
  pendingPermissionReply: unknown;
  tokenTelemetry?: TokenTelemetry;
  activeEditor: ActiveEditor | null;
  editingMessage: EditingMessage | null;
  messages?: SessionMessage[]; // Historical messages for history navigation
  onSendPrompt: (
    prompt: string,
    skills?: SkillInfo[],
    images?: string[],
    options?: {
      permissions?: unknown[];
      alwaysAllows?: string[];
      planMode?: boolean;
      askUserQuestionSummary?: boolean;
    }
  ) => void;
  onInterrupt: () => void;
  onSelectSkills: (skills: SkillInfo[]) => void;
  onClearEditingMessage: () => void;
}

export default function InputPrompt({
  loading,
  selectedSkills,
  availableSkills,
  pendingPermissionReply,
  tokenTelemetry,
  activeEditor,
  editingMessage,
  messages,
  onSendPrompt,
  onInterrupt,
  onSelectSkills,
  onClearEditingMessage,
}: InputPromptProps) {
  const [value, setValue] = useState<string>("");
  const [planMode, setPlanMode] = useState<"false" | "true">("false");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { attachments, handlePaste, removeAttachment, clearAttachments, getImageUrls, loadImages } =
    usePromptAttachments();

  // Rebuild history from messages when messages change (e.g., loading a session)
  useEffect(() => {
    if (messages && messages.length > 0) {
      const userMessages = messages
        .filter(
          (m) =>
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content.trim() &&
            !m?.meta?.userPrompt?.askUserQuestionSummary
        )
        .map((m) => m.content);
      setHistory(userMessages);
      setHistoryIdx(-1);
      setDraftBeforeHistory("");
    } else {
      // Clear history when no messages (new session)
      setHistory([]);
      setHistoryIdx(-1);
      setDraftBeforeHistory("");
    }
  }, [messages]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 18;
    const minHeight = lineHeight * 3 + 20;
    const maxHeight = lineHeight * 10 + 20;
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // Restore editing state when editingMessage changes
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.text);
      if (editingMessage.images && editingMessage.images.length > 0) {
        loadImages(editingMessage.images);
      }
      if (editingMessage.skills && editingMessage.skills.length > 0) {
        onSelectSkills(editingMessage.skills);
      }
    }
  }, [editingMessage, loadImages, onSelectSkills]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    const images = getImageUrls();
    if ((!trimmed && images.length === 0) || loading) return;

    const reply = pendingPermissionReply as { permissions?: unknown[]; alwaysAllows?: string[] } | null;
    setHistory((prev) => [...prev, trimmed]);
    setValue("");
    setHistoryIdx(-1);

    onSendPrompt(trimmed, selectedSkills, images, { ...reply, planMode: planMode === "true" });
    onSelectSkills([]);
    clearAttachments();
    onClearEditingMessage();
  }, [
    value,
    loading,
    pendingPermissionReply,
    selectedSkills,
    onSendPrompt,
    onSelectSkills,
    getImageUrls,
    clearAttachments,
    onClearEditingMessage,
    planMode,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // if (e.isComposing) return;

      const el = textareaRef.current;
      const isAtStart = el?.selectionStart === 0 && el?.selectionEnd === 0;
      const isAtEnd = el?.selectionStart === el?.value.length && el?.selectionEnd === el?.value.length;

      // Exit history browsing mode on any non-ArrowUp/ArrowDown key
      if (historyIdx !== -1 && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
        setHistoryIdx(-1);
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      } else if (e.key === "ArrowUp" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        // Navigate to previous history item when:
        // 1. Already in history browsing mode (historyIdx !== -1), OR
        // 2. Caret is at the start of the input AND there's history
        if ((historyIdx !== -1 || isAtStart) && history.length > 0) {
          e.preventDefault();
          let nextIdx = historyIdx;
          if (historyIdx === -1) {
            // Enter history browsing mode: save current draft
            setDraftBeforeHistory(value);
            nextIdx = history.length - 1;
          } else if (historyIdx > 0) {
            nextIdx = historyIdx - 1;
          }
          if (nextIdx !== historyIdx) {
            setHistoryIdx(nextIdx);
            setValue(history[nextIdx]);
          }
        }
      } else if (e.key === "ArrowDown" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        // Navigate to next history item when:
        // 1. Already in history browsing mode (historyIdx !== -1), OR
        // 2. Caret is at the end of the input AND there's history
        if ((historyIdx !== -1 || isAtEnd) && history.length > 0) {
          e.preventDefault();
          if (historyIdx !== -1) {
            if (historyIdx < history.length - 1) {
              // Navigate to next (older) item
              const nextIdx = historyIdx + 1;
              setHistoryIdx(nextIdx);
              setValue(history[nextIdx]);
            } else {
              // Reached the end of history: restore draft and exit browsing mode
              setHistoryIdx(-1);
              setValue(draftBeforeHistory);
            }
          }
        }
      }
    },
    [handleSend, history, historyIdx, value, draftBeforeHistory]
  );

  const hasContent = value.trim().length > 0 || attachments.length > 0;

  return (
    <FieldGroup className="w-full max-w-237.5 mx-auto min-w-sm px-4 pt-1.5 pb-1">
      <Field className="gap-0.5">
        <InputGroup>
          <div className="flex flex-col w-full">
            <InputGroupTextarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (historyIdx !== -1) {
                  setHistoryIdx(-1);
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              className="text-[12px] max-h-50"
              placeholder="Write a prompt... "
            />
          </div>
          <InputGroupAddon className="flex items-center justify-center" align="block-end">
            <SkillsPanel
              availableSkills={availableSkills}
              selectedSkills={selectedSkills}
              onToggle={(skill) => {
                const idx = selectedSkills.findIndex((s) => s.name === skill.name);
                if (idx >= 0) {
                  onSelectSkills(selectedSkills.filter((s) => s.name !== skill.name));
                } else {
                  onSelectSkills([...selectedSkills, skill]);
                }
              }}
            />
            <Separator orientation="vertical" className="h-5 mt-1.5" />
            <ContextIndicator tokenTelemetry={tokenTelemetry} />
            <Separator orientation="vertical" className="h-5 mt-1.5" />
            {activeEditor && (
              <HoverCard openDelay={300} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <InputGroupButton
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                    title={activeEditor.fileName}
                  >
                    <FileCodeIcon className="h-3 w-3" />
                    <span className="max-w-20 truncate">{activeEditor.fileName.split("/").pop()}</span>
                  </InputGroupButton>
                </HoverCardTrigger>
                <HoverCardContent className="text-xs space-y-1">
                  <div className="font-medium truncate">{activeEditor.fileName.split("/").pop()}</div>
                  <p className="text-muted-foreground text-wrap break-all line-clamp-3">{activeEditor.fileName}</p>
                  <div className="flex gap-3 text-muted-foreground">
                    <span>{activeEditor.languageId}</span>
                    <span>{activeEditor.lineCount} lines</span>
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
            <div className="ml-auto flex gap-2 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <InputGroupButton variant="ghost" className="h-8">
                    {planMode === "true" ? (
                      <div className="flex items-center gap-0.5">
                        <SquareChartGantt className="size-3.5" strokeWidth={1.5} />
                        <span className="text-xs font-normal">Plan</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5">
                        <Hand className="size-3.5" strokeWidth={1.5} />
                        <span className="text-xs font-normal">Default</span>
                      </div>
                    )}
                  </InputGroupButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80" side="top" align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Modes</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={planMode}
                      onValueChange={(value) => setPlanMode(value as "true" | "false")}
                    >
                      <DropdownMenuRadioItem value="false">
                        <Item size="xs">
                          <ItemMedia variant="icon">
                            <Hand className="size-4.5 mt-2.5" strokeWidth={1.5} />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle className="text-xs">Default</ItemTitle>
                            <ItemDescription className="text-[10px]">
                              Deep Code will make edits and run commands to complete your task
                            </ItemDescription>
                          </ItemContent>
                        </Item>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="true">
                        <Item size="xs">
                          <ItemMedia variant="icon">
                            <SquareChartGantt className="size-4.5 mt-2.5" strokeWidth={1.5} />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle className="text-xs">Plan</ItemTitle>
                            <ItemDescription className="text-[8px]">
                              Deep code will explore the code and present a plan before editing
                            </ItemDescription>
                          </ItemContent>
                        </Item>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {loading ? (
                <InputGroupButton
                  variant="secondary"
                  size="icon-sm"
                  className="group"
                  onClick={onInterrupt}
                  title="Stop"
                >
                  <Square className="h-3 w-3 hidden fill-primary group-hover:block" strokeWidth={0} />
                  <Spinner className="h-4 w-4 block group-hover:hidden text-primary" />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  variant="default"
                  className={cn("cursor-pointer", {
                    "cursor-not-allowed!": !hasContent && !loading,
                  })}
                  onClick={handleSend}
                  disabled={!hasContent && !loading}
                  title="Send"
                  size="icon-sm"
                >
                  <Reply className="rotate-x-180" />
                </InputGroupButton>
              )}
            </div>
          </InputGroupAddon>
          <SkillsTags
            selectedSkills={selectedSkills}
            onRemove={(name) => onSelectSkills(selectedSkills.filter((s) => s.name !== name))}
          />
          <PromptAttachments attachments={attachments} onRemove={removeAttachment} />
        </InputGroup>
        <FieldDescription className="text-center text-[12px]">
          AI-generated content, for reference only
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
