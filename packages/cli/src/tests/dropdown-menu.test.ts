import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateVisibleStart } from "../ui/components/DropdownMenu";

test("calculateVisibleStart centers active item when possible", () => {
  // 10 items, max 5 visible, active index 4 (middle)
  // Should show items 2-6 (start at 2)
  const start = calculateVisibleStart(4, 10, 5);
  assert.equal(start, 2);
});

test("calculateVisibleStart handles active item at the beginning", () => {
  // 10 items, max 5 visible, active index 0
  // Should show items 0-4 (start at 0)
  const start = calculateVisibleStart(0, 10, 5);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles active item at the end", () => {
  // 10 items, max 5 visible, active index 9 (last)
  // Should show items 5-9 (start at 5)
  const start = calculateVisibleStart(9, 10, 5);
  assert.equal(start, 5);
});

test("calculateVisibleStart handles fewer items than maxVisible", () => {
  // 3 items, max 5 visible, active index 1
  // Should show all items (start at 0)
  const start = calculateVisibleStart(1, 3, 5);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles single item", () => {
  // 1 item, max 5 visible, active index 0
  // Should start at 0
  const start = calculateVisibleStart(0, 1, 5);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles empty list", () => {
  // 0 items, max 5 visible, active index 0
  // Should start at 0
  const start = calculateVisibleStart(0, 0, 5);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles activeIndex near start with odd maxVisible", () => {
  // 10 items, max 7 visible (odd), active index 2
  // floor((7-1)/2) = 3, so 2-3 = -1, clamped to 0
  const start = calculateVisibleStart(2, 10, 7);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles activeIndex near start with even maxVisible", () => {
  // 10 items, max 6 visible (even), active index 2
  // floor((6-1)/2) = 2, so 2-2 = 0
  const start = calculateVisibleStart(2, 10, 6);
  assert.equal(start, 0);
});

test("calculateVisibleStart keeps active item centered in middle range", () => {
  // 20 items, max 5 visible, active index 10
  // floor((5-1)/2) = 2, so 10-2 = 8
  const start = calculateVisibleStart(10, 20, 5);
  assert.equal(start, 8);
});

test("calculateVisibleStart handles activeIndex at exact boundary", () => {
  // 10 items, max 5 visible, active index 2 (boundary where centering starts)
  // floor((5-1)/2) = 2, so 2-2 = 0
  const start = calculateVisibleStart(2, 10, 5);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles activeIndex just after boundary", () => {
  // 10 items, max 5 visible, active index 3
  // floor((5-1)/2) = 2, so 3-2 = 1
  const start = calculateVisibleStart(3, 10, 5);
  assert.equal(start, 1);
});

test("calculateVisibleStart handles large maxVisible", () => {
  // 10 items, max 100 visible, active index 5
  // Should show all items (start at 0)
  const start = calculateVisibleStart(5, 10, 100);
  assert.equal(start, 0);
});

test("calculateVisibleStart handles activeIndex equal to totalItems", () => {
  // 10 items, max 5 visible, active index 10 (out of bounds)
  // floor((5-1)/2) = 2, so 10-2 = 8, clamped to 5 (10-5)
  const start = calculateVisibleStart(10, 10, 5);
  assert.equal(start, 5);
});

test("calculateVisibleStart with maxVisible of 1", () => {
  // 5 items, max 1 visible, active index 2
  // floor((1-1)/2) = 0, so 2-0 = 2, clamped to 4 (5-1)
  const start = calculateVisibleStart(2, 5, 1);
  assert.equal(start, 2);
});

test("calculateVisibleStart with maxVisible of 1 at end", () => {
  // 5 items, max 1 visible, active index 4 (last)
  // floor((1-1)/2) = 0, so 4-0 = 4, clamped to 4 (5-1)
  const start = calculateVisibleStart(4, 5, 1);
  assert.equal(start, 4);
});

test("calculateVisibleStart scrolling behavior - moving down", () => {
  // Simulate scrolling through a list
  // 10 items, max 5 visible

  // Start at index 0
  assert.equal(calculateVisibleStart(0, 10, 5), 0);

  // Move to index 2 (still centered)
  assert.equal(calculateVisibleStart(2, 10, 5), 0);

  // Move to index 5 (window should scroll)
  assert.equal(calculateVisibleStart(5, 10, 5), 3);

  // Move to index 8 (near end)
  assert.equal(calculateVisibleStart(8, 10, 5), 5);

  // Move to index 9 (at end)
  assert.equal(calculateVisibleStart(9, 10, 5), 5);
});

test("calculateVisibleStart scrolling behavior - moving up", () => {
  // Simulate scrolling up through a list
  // 10 items, max 5 visible

  // Start at index 9 (end)
  assert.equal(calculateVisibleStart(9, 10, 5), 5);

  // Move to index 6
  assert.equal(calculateVisibleStart(6, 10, 5), 4);

  // Move to index 4 (window should scroll up)
  assert.equal(calculateVisibleStart(4, 10, 5), 2);

  // Move to index 1 (near start)
  assert.equal(calculateVisibleStart(1, 10, 5), 0);

  // Move to index 0 (at start)
  assert.equal(calculateVisibleStart(0, 10, 5), 0);
});
