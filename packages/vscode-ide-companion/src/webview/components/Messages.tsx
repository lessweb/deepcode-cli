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

interface MessagesProps {
  messages: SessionMessage[];
  loading: boolean;
  onEditMessage?: (editing: EditingMessage) => void;
  onAskUserQuestions?: (questions: AskUserQuestionMetadata["questions"]) => void;
}

const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  ({ messages, loading, onEditMessage, onAskUserQuestions }, ref) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    const handleToBottom = () => {
      console.log("handleToBottom");
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(() => {
      handleToBottom();
    }, [messages, loading]);

    // useImperativeHandle(ref, ()=> {
    //   return bottomRef.current ? bottomRef.current : undefined;
    // })

    return (
      <ScrollArea
        ref={ref}
        onScroll={(e) => {
          console.log("eeeee", e);
        }}
        className="flex-1 w-full max-w-237.5 mx-auto min-w-sm min-h-0 overflow-hidden"
      >
        <div className="flex flex-col gap-0 px-4 py-4">
          {messages.map((msg, index) => {
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const shouldConnect = prevMsg ? prevMsg.role !== "user" && msg.role !== "user" : false;

            switch (msg.role) {
              case "user": {
                if (msg.meta?.userPrompt?.askUserQuestionSummary) {
                  return <AskQuestionSummary key={`msg-${index}`} content={msg.content} meta={msg.meta} />;
                }
                return (
                  <UserBubble
                    key={`msg-${index}`}
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
                  />
                );
              }
              case "assistant": {
                const meta = msg.meta as { asThinking?: boolean } | undefined;
                if (meta?.asThinking) {
                  return (
                    <ThinkingBubble key={`msg-${index}`} content={msg.content || ""} shouldConnect={shouldConnect} />
                  );
                }
                return <AssistantBubble key={`msg-${index}`} message={msg} />;
              }
              case "tool":
                return (
                  <ToolBubble
                    key={`msg-${index}`}
                    content={msg.content || ""}
                    meta={msg.meta as ToolBubbleProps["meta"]}
                    shouldConnect={shouldConnect}
                    isLastMessage={index === messages.length - 1}
                    onAskUserQuestions={onAskUserQuestions}
                    onScrollToBottom={handleToBottom}
                  />
                );
              case "system":
                return (
                  <SystemBubble
                    key={`msg-${index}`}
                    content={msg.content || ""}
                    meta={msg.meta}
                    shouldConnect={shouldConnect}
                  />
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
