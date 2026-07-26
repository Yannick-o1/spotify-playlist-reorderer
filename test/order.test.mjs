import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderPlan,
  createSeededRandomInt,
  randomOrder,
  reverseChronologicalOrder,
} from "../src/order.mjs";

const ITEMS = [
  { key: "old", addedAt: "2024-01-01T00:00:00Z" },
  { key: "new", addedAt: "2026-01-01T00:00:00Z" },
  { key: "middle-a", addedAt: "2025-01-01T00:00:00Z" },
  { key: "middle-b", addedAt: "2025-01-01T00:00:00Z" },
  { key: "unknown", addedAt: "" },
];

test("reverse chronological order puts newest additions first and remains stable", () => {
  const ordered = reverseChronologicalOrder(ITEMS);

  assert.deepEqual(ordered.map((item) => item.key), [
    "new",
    "middle-a",
    "middle-b",
    "old",
    "unknown",
  ]);
  assert.deepEqual(ITEMS.map((item) => item.key), [
    "old",
    "new",
    "middle-a",
    "middle-b",
    "unknown",
  ]);
});

test("buildOrderPlan selects reverse chronological ordering for choice zero", () => {
  const plan = buildOrderPlan(ITEMS, [], (upperBound) => {
    assert.equal(upperBound, 2);
    return 0;
  });

  assert.equal(plan.name, "reverse-chronological");
  assert.equal(plan.items[0].key, "new");
});

test("buildOrderPlan selects a Fisher-Yates random shuffle for choice one", () => {
  const choices = [1, 0, 1, 0, 0];
  const upperBounds = [];
  const plan = buildOrderPlan(ITEMS, [], (upperBound) => {
    upperBounds.push(upperBound);
    return choices.shift();
  });

  assert.equal(plan.name, "random");
  assert.deepEqual(upperBounds, [2, 5, 4, 3, 2]);
  assert.deepEqual(plan.items.map((item) => item.key).sort(), ITEMS.map((item) => item.key).sort());
  assert.notDeepEqual(plan.items.map((item) => item.key), ITEMS.map((item) => item.key));
});

test("randomOrder does not mutate its input", () => {
  const original = [...ITEMS];
  randomOrder(ITEMS, () => 0);
  assert.deepEqual(ITEMS, original);
});

test("buildOrderPlan keeps pinned items first in the requested order", () => {
  const items = [
    { key: "other-a", uri: "spotify:track:other-a", addedAt: "2025-01-01T00:00:00Z" },
    { key: "pin-b", uri: "spotify:track:pin-b", addedAt: "2024-01-01T00:00:00Z" },
    { key: "other-b", uri: "spotify:track:other-b", addedAt: "2026-01-01T00:00:00Z" },
    { key: "pin-a", uri: "spotify:track:pin-a", addedAt: "2023-01-01T00:00:00Z" },
  ];
  const plan = buildOrderPlan(
    items,
    ["spotify:track:pin-a", "spotify:track:pin-b"],
    () => 0,
  );

  assert.deepEqual(plan.items.map((item) => item.key), [
    "pin-a",
    "pin-b",
    "other-b",
    "other-a",
  ]);
});

test("buildOrderPlan fails safely when a pinned item is absent", () => {
  assert.throws(
    () => buildOrderPlan(ITEMS, ["spotify:track:missing"], () => 0),
    /Pinned Spotify item is missing/,
  );
});

test("seeded random choices are deterministic and stay within bounds", () => {
  const first = createSeededRandomInt("cycle-42");
  const second = createSeededRandomInt("cycle-42");
  const firstSequence = [first(2), first(7), first(1400), first(2)];
  const secondSequence = [second(2), second(7), second(1400), second(2)];

  assert.deepEqual(firstSequence, secondSequence);
  assert.ok(firstSequence.every((value, index) => value >= 0 && value < [2, 7, 1400, 2][index]));
});

test("the active cycle continues the reverse-chronological target already in progress", () => {
  assert.equal(createSeededRandomInt("stuff-v1:0")(2), 0);
});

test("the same cycle produces the same target from a partially reordered playlist", () => {
  const items = [
    { key: "c", uri: "spotify:track:c", addedAt: "2024-01-01T00:00:00Z" },
    { key: "a", uri: "spotify:track:a", addedAt: "2025-01-01T00:00:00Z" },
    { key: "d", uri: "spotify:track:d", addedAt: "2023-01-01T00:00:00Z" },
    { key: "b", uri: "spotify:track:b", addedAt: "2026-01-01T00:00:00Z" },
  ];
  const partiallyReordered = [items[1], items[3], items[0], items[2]];

  const firstPlan = buildOrderPlan(items, [], createSeededRandomInt("same-cycle"));
  const resumedPlan = buildOrderPlan(partiallyReordered, [], createSeededRandomInt("same-cycle"));

  assert.equal(firstPlan.name, resumedPlan.name);
  assert.deepEqual(
    firstPlan.items.map((item) => item.key),
    resumedPlan.items.map((item) => item.key),
  );
});
