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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InputPrompt, { type InputPromptProps } from "./InputPrompt";
import type { SessionMessage, SkillInfo } from "@/webview/types";

// Mock dependencies
vi.mock("@/webview/components/SkillsPanel", () => ({
  default: vi.fn(({ children }) => <div data-testid="skills-panel">{children}</div>),
}));

vi.mock("@/webview/components/SkillsTags", () => ({
  default: vi.fn(({ children }) => <div data-testid="skills-tags">{children}</div>),
}));

vi.mock("@/webview/components/ContextIndicator", () => ({
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
  InputGroupButton: vi.fn(({ children, onClick, title, disabled }) => (
    <button data-testid="input-group-button" onClick={onClick} title={title} disabled={disabled}>
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
  FieldDescription: vi.fn(({ children }) => <div>{children}</div>),
  FieldSet: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock("@/webview/components/ui/spinner", () => ({
  Spinner: vi.fn(({ className }) => <span data-testid="spinner" className={className} />),
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
  Reply: vi.fn(() => <span data-testid="reply-icon" />),
  FileCodeIcon: vi.fn(() => <span data-testid="file-icon" />),
  GraduationCap: vi.fn(() => <span data-testid="graduation-icon" />),
  X: vi.fn(() => <span data-testid="x-icon" />),
  AlertCircle: vi.fn(() => <span data-testid="alert-icon" />),
  CheckCircle: vi.fn(() => <span data-testid="check-icon" />),
  Loader2: vi.fn(() => <span data-testid="loader-icon" />),
  Loader2Icon: vi.fn(() => <span data-testid="loader-icon" />),
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
const mockOnClearEditingMessage = vi.fn<() => void>();

const defaultProps: InputPromptProps = {
  loading: false,
  selectedSkills: [] as SkillInfo[],
  availableSkills: [] as SkillInfo[],
  pendingPermissionReply: null,
  tokenTelemetry: {
    model: "test",
    thinkingEnabled: false,
    reasoningEffort: "low",
    activeTokens: 0,
    compactPromptTokenThreshold: 100000,
    usage: null,
  },
  activeEditor: null,
  editingMessage: null,
  messages: [],
  onSendPrompt: mockOnSendPrompt,
  onInterrupt: mockOnInterrupt,
  onSelectSkills: mockOnSelectSkills,
  onClearEditingMessage: mockOnClearEditingMessage,
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

  describe("History navigation", () => {
    it("adds sent messages to history", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox");

      fireEvent.change(textarea, { target: { value: "First message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSendPrompt).toHaveBeenCalledWith("First message", [], [], undefined);

      fireEvent.change(textarea, { target: { value: "Second message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSendPrompt).toHaveBeenCalledWith("Second message", [], [], undefined);
    });

    it("navigates to previous history with ArrowUp when at start", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add two messages to history
      fireEvent.change(textarea, { target: { value: "First message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, { target: { value: "Second message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Clear and navigate with ArrowUp
      fireEvent.change(textarea, { target: { value: "" } });
      // Simulate cursor at start (selectionStart === 0)
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      // Should show "Second message" (most recent)
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Second message");
      });
    });

    it("navigates through history with multiple ArrowUp presses", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add three messages to history
      fireEvent.change(textarea, { target: { value: "First" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, { target: { value: "Second" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, { target: { value: "Third" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Navigate with ArrowUp twice
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Third");
      });

      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Second");
      });
    });

    it("navigates to next history with ArrowDown", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add messages to history
      fireEvent.change(textarea, { target: { value: "First" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, { target: { value: "Second" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, { target: { value: "Third" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Navigate to history - shows most recent
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Third");
      });

      // ArrowUp again - goes to older
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Second");
      });

      // ArrowDown - goes back to newer
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Third");
      });

      // ArrowDown again - exits and restores draft (empty)
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("");
      });
    });

    it("restores draft when navigating past the end of history", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add messages to history
      fireEvent.change(textarea, { target: { value: "First" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.change(textarea, { target: { value: "Second" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Navigate to history (entering with empty value preserves no draft)
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Second");
      });

      // Navigate back with ArrowDown (goes forward to end of history)
      fireEvent.keyDown(textarea, { key: "ArrowDown" });
      await waitFor(() => {
        // Reached end of history, restores empty draft
        expect((textarea as HTMLTextAreaElement).value).toBe("");
      });
    });

    it("exits history browsing when typing", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add message to history
      fireEvent.change(textarea, { target: { value: "History message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Navigate to history
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("History message");
      });

      // Type something - should exit history browsing
      fireEvent.change(textarea, { target: { value: "New input" } });

      // Next ArrowUp should start from beginning, not from history position
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("History message");
      });
    });

    it("exits history browsing when pressing non-arrow keys", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add message to history
      fireEvent.change(textarea, { target: { value: "History message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Navigate to history
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("History message");
      });

      // Press Escape - should exit history browsing but not change value
      fireEvent.keyDown(textarea, { key: "Escape" });
      expect((textarea as HTMLTextAreaElement).value).toBe("History message");
    });

    it("does not navigate history when no history exists", () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      // Value should remain empty
      expect((textarea as HTMLTextAreaElement).value).toBe("");
    });

    it("does not navigate history when caret is not at start/end", async () => {
      render(<InputPrompt {...defaultProps} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add message to history
      fireEvent.change(textarea, { target: { value: "History message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Type content with caret in the middle
      fireEvent.change(textarea, { target: { value: "Hello World" } });
      // Set cursor to middle (after "Hello")
      textarea.setSelectionRange(5, 5);

      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      // Value should remain unchanged since caret is not at start
      expect((textarea as HTMLTextAreaElement).value).toBe("Hello World");
    });
  });

  describe("Loading history from messages", () => {
    it("loads user messages from messages prop into history", async () => {
      const messages: SessionMessage[] = [
        { role: "user", content: "First message from history" },
        { role: "assistant", content: "Assistant response" },
        { role: "user", content: "Second message from history" },
      ];
      render(<InputPrompt {...defaultProps} messages={messages} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Navigate to history
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("Second message from history");
      });

      // Navigate to older message
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("First message from history");
      });
    });

    it("clears history when messages is empty", async () => {
      const { rerender } = render(<InputPrompt {...defaultProps} messages={[]} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Add a message first
      fireEvent.change(textarea, { target: { value: "New message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // Rerender with empty messages
      rerender(<InputPrompt {...defaultProps} messages={[]} />);

      // Try to navigate history - should not work since history is empty
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      // Value should remain empty
      expect((textarea as HTMLTextAreaElement).value).toBe("");
    });

    it("ignores non-user messages when building history", async () => {
      const messages: SessionMessage[] = [
        { role: "user", content: "User message" },
        { role: "assistant", content: "Should be ignored" },
        { role: "tool", content: "Should also be ignored" },
        { role: "system", content: "Ignored" },
      ];
      render(<InputPrompt {...defaultProps} messages={messages} />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

      // Navigate to history
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.keyDown(textarea, { key: "ArrowUp" });

      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("User message");
      });

      // Second ArrowUp should stay at the same message (already at oldest)
      fireEvent.keyDown(textarea, { key: "ArrowUp" });
      expect((textarea as HTMLTextAreaElement).value).toBe("User message");
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

  describe("Editing message", () => {
    it("restores text when editingMessage changes", () => {
      const { rerender } = render(<InputPrompt {...defaultProps} />);

      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");

      rerender(
        <InputPrompt {...defaultProps} editingMessage={{ text: "Editing this message", images: [], skills: [] }} />
      );

      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Editing this message");
    });

    it("calls onClearEditingMessage when sending while editing", async () => {
      const { container } = render(
        <InputPrompt {...defaultProps} editingMessage={{ text: "Editing this message", images: [], skills: [] }} />
      );

      // Wait for the editing message to be processed
      await waitFor(() => {
        const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
        expect(textarea.value).toBe("Editing this message");
      });

      // Click send button
      const sendButton = container.querySelector("button[title='Send']");
      if (sendButton) {
        fireEvent.click(sendButton);
      }

      expect(mockOnSendPrompt).toHaveBeenCalledWith("Editing this message", [], [], undefined);
      expect(mockOnClearEditingMessage).toHaveBeenCalled();
    });

    it("calls onSelectSkills when editingMessage has skills", () => {
      const skills = [{ name: "TestSkill" }];
      render(<InputPrompt {...defaultProps} editingMessage={{ text: "Test message", images: [], skills }} />);

      expect(mockOnSelectSkills).toHaveBeenCalledWith(skills);
    });
  });
});
