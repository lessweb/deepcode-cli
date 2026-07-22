import { useMemo, useCallback, memo } from "react";
import { User, Bot, Wrench, Info } from "lucide-react";
import type { SessionMessage } from "@/webview/types";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/webview/components/ui/command";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: SessionMessage[];
  onSelectMessage: (messageId: string) => void;
}

function getRoleIcon(role: string) {
  switch (role) {
    case "user":
      return <User className="size-4 shrink-0 text-blue-400" />;
    case "assistant":
      return <Bot className="size-4 shrink-0 text-green-400" />;
    case "tool":
      return <Wrench className="size-4 shrink-0 text-yellow-400" />;
    case "system":
      return <Info className="size-4 shrink-0 text-muted-foreground" />;
    default:
      return null;
  }
}

function getRoleLabel(role: string) {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    case "system":
      return "System";
    default:
      return role;
  }
}

const SearchDialog = memo(function SearchDialog({ open, onOpenChange, messages, onSelectMessage }: SearchDialogProps) {
  // Build a flat list of searchable items with their message IDs.
  // Only recompute when messages reference changes (shallow compare via React.memo).
  const searchableItems = useMemo(
    () =>
      messages
        .map((msg, index) => {
          const singleLine = (msg.content || "").replace(/\n/g, " ");
          const preview = singleLine.length > 80 ? singleLine.slice(0, 80) + "\u2026" : singleLine;
          return {
            id: msg.id || `msg-${index}`,
            role: msg.role,
            content: msg.content,
            searchValue: `${preview} ${getRoleLabel(msg.role)}`,
            index,
            preview,
          };
        })
        .filter((item) => item.content.trim()),
    [messages]
  );

  const handleSelect = useCallback(
    (itemId: string) => {
      onSelectMessage(itemId);
      onOpenChange(false);
    },
    [onSelectMessage, onOpenChange]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search Messages" className="max-w-lg">
      <Command>
        <CommandInput placeholder="Search messages..." />
        <CommandList>
          <CommandEmpty>No messages found.</CommandEmpty>
          <CommandGroup heading="Messages">
            {searchableItems.map((item) => (
              <CommandItem key={item.id} value={item.searchValue} onSelect={() => handleSelect(item.id)}>
                <div className="flex items-center gap-2 min-w-0">
                  {getRoleIcon(item.role)}
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-muted-foreground">{getRoleLabel(item.role)}</span>
                    <span className="text-sm truncate">{item.preview}</span>
                  </div>
                </div>
                <CommandShortcut>#{item.index + 1}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
});

export default SearchDialog;
