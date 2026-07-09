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

interface HeaderProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateNewSession: () => void;
}

export default function Header({ sessions, activeSessionId, onSelectSession, onCreateNewSession }: HeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleSelect = useCallback(
    (sessionId: string) => {
      setDrawerOpen(false);
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
        <Drawer direction="right" open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 cursor-pointer" title="Show Agent Sessions Sidebar">
              <PanelRight className="h-4 w-4" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Sessions</DrawerTitle>
              <DrawerDescription>Manage your agent sessions.</DrawerDescription>
            </DrawerHeader>
            <div className="no-scrollbar overflow-y-auto">
              <SessionDropdown
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={handleSelect}
                onClose={handleCloseDrawer}
              />
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button onClick={onCreateNewSession} variant="outline" className="cursor-pointer">
                  New Session
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    </div>
  );
}
