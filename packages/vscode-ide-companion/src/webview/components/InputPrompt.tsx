import React, { useCallback, useEffect, useRef, useState } from "react";
import SkillsPanel from "@/webview/components/SkillsPanel";
import SkillsTags from "@/webview/components/SkillsTags";
import ContextMeter from "@/webview/components/ContextMeter";
import { PromptAttachments, usePromptAttachments } from "@/webview/components/PromptAttachments";
import type { ActiveEditor, EditingMessage, SkillInfo, TokenTelemetry } from "@/webview/types";
import { FileCodeIcon, Send, Square } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/webview/components/ui/input-group";
import { Separator } from "@/webview/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { cn } from "@/webview/lib/utils";
import { Field, FieldGroup } from "./ui/field";

export interface InputPromptProps {
  loading: boolean;
  selectedSkills: SkillInfo[];
  availableSkills: SkillInfo[];
  pendingPermissionReply: unknown;
  askPermissions: unknown[];
  activeSessionStatus: string | null;
  tokenTelemetry?: TokenTelemetry;
  activeEditor: ActiveEditor | null;
  editingMessage: EditingMessage | null;
  onSendPrompt: (
    prompt: string,
    skills?: SkillInfo[],
    images?: string[],
    options?: { permissions?: unknown[]; alwaysAllows?: string[] }
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
  askPermissions,
  activeSessionStatus,
  tokenTelemetry,
  activeEditor,
  editingMessage,
  onSendPrompt,
  onInterrupt,
  onSelectSkills,
  onClearEditingMessage,
}: InputPromptProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { attachments, handlePaste, removeAttachment, clearAttachments, getImageUrls, loadImages } =
    usePromptAttachments();
  console.log("askPermissions:", askPermissions);
  console.log("activeSessionStatus:", activeSessionStatus);

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

    onSendPrompt(trimmed, selectedSkills, images, reply || undefined);
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
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // if (e.isComposing) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      } else if (e.key === "ArrowUp" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const el = textareaRef.current;
        if (!el) return;
        if (el.selectionStart === 0 && el.selectionEnd === 0 && history.length > 0) {
          e.preventDefault();
          if (historyIdx === -1) {
            setDraftBeforeHistory(value);
            setHistoryIdx(history.length - 1);
            setValue(history[history.length - 1]);
          } else if (historyIdx > 0) {
            setHistoryIdx(historyIdx - 1);
            setValue(history[historyIdx - 1]);
          }
        }
      } else if (e.key === "ArrowDown" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const el = textareaRef.current;
        if (!el) return;
        if (historyIdx !== -1 && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
          e.preventDefault();
          if (historyIdx < history.length - 1) {
            setHistoryIdx(historyIdx + 1);
            setValue(history[historyIdx + 1]);
          } else {
            setHistoryIdx(-1);
            setValue(draftBeforeHistory);
          }
        }
      }
    },
    [handleSend, history, historyIdx, value, draftBeforeHistory]
  );

  const isProcessing = loading;
  const hasContent = value.trim().length > 0 || attachments.length > 0;

  return (
    <FieldGroup className="w-full max-w-237.5 mx-auto min-w-sm p-4">
      <Field>
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
            <ContextMeter tokenTelemetry={tokenTelemetry} />
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
                  <div className="text-muted-foreground">{activeEditor.fileName}</div>
                  <div className="flex gap-3 text-muted-foreground">
                    <span>{activeEditor.languageId}</span>
                    <span>{activeEditor.lineCount} lines</span>
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
            {isProcessing ? (
              <InputGroupButton
                variant="ghost"
                size="icon-sm"
                className="ml-auto h-7 w-7"
                onClick={onInterrupt}
                title="Stop"
              >
                <Square className="h-4 w-4" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                className={cn("h-7 w-7 ml-auto cursor-pointer", {
                  "cursor-not-allowed!": !hasContent && !isProcessing,
                })}
                onClick={handleSend}
                disabled={!hasContent && !isProcessing}
                title="Send"
                size="icon-sm"
              >
                <Send />
              </InputGroupButton>
            )}
          </InputGroupAddon>
          <SkillsTags
            selectedSkills={selectedSkills}
            onRemove={(name) => onSelectSkills(selectedSkills.filter((s) => s.name !== name))}
          />
          <PromptAttachments attachments={attachments} onRemove={removeAttachment} />
        </InputGroup>
      </Field>
    </FieldGroup>
  );
}
