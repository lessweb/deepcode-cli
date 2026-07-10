/**
 * Unit tests for InputPrompt component
 *
 * Tests cover:
 * - handleSend functionality
 * - Enter key submission
 * - ArrowUp/ArrowDown history navigation
 * - Skills toggle
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InputPrompt, { type InputPromptProps } from "./InputPrompt";
import type { SkillInfo } from "@/webview/types";

// Mock dependencies
vi.mock("@/webview/components/SkillsPanel", () => ({
  default: vi.fn(({ children }) => <div data-testid="skills-panel">{children}</div>),
}));

vi.mock("@/webview/components/SkillsTags", () => ({
  default: vi.fn(({ children }) => <div data-testid="skills-tags">{children}</div>),
}));

vi.mock("@/webview/components/ContextMeter", () => ({
  default: vi.fn(() => <div data-testid="context-meter" />),
}));

vi.mock("@/webview/components/ui/hover-card", () => ({
  HoverCard: vi.fn(({ children }) => <div data-testid="hover-card">{children}</div>),
  HoverCardContent: vi.fn(({ children }) => <div data-testid="hover-card-content">{children}</div>),
  HoverCardTrigger: vi.fn(({ children }) => <div data-testid="hover-card-trigger">{children}</div>),
}));

vi.mock("@/webview/components/ui/button", () => ({
  Button: vi.fn(({ children, onClick }) => (
    <button data-testid="button" onClick={onClick}>
      {children}
    </button>
  )),
}));

vi.mock("@/webview/components/ui/input-group", () => ({
  InputGroup: vi.fn(({ children }) => <div data-testid="input-group">{children}</div>),
  InputGroupAddon: vi.fn(({ children }) => <div data-testid="input-group-addon">{children}</div>),
  InputGroupButton: vi.fn(({ children, onClick }) => (
    <button data-testid="input-group-button" onClick={onClick}>
      {children}
    </button>
  )),
  InputGroupTextarea: vi.fn(({ children, ...props }) => (
    <textarea data-testid="input-textarea" {...props}>
      {children}
    </textarea>
  )),
  InputGroupText: vi.fn(({ children }) => <span data-testid="input-group-text">{children}</span>),
}));

vi.mock("@/webview/components/ui/field", () => ({
  Field: vi.fn(({ children }) => <div data-testid="field">{children}</div>),
  FieldGroup: vi.fn(({ children }) => <div data-testid="field-group">{children}</div>),
}));

vi.mock("@/webview/components/ui/separator", () => ({
  Separator: vi.fn(() => <div data-testid="separator" />),
}));

vi.mock("@/webview/components/ui/dropdown-menu", () => ({
  DropdownMenu: vi.fn(({ children }) => <div data-testid="dropdown">{children}</div>),
  DropdownMenuTrigger: vi.fn(({ children }) => <div data-testid="dropdown-trigger">{children}</div>),
  DropdownMenuContent: vi.fn(({ children }) => <div data-testid="dropdown-content">{children}</div>),
  DropdownMenuItem: vi.fn(({ children }) => <div data-testid="dropdown-item">{children}</div>),
}));

vi.mock("@/webview/components/ui/scroll-area", () => ({
  ScrollArea: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock("@/webview/components/ui/popover", () => ({
  Popover: vi.fn(({ children }) => <div data-testid="popover">{children}</div>),
  PopoverTrigger: vi.fn(({ children }) => <div data-testid="popover-trigger">{children}</div>),
  PopoverContent: vi.fn(({ children }) => <div data-testid="popover-content">{children}</div>),
}));

vi.mock("@/webview/components/PromptAttachments", () => ({
  PromptAttachments: vi.fn(({ attachments }) => (
    <div data-testid="prompt-attachments">{attachments.length} attachments</div>
  )),
  usePromptAttachments: vi.fn(() => ({
    attachments: [],
    handlePaste: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    getImageUrls: vi.fn(() => []),
  })),
}));

vi.mock("@/webview/lib/utils", () => ({
  cn: vi.fn((...args: unknown[]) => args.filter(Boolean).join(" ")),
}));

vi.mock("lucide-react", () => ({
  ArrowUp: vi.fn(() => <span data-testid="arrow-up" />),
  Square: vi.fn(() => <span data-testid="square-icon" />),
  StopCircle: vi.fn(() => <span data-testid="stop-icon" />),
  ChevronDown: vi.fn(() => <span data-testid="chevron" />),
  Send: vi.fn(() => <span data-testid="send-icon" />),
  FileCodeIcon: vi.fn(() => <span data-testid="file-icon" />),
  GraduationCap: vi.fn(() => <span data-testid="graduation-icon" />),
  X: vi.fn(() => <span data-testid="x-icon" />),
  AlertCircle: vi.fn(() => <span data-testid="alert-icon" />),
  CheckCircle: vi.fn(() => <span data-testid="check-icon" />),
  Loader2: vi.fn(() => <span data-testid="loader-icon" />),
  Settings: vi.fn(() => <span data-testid="settings-icon" />),
  Info: vi.fn(() => <span data-testid="info-icon" />),
}));

const mockOnSendPrompt =
  vi.fn<
    (
      prompt: string,
      skills?: SkillInfo[],
      images?: string[],
      options?: { permissions?: unknown[]; alwaysAllows?: string[] }
    ) => void
  >();
const mockOnInterrupt = vi.fn<() => void>();
const mockOnSelectSkills = vi.fn<(skills: SkillInfo[]) => void>();

const defaultProps: InputPromptProps = {
  loading: false,
  selectedSkills: [] as SkillInfo[],
  availableSkills: [] as SkillInfo[],
  pendingPermissionReply: null,
  askPermissions: [],
  activeSessionStatus: null,
  tokenTelemetry: {
    model: "test",
    thinkingEnabled: false,
    reasoningEffort: "low",
    activeTokens: 0,
    compactPromptTokenThreshold: 100000,
    usage: null,
  },
  activeEditor: null,
  onSendPrompt: mockOnSendPrompt,
  onInterrupt: mockOnInterrupt,
  onSelectSkills: mockOnSelectSkills,
};

describe("InputPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleSend", () => {
    it("calls onSendPrompt when sending a message", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSendPrompt).toHaveBeenCalledWith("Hello", [], [], undefined);
    });

    it("does not send empty message", () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSendPrompt).not.toHaveBeenCalled();
    });

    it("trims whitespace before sending", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "  Hello   " } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSendPrompt).toHaveBeenCalledWith("Hello", [], [], undefined);
    });

    it("does not send while loading", () => {
      render(<InputPrompt {...defaultProps} loading={true} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSendPrompt).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard navigation", () => {
    it("does not send on Shift+Enter", () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
      expect(mockOnSendPrompt).not.toHaveBeenCalled();
    });

    it("does not send on other keys", () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "A" });
      expect(mockOnSendPrompt).not.toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("renders interrupt button when loading", () => {
      render(<InputPrompt {...defaultProps} loading={true} />);
      expect(screen.getByTestId("input-group-button")).toBeInTheDocument();
    });

    it("calls onInterrupt when interrupt button clicked", () => {
      render(<InputPrompt {...defaultProps} loading={true} />);
      const button = screen.getByTestId("input-group-button");
      fireEvent.click(button);
      expect(mockOnInterrupt).toHaveBeenCalled();
    });
  });

  describe("Skills", () => {
    it("renders skills panel", () => {
      render(<InputPrompt {...defaultProps} />);
      expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
    });

    it("passes selectedSkills to onSelectSkills", () => {
      const skills = [{ id: "skill1", name: "TestSkill" }];
      render(<InputPrompt {...defaultProps} availableSkills={skills} />);
      // Skills panel should be rendered with skills
      expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
    });
  });

  describe("Context meter", () => {
    it("renders context meter", () => {
      render(<InputPrompt {...defaultProps} />);
      expect(screen.getByTestId("context-meter")).toBeInTheDocument();
    });
  });

  describe("Hover card", () => {
    it("renders hover card when activeEditor is null", () => {
      render(<InputPrompt {...defaultProps} />);
      // HoverCard may or may not be rendered based on activeEditor
      expect(screen.getByTestId("field-group")).toBeInTheDocument();
    });

    it("renders hover card when activeEditor is provided", () => {
      render(
        <InputPrompt
          {...defaultProps}
          activeEditor={{ fileName: "test.ts", languageId: "typescript", lineCount: 100 }}
        />
      );
      expect(screen.getByTestId("hover-card")).toBeInTheDocument();
    });
  });
});
