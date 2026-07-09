import { Badge } from "@/webview/components/ui/badge";
import type { SkillInfo } from "@/webview/types";
import { X } from "lucide-react";
import { InputGroupAddon } from "./ui/input-group";
import { Button } from "./ui/button";

interface SkillsTagsProps {
  selectedSkills: SkillInfo[];
  onRemove: (name: string) => void;
}

export default function SkillsTags({ selectedSkills, onRemove }: SkillsTagsProps) {
  if (selectedSkills.length === 0) return null;

  return (
    <InputGroupAddon className="flex flex-wrap gap-1.5" align="block-start">
      {selectedSkills.map((skill) => (
        <Badge key={skill.name} variant="secondary" className="gap-1 text-xs">
          {skill.name}
          <Button
            variant="ghost"
            className="ml-0.5 size-3 inline-flex cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onRemove(skill.name)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      ))}
    </InputGroupAddon>
  );
}
