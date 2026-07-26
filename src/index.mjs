import { existsSync, readFileSync } from "node:fs";
import { buildOrderPlan, createSeededRandomInt } from "./order.mjs";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";
const MAX_PAGE_SIZE = 50;
const MIN_WRITE_INTERVAL_MS = 350;
const MAX_MOVES_PER_RUN = 600;
const MAX_RETRY_AFTER_SECONDS = 300;
const ORDER_CYCLE_EPOCH_DAY = 20660; // 2026-07-26 UTC
const PINNED_ITEM_URIS = [
  "spotify:track:2USTVgd20XRLMAhiYNklN8", // Livin' Loose — George Clanton
  "spotify:track:5ju3Mgd15jLIAmZLwLPlwY", // Know by Heart — The American Analog Set
  "spotify:track:2073QOEC8rBtSyTsRyaWiP", // I Can Change — LCD Soundsystem
  "spotify:track:2J4lJMCuFCA0zlwFOjePD5", // Dayvan Cowboy — Boards of Canada
];

loadDotEnv();

const config = {
  clientId: readRequiredEnv("SPOTIFY_CLIENT_ID"),
  clientSecret: readRequiredEnv("SPOTIFY_CLIENT_SECRET"),
  refreshToken: readRequiredEnv("SPOTIFY_REFRESH_TOKEN"),
  playlistId: normalizePlaylistId(readRequiredEnv("SPOTIFY_PLAYLIST_ID")),
};

async function main() {
  const accessToken = await refreshAccessToken(config);
  const snapshotBeforeRead = await getPlaylistSnapshotId(accessToken, config.playlistId);
  const items = await getPlaylistItems(accessToken, config.playlistId);
  const snapshotAfterRead = await getPlaylistSnapshotId(accessToken, config.playlistId);

  if (snapshotBeforeRead !== snapshotAfterRead) {
    throw new Error("The playlist changed while it was being read. Run the shuffler again so it can start from a consistent snapshot.");
  }

  if (items.length === 0) {
    console.log("Playlist is empty; nothing to reorder.");
    return;
  }

  const cycleNumber = getOrderCycleNumber();
  const randomInt = createSeededRandomInt(`stuff-v1:${cycleNumber}`);
  const plan = buildOrderPlan(items, PINNED_ITEM_URIS, randomInt);
  const currentKeys = items.map((item) => item.key);
  const targetKeys = plan.items.map((item) => item.key);

  console.log(`Selected ${plan.name} ordering for three-day cycle ${cycleNumber}.`);

  if (currentKeys.every((key, index) => key === targetKeys[index])) {
    console.log("The playlist already matches the selected order; no update needed.");
    return;
  }

  const result = await applyPlaylistOrder(
    accessToken,
    config.playlistId,
    currentKeys,
    targetKeys,
    snapshotAfterRead,
  );

  if (result.complete) {
    console.log(`Reordered ${items.length} items with ${result.moveCount} move${result.moveCount === 1 ? "" : "s"}.`);
  } else {
    console.log(`Paused safely after ${result.moveCount} moves; the next daily run will continue cycle ${cycleNumber}.`);
  }
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const body = await parseJsonResponse(response);
  return body.access_token;
}

async function getPlaylistSnapshotId(accessToken, playlistId) {
  const response = await spotifyFetch(
    accessToken,
    `${API_BASE_URL}/playlists/${playlistId}?fields=snapshot_id`,
  );
  const playlist = await parseJsonResponse(response);

  if (!playlist.snapshot_id) {
    throw new Error("Spotify did not return a playlist snapshot ID.");
  }

  return playlist.snapshot_id;
}

