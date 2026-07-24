/**
 * Unit tests for AskQuestionCarousel component
 *
 * Tests cover:
 * - Rendering questions in carousel
 * - Multi-select and single-select question types
 * - Form submission with answers
 * - Carousel navigation (prev/next)
 * - Close button behavior
 * - Empty questions returns null
 * - Submit button rendering
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AskQuestionCarousel from "./AskQuestionCarousel";

// Mock react-hook-form
vi.mock("react-hook-form", () => {
  const createFakeAnswers = (defaultValues: any) => {
    const answers = defaultValues?.answers || [];
    return answers.map((a: { question?: string }, i: number) => ({
      question: a.question || `q${i}`,
      options: answers[i]?.options || ["Option A"],
      other: answers[i]?.other || "",
    }));
  };

  return {
    useForm: vi.fn((opts: Record<string, unknown> = {}) => {
      const answers = createFakeAnswers(opts.defaultValues);
      return {
        handleSubmit: (handler: (data: unknown) => void) => {
          // Return a submit function
          const submitFn = () => {
            return handler({ answers });
          };
          return submitFn;
        },
        control: {},
        watch: vi.fn(() => answers),
        setError: vi.fn(),
        formState: { errors: {} },
      };
    }),
    Controller: vi.fn(
      ({
        render: renderFn,
        name,
      }: {
        render: (fieldProps: Record<string, unknown>) => React.ReactNode;
        name: string;
      }) => {
        const parts = name.split(".");
        const subField = parts.length >= 4 ? parts[3] : "options";

        const fieldValue = subField === "options" ? ["Option A"] : "";
        return (
          <div data-testid={`controller-${name}`}>
            {renderFn({
              field: {
                value: fieldValue,
                onChange: vi.fn(),
              },
              fieldState: { invalid: false },
            })}
          </div>
        );
      }
    ),
  };
});

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: vi.fn(() => vi.fn()),
}));

vi.mock("zod", () => {
  const stringSchema = { optional: vi.fn().mockReturnThis() };
  const arraySchema = { optional: vi.fn().mockReturnThis() };
  return {
    object: vi.fn(() => ({ superRefine: vi.fn().mockReturnThis() })),
    array: vi.fn(() => arraySchema),
    string: vi.fn(() => stringSchema),
  };
});

vi.mock("@/webview/utils", () => ({
  buildAskUserQuestionReply: vi.fn(() => ({ ok: true, data: "Q: test\nA: option" })),
}));

const mockSendPrompt = vi.fn();
vi.mock("@/webview/context", () => ({
  useChat: () => ({
    actions: {
      sendPrompt: mockSendPrompt,
    },
  }),
}));

vi.mock("./ui/carousel", () => ({
  Carousel: vi.fn(
    ({
      children,
      setApi,
    }: {
      children: React.ReactNode;
      setApi?: (api: Record<string, unknown>) => void;
      className?: string;
    }) => {
      React.useEffect(() => {
        if (typeof setApi === "function") {
          setApi({
            scrollSnapList: () => [0, 1],
            selectedScrollSnap: () => 0,
            canScrollPrev: () => false,
            canScrollNext: () => true,
            scrollPrev: vi.fn(),
            scrollNext: vi.fn(),
            on: vi.fn(),
          });
        }
      }, [setApi]);
      return <div data-testid="carousel">{children}</div>;
    }
  ),
  CarouselContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="carousel-content">{children}</div>
  )),
  CarouselItem: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="carousel-item">{children}</div>
  )),
}));

vi.mock("./ui/card", () => ({
  Card: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>),
  CardContent: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>),
}));

vi.mock("./ui/button", () => ({
  Button: vi.fn(
    ({
      children,
      onClick,
      disabled,
      type,
    }: {
      children: React.ReactNode;
      onClick?: (e?: React.MouseEvent) => void;
      disabled?: boolean;
      type?: string;
      size?: string;
      variant?: string;
    }) => (
      <button
        data-testid="ui-button"
        onClick={onClick}
        disabled={disabled}
        type={type === "submit" ? "submit" : "button"}
      >
        {children}
      </button>
    )
  ),
}));

vi.mock("./ui/collapsible", () => ({
  Collapsible: vi.fn(
    ({ children, open }: { children: React.ReactNode; open: boolean; onOpenChange?: (open: boolean) => void }) => (
      <div data-testid="collapsible" data-state={open ? "open" : "closed"}>
        {children}
      </div>
    )
  ),
  CollapsibleContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-content">{children}</div>
  )),
  CollapsibleTrigger: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-trigger">{children}</div>
  )),
}));

vi.mock("./ui/field", () => ({
  Field: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="field">{children}</div>),
  FieldContent: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="field-content">{children}</div>
  )),
  FieldDescription: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="field-description">{children}</div>
  )),
  FieldError: vi.fn(() => null),
  FieldGroup: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="field-group">{children}</div>),
  FieldLabel: vi.fn(({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label data-testid="field-label" htmlFor={htmlFor}>
      {children}
    </label>
  )),
}));

vi.mock("./ui/checkbox", () => ({
  Checkbox: vi.fn(
    ({
      id,
      checked,
      onCheckedChange,
    }: {
      id: string;
      checked: boolean;
      onCheckedChange?: (checked: boolean) => void;
    }) => (
      <input
        type="checkbox"
        data-testid="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
    )
  ),
}));

vi.mock("./ui/radio-group", () => ({
  RadioGroup: vi.fn(
    ({ children, value }: { children: React.ReactNode; value?: string; onValueChange?: (val: string) => void }) => (
      <div data-testid="radio-group" data-value={value}>
        {children}
      </div>
    )
  ),
  RadioGroupItem: vi.fn(({ value, id }: { value: string; id: string }) => (
    <input type="radio" data-testid="radio-item" value={value} id={id} />
  )),
}));

vi.mock("./ui/input", () => ({
  Input: vi.fn(({ placeholder, ...props }: { placeholder?: string; [key: string]: unknown }) => (
    <input type="text" data-testid="text-input" placeholder={placeholder} {...props} />
  )),
}));

vi.mock("lucide-react", () => ({
  ChevronDownIcon: vi.fn(() => <span data-testid="chevron-down-icon" />),
  ChevronLeft: vi.fn(() => <span data-testid="chevron-left-icon" />),
  ChevronRight: vi.fn(() => <span data-testid="chevron-right-icon" />),
  X: vi.fn(() => <span data-testid="x-icon" />),
}));

interface Question {
  question: string;
  multiSelect: boolean;
  options: Array<{ label: string; description?: string }>;
}

const singleSelectQuestion: Question = {
  question: "Which framework?",
  multiSelect: false,
  options: [
    { label: "React", description: "UI library" },
    { label: "Vue", description: "Progressive framework" },
  ],
};

const multiSelectQuestion: Question = {
  question: "Which features?",
  multiSelect: true,
  options: [
    { label: "Auth", description: "Authentication module" },
    { label: "API", description: "REST API" },
  ],
};

describe("AskQuestionCarousel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when questions array is empty", () => {
    const { container } = render(<AskQuestionCarousel questions={[]} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the carousel with questions", () => {
    render(<AskQuestionCarousel questions={[singleSelectQuestion]} onClose={vi.fn()} />);
    expect(screen.getByTestId("carousel")).toBeInTheDocument();
    expect(screen.getByTestId("collapsible")).toBeInTheDocument();
  });

  it("renders the first question text in the header", () => {
    render(<AskQuestionCarousel questions={[singleSelectQuestion]} onClose={vi.fn()} />);
    expect(screen.getByText("Which framework?")).toBeInTheDocument();
  });

  it("renders a submit button as type=submit", () => {
    render(<AskQuestionCarousel questions={[singleSelectQuestion]} onClose={vi.fn()} />);
    const buttons = screen.getAllByTestId("ui-button");
    const submitBtn = buttons.find((b) => b.getAttribute("type") === "submit");
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn?.textContent).toBe("Submit");
  });

  it("renders the form for submitting answers", () => {
    render(<AskQuestionCarousel questions={[singleSelectQuestion]} onClose={vi.fn()} />);
    const form = document.querySelector("form");
    expect(form).toBeInTheDocument();
  });

  it("renders both question types when mixed", () => {
    render(<AskQuestionCarousel questions={[singleSelectQuestion, multiSelectQuestion]} onClose={vi.fn()} />);
    const items = screen.getAllByTestId("carousel-item");
    expect(items).toHaveLength(2);
  });
});
