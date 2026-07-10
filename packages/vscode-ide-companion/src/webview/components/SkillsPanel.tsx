import React, { useState } from "react";
import type { SkillInfo } from "@/webview/types";
import { InputGroupButton } from "@/webview/components/ui/input-group";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/webview/components/ui/command";
import { GraduationCap } from "lucide-react";

interface SkillsPanelProps {
  availableSkills: SkillInfo[];
  selectedSkills: SkillInfo[];
  onToggle: (skill: SkillInfo) => void;
}

export default function SkillsPanel({ availableSkills, selectedSkills, onToggle }: SkillsPanelProps) {
  const [open, setOpen] = useState(false);

  if (availableSkills.length === 0) {
    return (
      <InputGroupButton disabled className="text-xs h-8 text-muted-foreground">
        <GraduationCap className="h-3 w-3" />
        <span>Skill</span>
      </InputGroupButton>
    );
  }

  return (
    <>
      <InputGroupButton className="text-xs h-8 text-muted-foreground cursor-pointer" onClick={() => setOpen(true)}>
        <GraduationCap className="h-3 w-3" />
        <span>Skill</span>
      </InputGroupButton>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command autoFocus className="w-full" label="Skills command palette">
          <CommandInput placeholder="Search skills..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Select Skills">
              {availableSkills.map((skill) => {
                const selected = selectedSkills.some((s) => s.name === skill.name);
                return (
                  <CommandItem
                    data-checked={skill.isLoaded || selected}
                    key={skill.name}
                    onSelect={() => onToggle(skill)}
                    title={skill.path}
                  >
                    <GraduationCap className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 truncate font-medium">{skill.name}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-50">{skill.path}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
