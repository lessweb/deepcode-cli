import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { SessionSummary } from "@/webview/types";
import {
  MessageCircle,
  PanelRight,
  Search,
  Pencil,
  Trash2,
  FileText,
  Columns2,
  ExternalLink,
  FileCodeCorner,
} from "lucide-react";
import { Empty, EmptyDescription, EmptyMedia, EmptyHeader, EmptyTitle } from "@/webview/components/ui/empty";
import { cn } from "@/webview/lib/utils";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "./ui/item";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/webview/components/ui/drawer";
import { Button } from "@/webview/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/webview/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
} from "@/webview/components/ui/context-menu";
import { chatService } from "@/webview/services/chatService";
import { Input } from "@/webview/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/webview/components/ui/alert-dialog";
import { toast } from "@/webview/components/ui/sonner";
import { Field, FieldDescription, FieldSet } from "@/webview/components/ui/field";

interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreateNewSession: () => void;
  onRename: (sessionId: string, summary: string) => void;
  onDelete: (sessionId: string) => void;
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

export default function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onCreateNewSession,
  onRename,
  onDelete,
}: SessionListProps) {
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextMenuOpenId, setContextMenuOpenId] = useState<string>();
  const [alertOpenId, setAlertOpenId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const blurConfirmedRef = useRef(false);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // Focus the edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      blurConfirmedRef.current = false;
      requestAnimationFrame(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      });
      setTimeout(() => {
        blurConfirmedRef.current = true;
      }, 150);
    }
  }, [editingId]);

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

  const handleStartRename = useCallback(
    (sessionId: string) => {
      setEditingId(sessionId);
      const s = sessions.find((x) => x.id === sessionId);
      setEditValue(s?.summary || "");
    },
    [sessions]
  );

  const handleConfirmRename = useCallback(
    (sessionId: string) => {
      const trimmed = editValue.trim();
      if (trimmed) {
        onRename(sessionId, trimmed);
      }
      setEditingId(null);
      setEditValue("");
    },
    [editValue, onRename]
  );

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, sessionId: string) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmRename(sessionId);
      } else if (e.key === "Escape") {
        // Esc is handled by Drawer onOpenChange interceptor
      }
    },
    [handleConfirmRename]
  );

  const handleConfirmDelete = useCallback(
    (sessionId: string) => {
      onDelete(sessionId);
    },
    [onDelete]
  );

  const handleContextMenuOpen = useCallback(
    async (sessionId: string, mode: "open" | "beside" | "newWindow") => {
      try {
        if (sessionId === activeSessionId) {
          onCreateNewSession(); // 这里执行是为了清空现有的聊天界面
        }
        switch (mode) {
          case "open":
            // onSelect(sessionId);
            handleCloseDrawer();
            // vscodeApi.ViewColumn.Active
            await chatService.openChatPanel(sessionId, -1); // ViewColumn.Active
            break;
          case "beside":
            // vscodeApi.ViewColumn.Beside
            await chatService.openChatPanel(sessionId, -2); // ViewColumn.Beside
            break;
          case "newWindow":
            await chatService.openChatInNewWindow(sessionId);
            break;
        }
      } catch (err) {
        console.error("Failed to open chat panel:", err);
      }
    },
    [onSelect, onCreateNewSession, handleCloseDrawer]
  );

  const handleInspectJsonl = useCallback(async (sessionId: string) => {
    try {
      const { filePath } = await chatService.getSessionFilePath(sessionId);
      if (filePath) {
        await chatService.openFile(filePath);
      }
    } catch (err) {
      console.error("Failed to open JSONL:", err);
    }
  }, []);

  // Keyboard shortcuts for context menu
  useEffect(() => {
    if (!contextMenuOpenId) return;
    const session = sessions.find((s) => s.id === contextMenuOpenId);
    if (!session) return;

    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      let handled = false;

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (ctrl && alt) {
          // ⌃⌥⏎ → Open in new Window
          handleContextMenuOpen(contextMenuOpenId || "", "newWindow");
          handled = true;
        } else if (ctrl) {
          // ⌃⏎ → Open as Editor
          handleContextMenuOpen(contextMenuOpenId || "", "open");
          handled = true;
        } else {
          // ⏎ → Rename
          handled = true;
          handleStartRename(contextMenuOpenId);
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        // ⌫ → Delete
        e.preventDefault();
        e.stopImmediatePropagation();
        setAlertOpenId(contextMenuOpenId || "");
        handled = true;
      }

      if (handled) {
        setContextMenuOpenId(undefined);
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [contextMenuOpenId, sessions, handleContextMenuOpen]);

  return (
    <Drawer
      direction="right"
      open={drawerOpen}
      onOpenChange={(open) => {
        if (editingId && !open) {
          setEditingId(null);
          setEditValue("");
          return;
        }
        setDrawerOpen(open);
      }}
    >
      <DrawerTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 cursor-pointer"
              title="Show Agent Sessions Sidebar"
              onClick={() => setDrawerOpen(true)}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Sessions</p>
          </TooltipContent>
        </Tooltip>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Sessions</DrawerTitle>
          <InputGroup className="w-full mt-4">
            <InputGroupInput
              placeholder="Search sessions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              {Object.entries(grouped).reduceRight((acc, [_, items]) => acc + items.length, 0)} results
            </InputGroupAddon>
          </InputGroup>
        </DrawerHeader>
        <div className="no-scrollbar overflow-y-auto">
          <div className="py-2 px-4 pt-0">
            {totalCount === 0 ? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia>
                    <MessageCircle />
                  </EmptyMedia>
                  <EmptyTitle>{query ? "No sessions found" : "No sessions yet"}</EmptyTitle>
                  <EmptyDescription className="max-w-xs text-pretty">Start a new chat to get started.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              Object.entries(grouped).map(([group, items]) =>
                items.length > 0 ? (
                  <ItemGroup key={group} className="mb-3 last:mb-0">
                    <div className="sticky top-0 bg-popover z-10 text-xs uppercase flex justify-between tracking-wide px-1.5 py-1 text-muted-foreground">
                      <span className="font-bold">{group}</span>
                      <span>（{items.length || "0"}）</span>
                    </div>
                    {items.map((s) => (
                      <React.Fragment key={s.id}>
                        {editingId === s.id ? (
                          <FieldSet>
                            <Field className="gap-0.5 h-16">
                              <Input
                                id="session-name"
                                autoComplete="off"
                                ref={editInputRef}
                                autoFocus
                                placeholder="Enter new session title"
                                className="flex-1 h-10 bg-transparent border-b shadow-none outline-0 border-primary outline-none text-xs px-1 py-0"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => handleRenameKeyDown(e, s.id)}
                                onBlur={() => {
                                  if (blurConfirmedRef.current) handleConfirmRename(s.id);
                                }}
                              />
                              <FieldDescription className="text-xs">
                                New agent session title (Press 'Enter' to confirm or 'Escape' to cancel)
                              </FieldDescription>
                            </Field>
                          </FieldSet>
                        ) : (
                          <AlertDialog
                            open={alertOpenId === s.id}
                            onOpenChange={(open) => setAlertOpenId(open ? s.id : null)}
                          >
                            <ContextMenu
                              open={contextMenuOpenId === s.id}
                              onOpenChange={(open) => {
                                setContextMenuOpenId(open ? s.id : undefined);
                              }}
                            >
                              <ContextMenuTrigger asChild>
                                <Item
                                  size="xs"
                                  className={cn(
                                    "w-full text-left px-2 py-1.5 rounded-md text-sm flex border items-center gap-3 transition-colors cursor-pointer border-transparent group relative",
                                    s.id === activeSessionId
                                      ? "bg-accent border-primary border font-medium"
                                      : "text-foreground hover:bg-accent"
                                  )}
                                  onClick={() => {
                                    if (editingId !== s.id) {
                                      onSelect(s.id);
                                      handleCloseDrawer();
                                    }
                                  }}
                                >
                                  <ItemContent className="flex-1">
                                    <ItemTitle className="text-[13px] truncate">{s.summary || "Untitled"}</ItemTitle>
                                    <ItemDescription className="text-xs">
                                      <span>{formatTime(s.updateTime)}</span>
                                    </ItemDescription>
                                  </ItemContent>
                                  <ItemActions className="shrink-0 text-xs text-muted-foreground"></ItemActions>
                                </Item>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-52" side="right">
                                {/*<ContextMenuGroup>*/}
                                {/*  <ContextMenuItem onClick={() => handleContextMenuOpen(s.id, "open")}>*/}
                                {/*    <FileText className="h-4 w-4" />*/}
                                {/*    Open as Editor*/}
                                {/*    <ContextMenuShortcut>⌃⏎</ContextMenuShortcut>*/}
                                {/*  </ContextMenuItem>*/}
                                {/*  <ContextMenuItem onClick={() => handleContextMenuOpen(s.id, "beside")}>*/}
                                {/*    <Columns2 className="h-4 w-4" />*/}
                                {/*    Open to the Side*/}
                                {/*    <ContextMenuShortcut>⌃⌥⏎</ContextMenuShortcut>*/}
                                {/*  </ContextMenuItem>*/}
                                {/*  <ContextMenuItem onClick={() => handleContextMenuOpen(s.id, "newWindow")}>*/}
                                {/*    <ExternalLink className="h-4 w-4" />*/}
                                {/*    Open in new Window*/}
                                {/*  </ContextMenuItem>*/}
                                {/*</ContextMenuGroup>*/}
                                {/*<ContextMenuSeparator />*/}
                                <ContextMenuGroup>
                                  <ContextMenuItem onClick={async () => handleInspectJsonl(s.id)}>
                                    <FileText className="h-4 w-4" />
                                    Inspect JSONL
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard
                                        .writeText(JSON.stringify({ sessionId: s.id }))
                                        .catch(() => {});
                                      toast.success("Copied to clipboard", { position: "top-center" });
                                    }}
                                  >
                                    <FileCodeCorner className="h-4 w-4" />
                                    Copy Session ID
                                  </ContextMenuItem>
                                </ContextMenuGroup>
                                <ContextMenuSeparator />
                                <ContextMenuGroup>
                                  <ContextMenuItem onClick={() => handleStartRename(s.id)}>
                                    <Pencil className="h-4 w-4" />
                                    Rename...
                                    <ContextMenuShortcut>⏎</ContextMenuShortcut>
                                  </ContextMenuItem>
                                  <AlertDialogTrigger asChild>
                                    <ContextMenuItem variant="destructive">
                                      <Trash2 className="h-4 w-4" />
                                      Delete...
                                      <ContextMenuShortcut>⌫</ContextMenuShortcut>
                                    </ContextMenuItem>
                                  </AlertDialogTrigger>
                                </ContextMenuGroup>
                              </ContextMenuContent>
                            </ContextMenu>
                            <AlertDialogContent className="w-96">
                              <AlertDialogHeader>
                                <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                                  <Trash2 />
                                </AlertDialogMedia>
                                <AlertDialogTitle>Delete chat?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete this chat conversation. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
                                <AlertDialogAction variant="destructive" onClick={() => handleConfirmDelete(s.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </React.Fragment>
                    ))}
                  </ItemGroup>
                ) : null
              )
            )}
          </div>
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
  );
}
