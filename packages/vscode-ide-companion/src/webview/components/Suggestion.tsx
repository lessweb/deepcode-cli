import React, { useCallback } from "react";
import type { CommandsItem, SkillInfo, TokenTelemetry } from "@/webview/types";
import { InputGroupButton } from "@/webview/components/ui/input-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/webview/components/ui/command";
import {
  Brain,
  ChevronRight,
  FileQuestionMark,
  GraduationCap,
  Settings2,
  SlidersHorizontal,
  SquareSlash,
  Terminal,
} from "lucide-react";
import { toTitleCase } from "@/webview/utils";
import { PopoverContent, PopoverTrigger } from "@/webview/components/ui/popover";
import { cn } from "@/webview/lib/utils";
import { chatService } from "@/webview/services";
import { DEEPCODE_DOCS_URL } from "@/webview/constants";
import { Switch } from "@/webview/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/webview/components/ui/dropdown-menu";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/webview/components/ui/item";
import { Segmented, SegmentedItem } from "@/webview/components/ui/segmented";

interface SkillsPanelProps {
  availableSkills: SkillInfo[];
  selectedSkills: SkillInfo[];
  commands?: Array<CommandsItem>;
  onToggle: (skill: SkillInfo) => void;
  size?: { width: number; height: number };
  onCancel?: () => void;
  onCommandInput?: (command: string) => void;
  searchQuery?: string;
  /** Current model name (e.g. "deepseek-v4-pro") */
  currentModel?: string;
  /** Whether thinking mode is enabled */
  thinkingEnabled?: boolean;
  /** Reasoning effort level */
  reasoningEffort?: "high" | "max";
  /** Called after model config is persisted, with updated tokenTelemetry */
  onModelConfigChange?: (tokenTelemetry: TokenTelemetry) => void;
}

/**
 * Suggestion 快捷指令
 * @param param0
 * @param param0.commands
 * @param param0.availableSkills
 * @param param0.selectedSkills
 * @param param0.onToggle
 * @param param0.onCommandInput
 * @param param0.size
 * @param param0.onCancel
 * @param param0.searchQuery
 * @param param0.currentModel
 * @param param0.thinkingEnabled
 * @param param0.reasoningEffort
 * @param param0.onModelConfigChange
 * @constructor
 */
export default function Suggestion({
  commands,
  availableSkills = [],
  selectedSkills,
  onToggle,
  onCommandInput,
  size,
  onCancel,
  searchQuery,
  currentModel = "deepseek-v4-pro",
  thinkingEnabled = true,
  reasoningEffort = "max",
  onModelConfigChange,
}: SkillsPanelProps) {
  const query = (searchQuery || "").toLowerCase();
  const [effort, setEffort] = React.useState<string>(reasoningEffort);
  const [thinking, setThinking] = React.useState<boolean>(thinkingEnabled);
  const [selectedModel, setSelectedModel] = React.useState<string>(currentModel);

  // Sync local state when props change (e.g. after settings update)
  React.useEffect(() => {
    setEffort(reasoningEffort);
  }, [reasoningEffort]);
  React.useEffect(() => {
    setThinking(thinkingEnabled);
  }, [thinkingEnabled]);
  React.useEffect(() => {
    setSelectedModel(currentModel);
  }, [currentModel]);

  /** Persist model config change to settings.json and notify parent */
  const handleModelConfigChange = useCallback(
    async (config: { model?: string; thinkingEnabled?: boolean; reasoningEffort?: "high" | "max" }) => {
      const payload = {
        model: config.model ?? selectedModel,
        thinkingEnabled: config.thinkingEnabled ?? thinkingEnabled,
        reasoningEffort: config.reasoningEffort ?? reasoningEffort,
      };
      // Optimistic UI update
      if (config.model !== undefined) setSelectedModel(config.model);
      if (config.thinkingEnabled !== undefined) setThinking(config.thinkingEnabled);
      if (config.reasoningEffort !== undefined) setEffort(config.reasoningEffort);
      try {
        const result = await chatService.updateModelConfig(payload);
        if (result.ok && result.tokenTelemetry) {
          onModelConfigChange?.(result.tokenTelemetry);
        }
      } catch (err) {
        // Revert on error
        void chatService.showAlert("[Suggestion] Failed to update model config:" + JSON.stringify(err), "error");
        setSelectedModel(currentModel);
        setThinking(thinkingEnabled);
        setEffort(reasoningEffort);
      }
    },
    [selectedModel, thinkingEnabled, reasoningEffort, currentModel, onModelConfigChange]
  );

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

  return (
    <>
      <PopoverTrigger asChild>
        <InputGroupButton
          size="xs"
          className="text-xs text-muted-foreground cursor-pointer"
          title="Show command menu (/)"
        >
          <SquareSlash className="h-3 w-3" />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent
        className={cn(`m-auto p-0`)}
        style={{ width: (size?.width || 0) - 32 }}
        sideOffset={size?.height ? size?.height - 50 : 50}
        alignOffset={-56}
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
            <CommandGroup heading="Model">
              <CommandItem>
                <Settings2 className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1 truncate text-[13px] font-medium">Switch model</span>
                <CommandShortcut>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <span className="font-semibold tracking-normal cursor-pointer hover:text-primary">
                        {toTitleCase(selectedModel)}
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-72">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Switch model</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={selectedModel}
                          onValueChange={(value) => handleModelConfigChange({ model: value })}
                        >
                          <DropdownMenuRadioItem value="deepseek-v4-pro">
                            <Item size="xs">
                              <ItemContent>
                                <ItemTitle className="text-xs">Deepseek V4 Pro</ItemTitle>
                                <ItemDescription className="text-[10px]">Most capable reasoning model</ItemDescription>
                              </ItemContent>
                            </Item>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="deepseek-v4-flash">
                            <Item size="xs">
                              <ItemContent>
                                <ItemTitle className="text-xs">Deepseek V4 Flash</ItemTitle>
                                <ItemDescription className="text-[10px]">Fast, general-purpose model</ItemDescription>
                              </ItemContent>
                            </Item>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CommandShortcut>
              </CommandItem>
              <CommandItem>
                <Brain className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1 truncate text-[13px] font-medium">Thinking</span>
                <CommandShortcut>
                  <Switch
                    id="switch-thinking"
                    size="sm"
                    checked={thinking}
                    onCheckedChange={(checked) => handleModelConfigChange({ thinkingEnabled: checked })}
                  />
                </CommandShortcut>
              </CommandItem>
              <CommandItem>
                <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1 truncate text-[13px] font-medium">Effort</span>
                <CommandShortcut>
                  <Segmented
                    value={effort}
                    size="xs"
                    className="tracking-normal"
                    onValueChange={(value) => handleModelConfigChange({ reasoningEffort: value as "high" | "max" })}
                  >
                    <SegmentedItem value="max">Max</SegmentedItem>
                    <SegmentedItem value="high">High</SegmentedItem>
                  </Segmented>
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
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
