import { useCallback, useMemo } from "react";
import type { SessionSummary } from "@/webview/types";
import icon from "../../../assets/deepcoding_icon.png";
import SessionList from "@/webview/components/SessionList";
import { Search } from "lucide-react";
import { Button } from "@/webview/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";

interface HeaderProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateNewSession: () => void;
  onRenameSession: (sessionId: string, summary: string) => void;
  onDeleteSession: (sessionId: string) => void;
  sessionListOpen: boolean;
  onToggleSessionList: (open?: boolean) => void;
  hasMessages: boolean;
  onToggleSearchPanel: (open?: boolean) => void;
}

export default function Header({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateNewSession,
  onRenameSession,
  onDeleteSession,
  sessionListOpen,
  onToggleSessionList,
  hasMessages,
  onToggleSearchPanel,
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
    <div className="flex items-center justify-between bg-card gap-0 px-4 py-1 shrink-0  border-b">
      <div className="flex items-center gap-1 px-2 py-1">
        <img src={icon} alt="" className="w-4 h-4 shrink-0" />
        <span className="min-w-0 font-semibold truncate">
          {activeSessionSummary || (activeSessionId ? "Deep Code" : "New Conversation")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {activeSessionId && hasMessages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 cursor-pointer"
                onClick={() => onToggleSearchPanel(true)}
              >
                <Search className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Search Messages</p>
            </TooltipContent>
          </Tooltip>
        )}
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelect}
          onCreateNewSession={onCreateNewSession}
          onRename={onRenameSession}
          onDelete={onDeleteSession}
          open={sessionListOpen}
          onOpenChange={(open) => onToggleSessionList(open)}
        />
      </div>
    </div>
  );
}
