import React from "react";
import type { CommandsItem, SkillInfo } from "@/webview/types";
import { InputGroupButton } from "@/webview/components/ui/input-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/webview/components/ui/command";
import { ChevronRight, FileQuestionMark, GraduationCap, Terminal } from "lucide-react";
import { toTitleCase } from "@/webview/utils";
import { PopoverContent, PopoverTrigger } from "@/webview/components/ui/popover";
import { cn } from "@/webview/lib/utils";
import { chatService } from "@/webview/services";
import { DEEPCODE_DOCS_URL } from "@/webview/constants";

interface SkillsPanelProps {
  availableSkills: SkillInfo[];
  selectedSkills: SkillInfo[];
  commands?: Array<CommandsItem>;
  onToggle: (skill: SkillInfo) => void;
  size?: { width: number; height: number };
  onCancel?: () => void;
  onCommandInput?: (command: string) => void;
  searchQuery?: string;
}

export default function SkillsPanel({
  commands,
  availableSkills,
  selectedSkills,
  onToggle,
  onCommandInput,
  size,
  onCancel,
  searchQuery,
}: SkillsPanelProps) {
  const query = (searchQuery || "").toLowerCase();

  // Filter skills based on search query
  const filteredSkills = query
    ? availableSkills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description?.toLowerCase().includes(query) ||
          skill.path?.toLowerCase().includes(query)
      )
    : availableSkills;

  // Filter commands based on search query
  const filteredCommands =
    query && commands
      ? commands.filter(
          (cmd) => cmd.label.toLowerCase().includes(query) || cmd.description?.toLowerCase().includes(query)
        )
      : commands;
  if (availableSkills.length === 0) {
    return (
      <InputGroupButton disabled className="text-xs h-8 text-muted-foreground">
        <GraduationCap className="h-3 w-3" />
        <span>Skills</span>
      </InputGroupButton>
    );
  }

  return (
    <>
      <PopoverTrigger asChild>
        <InputGroupButton className="text-xs h-8 text-muted-foreground cursor-pointer">
          <GraduationCap className="h-3 w-3" />
          <span>Skills</span>
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        className={cn(`m-auto p-0`)}
        style={{ width: (size?.width || 0) - 32 }}
        sideOffset={size?.height ? size?.height - 50 : 50}
        alignOffset={-10}
        side="top"
        align="start"
        onOpenAutoFocus={(e) => {
          // Prevent popover from stealing focus when opened via "/" command mode
          if (searchQuery) {
            e.preventDefault();
          }
        }}
      >
        <Command className="w-full" label="Skills command palette">
          <CommandList>
            {filteredCommands && filteredCommands.length > 0 && (
              <CommandGroup heading="Commands">
                {filteredCommands.map((command) => (
                  <CommandItem
                    className="cursor-pointer"
                    key={command.command}
                    onSelect={() => {
                      onCancel?.();
                      onCommandInput?.(command.command);
                    }}
                  >
                    <Terminal className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 truncate text-[13px] font-medium">{toTitleCase(command.label)}</span>
                    <span className="text-xs text-muted-foreground max-w-1/2 truncate">{command.description}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Select Skills">
              {filteredSkills.map((skill) => {
                const selected = selectedSkills.some((s) => s.name === skill.name);
                return (
                  <CommandItem
                    data-checked={skill.isLoaded || selected}
                    key={skill.name}
                    onSelect={() => onToggle(skill)}
                    title={skill.path}
                    className="cursor-pointer"
                  >
                    <GraduationCap className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 truncate text-[13px] font-medium">{toTitleCase(skill.name)}</span>
                    <span className="text-xs text-muted-foreground max-w-1/2 truncate">{skill.path}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {filteredSkills.length === 0 && (!filteredCommands || filteredCommands.length === 0) && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            <CommandGroup heading="Support">
              <CommandItem
                className="cursor-pointer"
                onSelect={() => {
                  onCancel?.();
                  void chatService.openExternal(DEEPCODE_DOCS_URL);
                }}
              >
                <FileQuestionMark className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1 truncate text-[13px] font-medium">View help docs</span>
                <CommandShortcut>
                  <ChevronRight className="h-3 w-3" />
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </>
  );
}
