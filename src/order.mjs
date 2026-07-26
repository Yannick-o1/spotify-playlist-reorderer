import { randomInt as cryptoRandomInt } from "node:crypto";

export function buildOrderPlan(items, pinnedUris = [], randomInt = cryptoRandomInt) {
  const { pinnedItems, remainingItems } = extractPinnedItems(items, pinnedUris);

  if (randomInt(2) === 0) {
    return {
      name: "reverse-chronological",
      items: [...pinnedItems, ...reverseChronologicalOrder(remainingItems)],
    };
  }

  return {
    name: "random",
    items: [...pinnedItems, ...randomOrder(remainingItems, randomInt)],
  };
}

export function reverseChronologicalOrder(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const dateDifference = parseAddedAt(right.item.addedAt) - parseAddedAt(left.item.addedAt);
      return dateDifference || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function randomOrder(items, randomInt = cryptoRandomInt) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function extractPinnedItems(items, pinnedUris) {
  const remainingItems = [...items];
  const pinnedItems = pinnedUris.map((uri) => {
    const index = remainingItems.findIndex((item) => item.uri === uri);

    if (index === -1) {
      throw new Error(`Pinned Spotify item is missing from the playlist: ${uri}`);
    }

    return remainingItems.splice(index, 1)[0];
  });

  return { pinnedItems, remainingItems };
}

function parseAddedAt(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}
