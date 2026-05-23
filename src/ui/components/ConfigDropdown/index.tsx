import React, { useEffect, useMemo, useState } from "react";
import { useInput } from "ink";
import DropdownMenu from "../../DropdownMenu";
import { t, type Locale } from "../../../common/i18n";

type ConfigStep = "category" | "language";

type CategoryOption = {
  key: "locale" | "thinkingLocale" | "replyLocale";
  label: string;
};

function getCategoryOptions(): CategoryOption[] {
  return [
    { key: "locale", label: t("ui.config.language") },
    { key: "thinkingLocale", label: t("ui.config.thinkingLanguage") },
    { key: "replyLocale", label: t("ui.config.replyLanguage") },
  ];
}

const LOCALE_OPTIONS: { key: Locale; label: string }[] = [
  { key: "en", label: "English" },
  { key: "zh-CN", label: "中文" },
];

type Props = {
  open: boolean;
  currentLocale: Locale;
  currentThinkingLocale: Locale;
  currentReplyLocale: Locale;
  width: number;
  onClose: () => void;
  onLocaleChange: (locale: Locale) => void;
  onThinkingLocaleChange: (locale: Locale) => void;
  onReplyLocaleChange: (locale: Locale) => void;
};

const ConfigDropdown: React.FC<Props> = ({
  open,
  currentLocale,
  currentThinkingLocale,
  currentReplyLocale,
  width,
  onClose,
  onLocaleChange,
  onThinkingLocaleChange,
  onReplyLocaleChange,
}) => {
  const [step, setStep] = useState<ConfigStep | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption["key"] | null>(null);

  useEffect(() => {
    if (open) {
      setStep("category");
      setActiveIndex(0);
      setSelectedCategory(null);
    } else {
      setStep(null);
    }
  }, [open]);

  function getCurrentLocaleForCategory(category: CategoryOption["key"]): Locale {
    switch (category) {
      case "locale":
        return currentLocale;
      case "thinkingLocale":
        return currentThinkingLocale;
      case "replyLocale":
        return currentReplyLocale;
    }
  }

  function handleSelect(): void {
    if (step === "category") {
      const category = getCategoryOptions()[activeIndex];
      if (!category) {
        return;
      }
      setSelectedCategory(category.key);
      const currentValue = getCurrentLocaleForCategory(category.key);
      const localeIndex = LOCALE_OPTIONS.findIndex((opt) => opt.key === currentValue);
      setActiveIndex(localeIndex >= 0 ? localeIndex : 0);
      setStep("language");
      return;
    }

    const locale = LOCALE_OPTIONS[activeIndex];
    if (!locale || !selectedCategory) {
      return;
    }

    switch (selectedCategory) {
      case "locale":
        onLocaleChange(locale.key);
        break;
      case "thinkingLocale":
        onThinkingLocaleChange(locale.key);
        break;
      case "replyLocale":
        onReplyLocaleChange(locale.key);
        break;
    }
    onClose();
  }

  useInput(
    (input, key) => {
      if (!step) {
        return;
      }

      const optionCount = step === "category" ? getCategoryOptions().length : LOCALE_OPTIONS.length;

      if (key.upArrow) {
        setActiveIndex((idx) => (idx - 1 + optionCount) % optionCount);
        return;
      }
      if (key.downArrow) {
        setActiveIndex((idx) => (idx + 1) % optionCount);
        return;
      }
      if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
        handleSelect();
        return;
      }
      if (key.tab || key.escape) {
        if (step === "language") {
          setStep("category");
          setActiveIndex(0);
          return;
        }
        onClose();
        return;
      }
    },
    { isActive: open }
  );

  if (!open || !step) {
    return null;
  }

  const items =
    step === "category"
      ? getCategoryOptions().map((option) => ({
          key: option.key,
          label: option.label,
          selected: false,
        }))
      : LOCALE_OPTIONS.map((option) => ({
          key: option.key,
          label: option.label,
          description: option.key === getCurrentLocaleForCategory(selectedCategory!) ? "current" : "",
          selected: option.key === getCurrentLocaleForCategory(selectedCategory!),
        }));

  return (
    <DropdownMenu
      width={width}
      title={step === "category" ? t("ui.config.title") : t("ui.config.selectLanguage")}
      helpText={step === "category" ? t("ui.config.selectCategoryHelp") : t("ui.config.selectLanguageHelp")}
      items={items}
      activeIndex={activeIndex}
      activeColor="#229ac3"
      maxVisible={6}
    />
  );
};

export default ConfigDropdown;
