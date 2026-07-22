import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { ScrollArea, ScrollBar } from "@/webview/components/ui/scroll-area";
import UserBubble from "@/webview/components/bubbles/UserBubble";
import AssistantBubble from "@/webview/components/bubbles/AssistantBubble";
import ThinkingBubble from "@/webview/components/bubbles/ThinkingBubble";
import ToolBubble, {
  type ToolBubbleProps,
  type AskUserQuestionMetadata,
} from "@/webview/components/bubbles/ToolBubble";
import SystemBubble from "@/webview/components/bubbles/SystemBubble";
import type { EditingMessage, SessionMessage } from "@/webview/types";
import AskQuestionSummary from "@/webview/components/AskQuestionSummary";
import icon from "../../../assets/deepcoding_icon.png";

interface MessagesProps {
  messages: SessionMessage[];
  loading: boolean;
  onEditMessage?: (editing: EditingMessage) => void;
  onAskUserQuestions?: (questions: AskUserQuestionMetadata["questions"]) => void;
}

export interface MessagesHandle {
  scrollToMessage: (messageId: string) => void;
}

const Messages = forwardRef<MessagesHandle, MessagesProps>(
  ({ messages, loading, onEditMessage, onAskUserQuestions }, ref) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const suppressScrollRef = useRef(false);
    const highlightedElRef = useRef<Element | null>(null);

    const handleToBottom = () => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
      if (!suppressScrollRef.current) {
        handleToBottom();
      }
    }, [messages, loading]);

    useImperativeHandle(ref, () => ({
      scrollToMessage: (messageId: string) => {
        suppressScrollRef.current = true;

        // Remove highlight from previously highlighted element
        if (highlightedElRef.current) {
          highlightedElRef.current.classList.remove("msg-highlight-breathe");
        }

        const el = document.querySelector(`[data-message-id="${messageId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          // Apply breathing light effect
          el.classList.add("msg-highlight-breathe");
          highlightedElRef.current = el;
          // Remove the class after animation completes (3 iterations * 0.8s)
          setTimeout(() => {
            el.classList.remove("msg-highlight-breathe");
            if (highlightedElRef.current === el) {
              highlightedElRef.current = null;
            }
          }, 2600);
        }

        // Re-enable auto-scroll after a delay
        setTimeout(() => {
          suppressScrollRef.current = false;
        }, 1500);
      },
    }));

    if (messages.length === 0) {
      return (
        <div className="flex-1 flex flex-col justify-center items-center w-full">
          <img src={icon} alt="" className="size-32 shrink-0 mb-6" />
          <div className="mb-3 text-[16px] font-semibold">Welcome to the Deep Code AI IDE!</div>
          <p className="text-xs text-muted-foreground">
            What would you like to do? Ask about this codebase or we can start writing code.
          </p>
        </div>
      );
    }
    return (
      <ScrollArea
        ref={scrollAreaRef}
        onScroll={(e) => {
          console.log("eeeee", e);
        }}
        className="flex-1 w-full max-w-237.5 mx-auto min-w-sm min-h-0 overflow-hidden"
      >
        <div className="flex flex-col gap-0 px-4 py-4">
          {messages.map((msg, index) => {
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const shouldConnect = prevMsg ? prevMsg.role !== "user" && msg.role !== "user" : false;
            const msgId = msg.id || `msg-${index}`;

            const wrapWithId = (element: React.ReactNode, key: string) => (
              <div key={key} data-message-id={msgId}>
                {element}
              </div>
            );

            switch (msg.role) {
              case "user": {
                if (msg.meta?.userPrompt?.askUserQuestionSummary) {
                  return wrapWithId(<AskQuestionSummary content={msg.content} meta={msg.meta} />, `msg-${index}`);
                }
                return wrapWithId(
                  <UserBubble
                    content={msg.content}
                    meta={msg.meta}
                    onEdit={
                      onEditMessage
                        ? () => {
                            const meta = msg.meta as { userPrompt?: { imageUrls?: string[] } } | undefined;
                            onEditMessage({
                              text: msg.content,
                              images: meta?.userPrompt?.imageUrls ?? [],
                              skills: [],
                            });
                          }
                        : undefined
                    }
                  />,
                  `msg-${index}`
                );
              }
              case "assistant": {
                const meta = msg.meta as { asThinking?: boolean } | undefined;
                if (meta?.asThinking) {
                  return wrapWithId(
                    <ThinkingBubble content={msg.content || ""} shouldConnect={shouldConnect} />,
                    `msg-${index}`
                  );
                }
                return wrapWithId(<AssistantBubble message={msg} />, `msg-${index}`);
              }
              case "tool":
                return wrapWithId(
                  <ToolBubble
                    content={msg.content || ""}
                    meta={msg.meta as ToolBubbleProps["meta"]}
                    shouldConnect={shouldConnect}
                    isLastMessage={index === messages.length - 1}
                    onAskUserQuestions={onAskUserQuestions}
                    onScrollToBottom={handleToBottom}
                  />,
                  `msg-${index}`
                );
              case "system":
                return wrapWithId(
                  <SystemBubble content={msg.content || ""} meta={msg.meta} shouldConnect={shouldConnect} />,
                  `msg-${index}`
                );
              default:
                return null;
            }
          })}
          <div ref={bottomRef} />
        </div>
        <ScrollBar />
      </ScrollArea>
    );
  }
);

export default Messages;
