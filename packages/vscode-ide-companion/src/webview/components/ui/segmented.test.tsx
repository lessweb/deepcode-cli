import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Segmented, SegmentedItem } from "@/webview/components/ui/segmented";
import { useState } from "react";

function SegmentedControlled() {
  const [value, setValue] = useState("option1");
  return (
    <Segmented value={value} onValueChange={setValue}>
      <SegmentedItem value="option1">Option 1</SegmentedItem>
      <SegmentedItem value="option2">Option 2</SegmentedItem>
      <SegmentedItem value="option3">Option 3</SegmentedItem>
    </Segmented>
  );
}

const getRadios = () => screen.getAllByRole("radio");
const getRadiogroup = () => screen.getByRole("radiogroup");

describe("Segmented", () => {
  describe("Rendering", () => {
    it("renders all items", () => {
      render(<SegmentedControlled />);
      const items = getRadios();
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent("Option 1");
      expect(items[1]).toHaveTextContent("Option 2");
      expect(items[2]).toHaveTextContent("Option 3");
    });

    it("renders the root as radiogroup", () => {
      render(<SegmentedControlled />);
      expect(getRadiogroup()).toBeInTheDocument();
      expect(getRadiogroup()).toHaveAttribute("data-slot", "segmented");
    });

    it("default checked item has checked state", () => {
      render(<SegmentedControlled />);
      const items = getRadios();
      expect(items[0]).toHaveAttribute("data-state", "checked");
      expect(items[1]).toHaveAttribute("data-state", "unchecked");
      expect(items[2]).toHaveAttribute("data-state", "unchecked");
    });
  });

  describe("Interaction", () => {
    it("changes selected item on click", () => {
      render(<SegmentedControlled />);
      const items = getRadios();

      fireEvent.click(items[2]);
      expect(items[0]).toHaveAttribute("data-state", "unchecked");
      expect(items[2]).toHaveAttribute("data-state", "checked");
    });

    it("calls onValueChange with the selected value", () => {
      const handleChange = vi.fn();
      render(
        <Segmented value="a" onValueChange={handleChange}>
          <SegmentedItem value="a">A</SegmentedItem>
          <SegmentedItem value="b">B</SegmentedItem>
        </Segmented>
      );
      fireEvent.click(getRadios()[1]);
      expect(handleChange).toHaveBeenCalledWith("b");
    });
  });

  describe("Size variants", () => {
    it("applies default size", () => {
      render(<SegmentedControlled />);
      expect(getRadiogroup().className).toContain("h-9");
    });

    it("applies sm size", () => {
      render(
        <Segmented value="a" size="sm">
          <SegmentedItem value="a">A</SegmentedItem>
        </Segmented>
      );
      expect(getRadiogroup().className).toContain("h-8");
    });

    it("applies lg size", () => {
      render(
        <Segmented value="a" size="lg">
          <SegmentedItem value="a">A</SegmentedItem>
        </Segmented>
      );
      expect(getRadiogroup().className).toContain("h-10");
    });
  });

  describe("Disabled state", () => {
    it("renders disabled item", () => {
      render(
        <Segmented value="a">
          <SegmentedItem value="a">A</SegmentedItem>
          <SegmentedItem value="b" disabled>
            B
          </SegmentedItem>
        </Segmented>
      );
      const items = getRadios();
      expect(items[1]).toBeDisabled();
    });
  });

  describe("With icons", () => {
    it("renders items with icon content", () => {
      render(
        <Segmented value="list">
          <SegmentedItem value="list">
            <span data-testid="list-icon" />
            List
          </SegmentedItem>
          <SegmentedItem value="grid">
            <span data-testid="grid-icon" />
            Grid
          </SegmentedItem>
        </Segmented>
      );
      expect(screen.getByTestId("list-icon")).toBeInTheDocument();
      expect(screen.getByTestId("grid-icon")).toBeInTheDocument();
    });
  });
});
