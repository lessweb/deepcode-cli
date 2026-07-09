import { useState, useMemo } from "react";
import { Input } from "@/webview/components/ui/input";
import { ScrollArea, ScrollBar } from "@/webview/components/ui/scroll-area";
import type { SessionSummary } from "@/webview/types";
import { MessageCircle, Search } from "lucide-react";
import { Empty, EmptyDescription, EmptyMedia, EmptyHeader, EmptyTitle } from "@/webview/components/ui/empty";
import { cn } from "@/webview/lib/utils";
import { Item, ItemActions, ItemContent, ItemGroup } from "./ui/item";

interface SessionDropdownProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - sessionDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function SessionList({ sessions, activeSessionId, onSelect, onClose }: SessionDropdownProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return sessions
      .filter((s) => (s.summary || "Untitled").toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updateTime).getTime() - new Date(a.updateTime).getTime());
  }, [sessions, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, SessionSummary[]> = { Today: [], Yesterday: [], "Past Week": [], Older: [] };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    for (const s of filtered) {
      const sessionDay = new Date(
        new Date(s.updateTime).getFullYear(),
        new Date(s.updateTime).getMonth(),
        new Date(s.updateTime).getDate()
      );
      if (sessionDay.getTime() === today.getTime()) {
        groups["Today"].push(s);
      } else if (sessionDay.getTime() === yesterday.getTime()) {
        groups["Yesterday"].push(s);
      } else if (sessionDay.getTime() > lastWeek.getTime()) {
        groups["Past Week"].push(s);
      } else {
        groups["Older"].push(s);
      }
    }
    return groups;
  }, [filtered]);

  const totalCount =
    grouped["Today"].length + grouped["Yesterday"].length + grouped["Past Week"].length + grouped["Older"].length;

  return (
    <div className="flex flex-col h-full w-full">
      <div className="p-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 pt-0">
          {totalCount === 0 ? (
            <Empty className="h-full bg-muted/30">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircle />
                </EmptyMedia>
                <EmptyTitle>{query ? "No sessions found" : "No sessions yet"}</EmptyTitle>
                <EmptyDescription className="max-w-xs text-pretty">
                  You&apos;re all caught up. New notifications will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            Object.entries(grouped).map(([group, items]) =>
              items.length > 0 ? (
                <ItemGroup key={group} className="mb-3 last:mb-0">
                  <div className="text-xs uppercase font-medium tracking-wide px-1.5 py-1 text-muted-foreground">
                    {group}
                  </div>
                  {items.map((s) => (
                    <Item
                      key={s.id}
                      size="xs"
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-3 transition-colors cursor-pointer border-none",
                        s.id === activeSessionId
                          ? "bg-primary text-primary-foreground font-medium"
                          : "text-foreground hover:bg-accent"
                      )}
                      onClick={() => {
                        onSelect(s.id);
                        onClose();
                      }}
                    >
                      <ItemContent className="flex-1 truncate">{s.summary || "Untitled"}</ItemContent>
                      <ItemActions className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(s.updateTime)}
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              ) : null
            )
          )}
        </div>
        <ScrollBar />
      </ScrollArea>
    </div>
  );
}
