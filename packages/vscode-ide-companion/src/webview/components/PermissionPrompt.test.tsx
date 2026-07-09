/**
 * Unit tests for PermissionPrompt component
 *
 * Tests cover:
 * - normalizeRequests
 * - describeScope
 * - getRiskClass
 * - commitDecision flow
 * - isAskPermission / isDenied conditions
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PermissionPrompt, { type PermissionPromptProps } from "./PermissionPrompt";
import type { AskPermissionRequest, AppAction } from "@/webview/types";

// Mock dependencies
vi.mock("@/webview/components/ui/button", () => ({
  Button: vi.fn(({ children, onClick, ...props }) => (
    <button data-testid="permission-button" onClick={onClick} {...props}>
      {children}
    </button>
  )),
}));

vi.mock("@/webview/components/ui/hover-card", () => ({
  HoverCard: vi.fn(({ children }) => <div data-testid="hover-card">{children}</div>),
  HoverCardContent: vi.fn(({ children }) => <div data-testid="hover-card-content">{children}</div>),
  HoverCardTrigger: vi.fn(({ children }) => <div data-testid="hover-card-trigger">{children}</div>),
}));

vi.mock("lucide-react", () => ({
  X: vi.fn(() => <span data-testid="x-icon" />),
  ShieldAlert: vi.fn(() => <span data-testid="shield-icon" />),
}));

const mockDispatch = vi.fn<(action: AppAction) => void>();
const mockOnDenyPermission = vi.fn<(sessionId: string) => void>();
const mockOnSendPrompt =
  vi.fn<
    (
      prompt: string,
      skills?: unknown[],
      images?: string[],
      options?: { permissions?: unknown[]; alwaysAllows?: string[] }
    ) => void
  >();
const mockOnInterrupt = vi.fn<() => void>();

const defaultProps: PermissionPromptProps = {
  askPermissions: [] as AskPermissionRequest[],
  sessionStatus: "idle",
  pendingPermissionReply: null,
  permissionPromptState: null,
  activeSessionId: "session-1",
  dispatch: mockDispatch,
  onDenyPermission: mockOnDenyPermission,
  onSendPrompt: mockOnSendPrompt,
  onInterrupt: mockOnInterrupt,
};

describe("PermissionPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no permissions requested", () => {
    const { container } = render(<PermissionPrompt {...defaultProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when sessionStatus is not ask_permission", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "running" as const,
    };
    const { container } = render(<PermissionPrompt {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders permission prompt when ask_permission status", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "ask_permission" as const,
    };
    render(<PermissionPrompt {...props} />);
    expect(screen.getByText("Permission required")).toBeInTheDocument();
  });

  it("renders denied state when permission denied", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "permission_denied" as const,
      pendingPermissionReply: { allow: false, alwaysAllows: [] },
    };
    render(<PermissionPrompt {...props} />);
    expect(screen.getByText(/denied/i)).toBeInTheDocument();
  });

  it("calls onDenyPermission when No clicked", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "ask_permission" as const,
    };
    render(<PermissionPrompt {...props} />);
    const noButton = screen.getByText("No");
    fireEvent.click(noButton);
    expect(mockOnDenyPermission).toHaveBeenCalled();
  });

  it("calls onSendPrompt when Yes clicked", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "ask_permission" as const,
    };
    render(<PermissionPrompt {...props} />);
    const yesButton = screen.getByText("Yes");
    fireEvent.click(yesButton);
    expect(mockOnSendPrompt).toHaveBeenCalledWith(
      "/continue",
      [],
      [],
      expect.objectContaining({ permissions: expect.any(Array) })
    );
  });

  it("shows always allow button when canAlwaysAllow", () => {
    const props: PermissionPromptProps = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "ask_permission",
      permissionPromptState: {
        requests: [],
        prompts: [],
        index: 0,
        decisions: {},
        alwaysAllows: [],
        submitting: false,
      },
    };
    render(<PermissionPrompt {...props} />);
    expect(screen.getByText(/always allow/i)).toBeInTheDocument();
  });

  it("calls onInterrupt when cancel clicked", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "ask_permission" as const,
    };
    render(<PermissionPrompt {...props} />);
    const cancelButton = screen.getByTitle("Interrupt");
    fireEvent.click(cancelButton);
    expect(mockOnInterrupt).toHaveBeenCalled();
  });

  it("renders risk class badge for scope", () => {
    const props = {
      ...defaultProps,
      askPermissions: [{ toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] }],
      sessionStatus: "ask_permission" as const,
    };
    render(<PermissionPrompt {...props} />);
    // Check for the risk class styling (bg-green-500 for read-in-cwd scope)
    expect(document.body.innerHTML).toContain("bg-green-500/15");
  });

  it("renders multiple permission requests with index", () => {
    const props = {
      ...defaultProps,
      askPermissions: [
        { toolCallId: "tool1", name: "read", command: "cat", description: "", scopes: ["read-in-cwd"] },
        { toolCallId: "tool2", name: "write", command: "echo", description: "", scopes: ["write-in-cwd"] },
      ],
      sessionStatus: "ask_permission" as const,
    };
    render(<PermissionPrompt {...props} />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });
});
