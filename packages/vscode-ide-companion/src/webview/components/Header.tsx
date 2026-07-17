import { useCallback, useMemo } from "react";
import { Button } from "@/webview/components/ui/button";
import type { SessionSummary } from "@/webview/types";
import { Plus, Settings } from "lucide-react";
import { chatService } from "@/webview/services/chatService";
import icon from "../../../assets/deepcoding_icon.png";
import SessionList from "@/webview/components/SessionList";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";

interface HeaderProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateNewSession: () => void;
  onRenameSession: (sessionId: string, summary: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export default function Header({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateNewSession,
  onRenameSession,
  onDeleteSession,
}: HeaderProps) {
  const handleSelect = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId);
    },
    [onSelectSession]
  );
  const activeSessionSummary = useMemo(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session) {
      return session.summary;
    }
    return undefined;
  }, [sessions, activeSessionId]);

  return (
    <div className="flex items-center justify-between gap-0 px-4 py-1 shrink-0  border-b">
      <Button variant="ghost">
        <img src={icon} alt="" className="w-4 h-4 shrink-0" />
        <span className="min-w-0 truncate">
          {activeSessionSummary || (activeSessionId ? "Deep Code" : "New Conversation")}
        </span>
      </Button>

      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 cursor-pointer"
              onClick={onCreateNewSession}
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>New Chat</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 cursor-pointer"
              onClick={() => chatService.openSettings()}
              title="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Settings</p>
          </TooltipContent>
        </Tooltip>
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelect}
          onCreateNewSession={onCreateNewSession}
          onRename={onRenameSession}
          onDelete={onDeleteSession}
        />
      </div>
    </div>
  );
}
