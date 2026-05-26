import DropdownMenu from "../DropdownMenu";
import React, { useEffect, useState } from "react";
import type { SkillInfo } from "../../../session";
import { useInput } from "ink";
import { isSkillSelected } from "../../views/SlashCommandMenu";
import { t } from "../../../common/i18n";

const SkillsDropdown: React.FC<{
  open: boolean;
  onClose?: (value: boolean) => void;
  width: number;
  skills: SkillInfo[];
  selectedSkills: SkillInfo[];
  onSelect?: (skill: SkillInfo) => void;
}> = ({ open, width, skills, selectedSkills, onSelect, onClose }) => {
  const [skillsDropdownIndex, setSkillsDropdownIndex] = useState(0);
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSkillsDropdownIndex((idx) => (idx - 1 + skills.length) % skills.length);
        return;
      }
      if (key.downArrow) {
        setSkillsDropdownIndex((idx) => (idx + 1) % skills.length);
        return;
      }
      if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
        const skill = skills[skillsDropdownIndex];
        if (skill) {
          onSelect?.(skill);
        }
        return;
      }
      if (key.tab) {
        onClose?.(false);
        return;
      }
      if (key.escape) {
        onClose?.(false);
      }
    },
    { isActive: open }
  );

  useEffect(() => {
    if (skillsDropdownIndex >= skills.length) {
      setSkillsDropdownIndex(Math.max(0, skills.length - 1));
    }
  }, [skills.length, skillsDropdownIndex]);

  if (!open) {
    return null;
  }

  return (
    <DropdownMenu
      width={width}
      title={t("ui.skillsDropdown.title")}
      helpText={t("ui.skillsDropdown.helpText")}
      emptyText={t("ui.skillsDropdown.emptyText")}
      items={skills.map((skill) => ({
        key: skill.path || skill.name,
        label: skill.name,
        description: skill.path,
        selected: isSkillSelected(selectedSkills, skill),
        statusIndicator: skill.isLoaded ? { symbol: "✓", color: "green" } : undefined,
      }))}
      activeIndex={skillsDropdownIndex}
      activeColor="#229ac3"
      maxVisible={6}
    />
  );
};

export default SkillsDropdown;
