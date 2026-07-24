import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SkillsPanel from "@/webview/components/SkillsPanel";
import SkillsTags from "@/webview/components/SkillsTags";
import ContextIndicator from "@/webview/components/ContextIndicator";
import { PromptAttachments } from "@/webview/components/PromptAttachments";
import type {
  ActiveEditor,
  CommandsItem,
  EditingMessage,
  SessionMessage,
  SkillInfo,
  TokenTelemetry,
} from "@/webview/types";
import { BookmarkIcon, EyeOff, FileCodeIcon, Hand, Reply, Square, SquareChartGantt } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/webview/components/ui/input-group";
import { Separator } from "@/webview/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { cn } from "@/webview/lib/utils";
import { Field, FieldGroup } from "./ui/field";
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
import { toTitleCase } from "@/webview/utils";
import { toast } from "@/webview/components/ui/sonner";
import { Popover } from "./ui/popover";
import { useSize } from "@/webview/hooks/useSize";
import { Toggle } from "@/webview/components/ui/toggle";

export interface InputPromptProps {
  loading: boolean;
  selectedSkills: SkillInfo[];
  availableSkills: SkillInfo[];
  commands?: Array<CommandsItem>;
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
  commands,
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
  const fieldGroupRef = useRef<HTMLDivElement>(null);
  const size = useSize(fieldGroupRef);
  const [open, setOpen] = React.useState<boolean>(false);
  const [value, setValue] = useState<string>("");
  const [planMode, setPlanMode] = useState<"false" | "true">("false");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { attachments, handlePaste, removeAttachment, clearAttachments, getImageUrls, loadImages } =
    usePromptAttachments({
      onMaxExceeded: () => {
        toast.warning("You can paste up to 10 images at a time", { position: "bottom-right" });
      },
    });

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

      // Escape closes the skills popover in command mode
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        // Don't send when in command mode (popover is open and value starts with "/")
        if (value.startsWith("/") && open) {
          e.preventDefault();
          return;
        }
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
    [handleSend, history, historyIdx, value, draftBeforeHistory, open]
  );

  /**
   * Get the active skill badge to display when skills are loading
   */
  const getActiveSkill = useCallback(() => {
    if (loading && availableSkills.length > 0 && availableSkills.filter((x) => x.isLoaded).length > 0) {
      return (
        <div className="flex flex-wrap gap-1 mb-0.5 py-1">
          {availableSkills
            .filter((x) => x.isLoaded)
            .map((skill) => (
              <div
                key={skill.name}
                className="relative flex items-center gap-1.5 border border-primary rounded-md px-2 py-0.5"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex size-2 rounded-full bg-primary"></span>
                </span>
                <span className="text-xs text-primary/85">{toTitleCase(skill.name)}</span>
              </div>
            ))}
        </div>
      );
    }
    return null;
  }, [loading, availableSkills]);

  /**
   * Determine if the input has content (text or attachments)
   */
  const hasContent = useMemo(() => value.trim().length > 0 || attachments.length > 0, [value, attachments]);

  /**
   * Check if the textarea value matches the command-mode trigger pattern:
   * slash with optional leading whitespace, followed by non-space chars or end-of-string.
   * Opens: "/", " /", "   /", "/code", "/anything"
   * Closes: "/ " (slash+space)
   */
  const isCommandMode = useMemo(() => /^\s*\//.test(value) && !/^\s*\/\s/.test(value), [value]);

  /**
   * Extract search query from textarea value when in command mode.
   */
  const searchQuery = useMemo(() => {
    if (/^\s*\//.test(value)) {
      return value.trim().slice(1);
    }
    return "";
  }, [value]);

  /**
   * Keep focus on textarea when popover opens in command mode.
   * modal={false} means refocus won't trigger Radix dismiss.
   */
  useEffect(() => {
    if (open && isCommandMode) {
      const raf = requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open, isCommandMode]);

  /**
   * Guard against blur/focus-related closes while in command mode.
   * Genuine outside clicks are handled by the document-level pointerdown listener below.
   */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isCommandMode) {
        return;
      }
      setOpen(nextOpen);
    },
    [isCommandMode]
  );

  /**
   * When SkillsPanel is open via command mode (/), close it on pointerdown
   * outside the input area AND outside the popover content.
   */
  useEffect(() => {
    if (!open || !isCommandMode) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the input area
      if (fieldGroupRef.current?.contains(target)) return;
      // Don't close if clicking inside the popover content (rendered in Portal)
      if (target.closest('[data-slot="popover-content"]')) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, isCommandMode]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <FieldGroup ref={fieldGroupRef} className="w-full max-w-237.5 mx-auto min-w-sm px-4 pt-1.5 pb-4">
        <Field className="gap-0.5">
          {getActiveSkill()}
          <InputGroup>
            <div className="flex flex-col w-full">
              <InputGroupTextarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (/^\s*\//.test(e.target.value) && !/^\s*\/\s/.test(e.target.value)) {
                    setOpen(true);
                  } else {
                    setOpen(false);
                  }
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
                searchQuery={searchQuery}
                size={size}
                commands={commands}
                availableSkills={availableSkills}
                selectedSkills={selectedSkills}
                onToggle={(skill) => {
                  const idx = selectedSkills.findIndex((s) => s.name === skill.name);
                  if (idx >= 0) {
                    onSelectSkills(selectedSkills.filter((s) => s.name !== skill.name));
                  } else {
                    onSelectSkills([...selectedSkills, skill]);
                    // If in command mode, clear the "/" text and close popover
                    if (isCommandMode) {
                      setValue("");
                      setOpen(false);
                    }
                  }
                }}
                onCancel={() => setOpen(false)}
                onCommandInput={(command) => {
                  setValue(`${command} `);
                  textareaRef?.current?.focus();
                }}
              />
              <Separator orientation="vertical" className="h-4 mt-2" />
              <ContextIndicator tokenTelemetry={tokenTelemetry} />
              {activeEditor && <Separator orientation="vertical" className="h-4 mt-2" />}
              {activeEditor && (
                <Toggle
                  aria-label={activeEditor.fileName}
                  size="sm"
                  variant="outline"
                  className="h-6 outline-0 border-none shadow-none rounded flex items-center justify-center"
                >
                  <FileCodeIcon className="size-3 group-data-[state=off]/toggle:hidden" />
                  <EyeOff className="size-3 group-data-[state=on]/toggle:hidden" />
                  <span className="max-w-20 text-xs truncate">{activeEditor.fileName.split("/").pop()}</span>
                </Toggle>
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
                              <ItemTitle className="text-xs">Default Mode</ItemTitle>
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
                              <ItemTitle className="text-xs">Plan Mode</ItemTitle>
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
                    variant="outline"
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
        </Field>
      </FieldGroup>
    </Popover>
  );
}