async function getPlaylistItems(accessToken, playlistId) {
  const items = [];
  const occurrenceCounts = new Map();
  let nextUrl =
    `${API_BASE_URL}/playlists/${playlistId}/items?limit=${MAX_PAGE_SIZE}` +
    "&fields=next,items(added_at,item(uri),track(uri))";

  while (nextUrl) {
    const response = await spotifyFetch(accessToken, nextUrl);
    const page = await parseJsonResponse(response);

    for (const playlistItem of page.items || []) {
      const item = playlistItem.item || playlistItem.track;
      const uri = item?.uri || "";
      const addedAt = playlistItem.added_at || "";
      const identity = JSON.stringify([uri, addedAt]);
      const occurrence = occurrenceCounts.get(identity) || 0;
      occurrenceCounts.set(identity, occurrence + 1);

      items.push({
        key: `${identity}:${occurrence}`,
        uri,
        addedAt,
      });
    }

    nextUrl = page.next;
  }

  return items;
}

async function applyPlaylistOrder(accessToken, playlistId, currentKeys, targetKeys, initialSnapshotId) {
  let moveCount = 0;
  let snapshotId = initialSnapshotId;

  for (let targetIndex = 0; targetIndex < targetKeys.length; targetIndex += 1) {
    if (currentKeys[targetIndex] === targetKeys[targetIndex]) continue;

    const currentIndex = currentKeys.indexOf(targetKeys[targetIndex], targetIndex + 1);
    if (currentIndex === -1) {
      throw new Error("The target order no longer matches the playlist items.");
    }

    const response = await spotifyFetch(
      accessToken,
      `${API_BASE_URL}/playlists/${playlistId}/items`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          range_start: currentIndex,
          insert_before: targetIndex,
          range_length: 1,
          snapshot_id: snapshotId,
        }),
      },
    );
    const body = await parseJsonResponse(response);
    snapshotId = body.snapshot_id || snapshotId;

    const [movedKey] = currentKeys.splice(currentIndex, 1);
    currentKeys.splice(targetIndex, 0, movedKey);
    moveCount += 1;

    if (moveCount % 50 === 0) {
      console.log(`Moved ${moveCount} items...`);
    }

    if (moveCount >= MAX_MOVES_PER_RUN) {
      const complete = currentKeys.every((key, index) => key === targetKeys[index]);
      return { moveCount, complete };
    }

    await sleep(MIN_WRITE_INTERVAL_MS);
  }

  return { moveCount, complete: true };
}

async function spotifyFetch(accessToken, url, options = {}, serverErrorAttempt = 0) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 429) {
    const retryAfterSeconds = Math.max(1, Number(response.headers.get("retry-after")) || 1);

    if (retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) {
      throw new Error(`Spotify quota reached; retry after ${retryAfterSeconds} seconds. A later daily run will continue the same order.`);
    }

    console.log(`Spotify rate limit reached; retrying in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`);
    await sleep(retryAfterSeconds * 1000);
    return spotifyFetch(accessToken, url, options, serverErrorAttempt);
  }

  if ([500, 502, 503, 504].includes(response.status) && serverErrorAttempt < 5) {
    await sleep(1000 * 2 ** serverErrorAttempt);
    return spotifyFetch(accessToken, url, options, serverErrorAttempt + 1);
  }

  return response;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = body.error?.message || body.error_description || response.statusText;
    throw new Error(`Spotify request failed (${response.status}): ${message}`);
  }

  return body;
}

function normalizePlaylistId(value) {
  const trimmed = value.trim();
  const urlMatch = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
  const uriMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]+)/);
  return urlMatch?.[1] || uriMatch?.[1] || trimmed;
}

function getOrderCycleNumber() {
  const currentUtcDay = Math.floor(Date.now() / 86400000);
  return Math.floor((currentUtcDay - ORDER_CYCLE_EPOCH_DAY) / 3);
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (value.startsWith("your_") || value.endsWith("_or_url")) {
    throw new Error(`Environment variable ${name} still contains a placeholder value.`);
  }
  return value;
}

function loadDotEnv() {
  if (!existsSync(".env")) return;

  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
