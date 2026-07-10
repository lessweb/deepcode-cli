import { useState, useCallback, useMemo } from "react";
import { Button } from "@/webview/components/ui/button";
import SessionDropdown from "@/webview/components/SessionList";
import type { SessionSummary } from "@/webview/types";
import { PanelRight, Plus, Settings } from "lucide-react";
import { chatService } from "@/webview/services/chatService";
import icon from "../../../assets/deepcoding_icon.png";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/webview/components/ui/drawer";
import SessionList from "@/webview/components/SessionList";

interface HeaderProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateNewSession: () => void;
}

export default function Header({ sessions, activeSessionId, onSelectSession, onCreateNewSession }: HeaderProps) {
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
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 cursor-pointer"
          onClick={onCreateNewSession}
          title="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 cursor-pointer"
          onClick={() => chatService.openSettings()}
          title="Open settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelect}
          onCreateNewSession={onCreateNewSession}
        />
      </div>
    </div>
  );
}
