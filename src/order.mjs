import { createHash, randomInt as cryptoRandomInt } from "node:crypto";

export function buildOrderPlan(items, pinnedUris = [], randomInt = cryptoRandomInt) {
  const { pinnedItems, remainingItems } = extractPinnedItems(items, pinnedUris);
  const canonicalItems = [...remainingItems].sort((left, right) =>
    String(left.key).localeCompare(String(right.key)),
  );

  if (randomInt(2) === 0) {
    return {
      name: "reverse-chronological",
      items: [...pinnedItems, ...reverseChronologicalOrder(canonicalItems)],
    };
  }

  return {
    name: "random",
    items: [...pinnedItems, ...randomOrder(canonicalItems, randomInt)],
  };
}

export function reverseChronologicalOrder(items) {
  return [...items].sort((left, right) => {
    const dateDifference = parseAddedAt(right.addedAt) - parseAddedAt(left.addedAt);
    return dateDifference || String(left.key).localeCompare(String(right.key));
  });
}

export function randomOrder(items, randomInt = cryptoRandomInt) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function createSeededRandomInt(seed) {
  let counter = 0;

  return (upperBound) => {
    if (!Number.isSafeInteger(upperBound) || upperBound < 1) {
      throw new Error("Random upper bound must be a positive safe integer.");
    }

    const range = 0x100000000;
    const unbiasedLimit = range - (range % upperBound);

    while (true) {
      const digest = createHash("sha256")
        .update(`${seed}:${counter}`)
        .digest();
      counter += 1;
      const value = digest.readUInt32BE(0);

      if (value < unbiasedLimit) {
        return value % upperBound;
      }
    }
  };
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
