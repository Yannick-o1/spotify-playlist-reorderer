import { existsSync, readFileSync } from "node:fs";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";
const MAX_PAGE_SIZE = 100;
const COLOR_CACHE_PATH = "data/album-colors.json";

loadDotEnv();
const colorCache = loadColorCache();

const config = {
  clientId: readRequiredEnv("SPOTIFY_CLIENT_ID"),
  clientSecret: readRequiredEnv("SPOTIFY_CLIENT_SECRET"),
  refreshToken: readRequiredEnv("SPOTIFY_REFRESH_TOKEN"),
  playlistId: normalizePlaylistId(readRequiredEnv("SPOTIFY_PLAYLIST_ID")),
  orderMode: process.env.ORDER_MODE || "random-eccentric",
  orderSeed: process.env.ORDER_SEED || "",
};

const NON_COLOR_METHODS = new Map([
  ["second-letter-reverse-alpha", secondLetterReverseAlpha],
  ["duration-long-short", durationLongShort],
  ["title-length-long-short", titleLengthLongShort],
  ["least-popular-first", leastPopularFirst],
  ["popularity-low-high", popularityLowHigh],
  ["release-date-old-new", releaseDateOldNew],
  ["release-date-new-old", releaseDateNewOld],
  ["decade-round-robin", decadeRoundRobin],
  ["vowel-density", vowelDensity],
  ["fewest-vowels-first", fewestVowelsFirst],
  ["word-count-wave", wordCountWave],
  ["punctuation-heavy-first", punctuationHeavyFirst],
  ["explicit-centerpiece", explicitCenterpiece],
  ["artist-count-long-short", artistCountLongShort],
  ["artist-last-letter", artistLastLetter],
  ["album-title-length", albumTitleLength],
  ["album-release-precision", albumReleasePrecision],
  ["duration-modulo-minute", durationModuloMinute],
  ["added-day-of-week", addedDayOfWeek],
  ["spotify-id-lottery", spotifyIdLottery],
]);

const COLOR_METHODS = new Map([
  ["color-rainbow", colorRainbow],
  ["color-reverse-rainbow", colorReverseRainbow],
  ["color-dark-to-light", colorDarkToLight],
  ["color-light-to-dark", colorLightToDark],
  ["color-muted-to-vivid", colorMutedToVivid],
  ["color-vivid-to-muted", colorVividToMuted],
  ["color-warm-to-cool", colorWarmToCool],
  ["color-cool-to-warm", colorCoolToWarm],
  ["color-contrast-wave", colorContrastWave],
  ["color-complement-hop", colorComplementHop],
]);

const ECCENTRIC_METHODS = new Map([
  ...NON_COLOR_METHODS,
  ...COLOR_METHODS,
]);

const ORDER_MODES = new Map([
  ["random-eccentric", randomEccentricOrder],
  ["random", randomOrder],
  ...ECCENTRIC_METHODS,
]);

async function main() {
  const accessToken = await refreshAccessToken(config);
  const items = await getPlaylistTracks(accessToken, config.playlistId);

  if (items.length === 0) {
    console.log("Playlist is empty; nothing to reorder.");
    return;
  }

  const plan = buildOrderPlan(config.orderMode, items, config.orderSeed);
  const reordered = plan.items;
  const before = items.map((item) => item.uri).join("\n");
  const after = reordered.map((item) => item.uri).join("\n");

  if (before === after) {
    console.log(`Playlist already matches "${plan.name}" order; no update needed.`);
    return;
  }

  await replacePlaylistOrder(
    accessToken,
    config.playlistId,
    reordered.map((item) => item.uri),
    items.map((item) => item.uri),
  );
  console.log(`Reordered ${reordered.length} tracks with "${plan.name}".`);
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

async function getPlaylistTracks(accessToken, playlistId) {
  const items = [];
  let nextUrl =
    `${API_BASE_URL}/playlists/${playlistId}/items?limit=${MAX_PAGE_SIZE}` +
    "&fields=next,items(added_at,item(uri,id,name,duration_ms,explicit,popularity,artists(name),album(id,name,release_date,release_date_precision,images(url,width,height))),track(uri,id,name,duration_ms,explicit,popularity,artists(name),album(id,name,release_date,release_date_precision,images(url,width,height))))";

  while (nextUrl) {
    const response = await spotifyFetch(accessToken, nextUrl);
    const page = await parseJsonResponse(response);

    for (const item of page.items || []) {
      const track = item.track || item.item;
      if (!track?.uri || track.uri.startsWith("spotify:local:")) {
        continue;
      }

      items.push({
        addedAt: item.added_at || "",
        uri: track.uri,
        id: track.id || "",
        name: track.name || "",
        durationMs: track.duration_ms || 0,
        explicit: Boolean(track.explicit),
        popularity: track.popularity ?? 0,
        artists: track.artists || [],
        album: track.album || {},
        albumId: track.album?.id || "",
        coverUrl: bestAlbumImage(track.album?.images)?.url || "",
        color: colorCache[track.album?.id || ""] || null,
        releaseDatePrecision: track.album?.release_date_precision || "",
      });
    }

    nextUrl = page.next;
  }

  return items;
}

async function replacePlaylistOrder(accessToken, playlistId, targetUris) {
  const currentUris = await getPlaylistTrackUris(accessToken, playlistId);
  if (currentUris.length !== targetUris.length) {
    throw new Error(`Refusing to reorder because playlist size changed from ${targetUris.length} to ${currentUris.length}.`);
  }

  let moveCount = 0;
  for (let targetIndex = 0; targetIndex < targetUris.length; targetIndex += 1) {
    if (currentUris[targetIndex] === targetUris[targetIndex]) continue;

    const currentIndex = currentUris.indexOf(targetUris[targetIndex], targetIndex + 1);
    if (currentIndex === -1) {
      throw new Error("Refusing to reorder because the target track set no longer matches the playlist.");
    }

    const moveResponse = await spotifyFetch(accessToken, `${API_BASE_URL}/playlists/${playlistId}/items`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        range_start: currentIndex,
        insert_before: targetIndex,
        range_length: 1,
      }),
    });
    await parseJsonResponse(moveResponse);

    const [movedUri] = currentUris.splice(currentIndex, 1);
    currentUris.splice(targetIndex, 0, movedUri);
    moveCount += 1;

    if (moveCount % 50 === 0) {
      console.log(`Moved ${moveCount} tracks...`);
    }

    await sleep(100);
  }
}

async function getPlaylistTrackUris(accessToken, playlistId) {
  const uris = [];
  let nextUrl =
    `${API_BASE_URL}/playlists/${playlistId}/items?limit=${MAX_PAGE_SIZE}` +
    "&fields=next,items(item(uri),track(uri))";

  while (nextUrl) {
    const response = await spotifyFetch(accessToken, nextUrl);
    const page = await parseJsonResponse(response);
    for (const item of page.items || []) {
      const track = item.track || item.item;
      if (track?.uri && !track.uri.startsWith("spotify:local:")) {
        uris.push(track.uri);
      }
    }
    nextUrl = page.next;
  }

  return uris;
}

async function spotifyFetch(accessToken, url, options = {}, attempt = 0) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get("retry-after") || 1);
    await sleep(retryAfterSeconds * 1000);
    return spotifyFetch(accessToken, url, options, attempt + 1);
  }

  if ([500, 502, 503, 504].includes(response.status) && attempt < 5) {
    await sleep(1000 * 2 ** attempt);
    return spotifyFetch(accessToken, url, options, attempt + 1);
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

function randomOrder(items, seed) {
  const random = seed ? seededRandom(seed) : Math.random;
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function randomEccentricOrder(items, seed) {
  const random = seed ? seededRandom(seed) : Math.random;
  return applyMethodChain(items, selectRandomMethodNames(random), random);
}

function buildOrderPlan(mode, items, seed) {
  if (mode === "random-eccentric") {
    const random = seed ? seededRandom(seed) : Math.random;
    const selectedNames = selectRandomMethodNames(random);

    return {
      name: `random-eccentric(${selectedNames.join(" + ")})`,
      items: applyMethodChain(items, selectedNames, random),
    };
  }

  const comboMatch = mode.match(/^combo:(.+)$/);
  if (comboMatch) {
    const selectedNames = comboMatch[1].split(",").map((name) => name.trim()).filter(Boolean);
    if (selectedNames.length === 0 || selectedNames.length > 3) {
      throw new Error("Combo modes must name 1 to 3 methods, for example combo:vowel-density,least-popular-first.");
    }
    validateMethodNames(selectedNames);
    return {
      name: `combo(${selectedNames.join(" + ")})`,
      items: applyMethodChain(items, selectedNames, seed ? seededRandom(seed) : Math.random),
    };
  }

  const orderer = ORDER_MODES.get(mode);
  if (!orderer) {
    throw new Error(
      `Unknown ORDER_MODE "${mode}". Valid modes: random-eccentric, random, combo:method-a,method-b, or ${[...ECCENTRIC_METHODS.keys()].join(", ")}`,
    );
  }

  return { name: mode, items: orderer(items, seed) };
}

function selectRandomMethodNames(random) {
  const selectedNames = [];
  const includeColor = COLOR_METHODS.size > 0 && random() < 1 / 3;
  const methodCount = 1 + Math.floor(random() * 3);

  if (includeColor) {
    selectedNames.push(randomFrom([...COLOR_METHODS.keys()], random));
  }

  const pool = [...NON_COLOR_METHODS.keys()];
  while (selectedNames.length < methodCount) {
    const candidate = randomFrom(pool, random);
    if (!selectedNames.includes(candidate)) selectedNames.push(candidate);
  }

  return selectedNames;
}

function applyMethodChain(items, selectedNames, random) {
  validateMethodNames(selectedNames);
  return selectedNames.reduce((orderedItems, methodName, index) => {
    const seed = `${random()}-${index}-${methodName}`;
    return ECCENTRIC_METHODS.get(methodName)(orderedItems, seed);
  }, items);
}

function validateMethodNames(selectedNames) {
  for (const methodName of selectedNames) {
    if (!ECCENTRIC_METHODS.has(methodName)) {
      throw new Error(`Unknown eccentric method "${methodName}". Valid methods: ${[...ECCENTRIC_METHODS.keys()].join(", ")}`);
    }
  }
}

function secondLetterReverseAlpha(items) {
  return stableSort(items, (a, b) => {
    const secondLetter = compareText(letterAt(b.name, 1), letterAt(a.name, 1));
    return secondLetter || compareText(b.name, a.name);
  });
}

function durationLongShort(items) {
  return alternateFromEnds(stableSort(items, (a, b) => b.durationMs - a.durationMs || compareName(a, b)));
}

function titleLengthLongShort(items) {
  return alternateFromEnds(stableSort(items, (a, b) => b.name.length - a.name.length || compareName(a, b)));
}

function leastPopularFirst(items) {
  return stableSort(items, (a, b) => a.popularity - b.popularity || compareName(a, b));
}

function popularityLowHigh(items) {
  return alternateFromEnds(leastPopularFirst(items));
}

function releaseDateOldNew(items) {
  return stableSort(items, (a, b) => compareReleaseDate(a, b) || compareName(a, b));
}

function releaseDateNewOld(items) {
  return stableSort(items, (a, b) => compareReleaseDate(b, a) || compareName(a, b));
}

function decadeRoundRobin(items, seed) {
  return roundRobinBuckets(items, (item) => {
    const year = releaseYear(item);
    return year === null ? "unknown" : String(Math.floor(year / 10) * 10);
  }, seed);
}

function vowelDensity(items) {
  return stableSort(items, (a, b) => density(b.name, /[aeiou]/gi) - density(a.name, /[aeiou]/gi) || compareName(a, b));
}

function fewestVowelsFirst(items) {
  return stableSort(items, (a, b) => countMatches(a.name, /[aeiou]/gi) - countMatches(b.name, /[aeiou]/gi) || compareName(a, b));
}

function wordCountWave(items) {
  return alternateFromEnds(stableSort(items, (a, b) => wordCount(a.name) - wordCount(b.name) || compareName(a, b)));
}

function punctuationHeavyFirst(items) {
  return stableSort(items, (a, b) => countMatches(b.name, /[^\p{L}\p{N}\s]/gu) - countMatches(a.name, /[^\p{L}\p{N}\s]/gu) || compareName(a, b));
}

function explicitCenterpiece(items) {
  const clean = stableSort(items.filter((item) => !item.explicit), compareName);
  const explicit = stableSort(items.filter((item) => item.explicit), compareName);
  const midpoint = Math.ceil(clean.length / 2);
  return [...clean.slice(0, midpoint), ...explicit, ...clean.slice(midpoint)];
}

function artistCountLongShort(items) {
  return alternateFromEnds(stableSort(items, (a, b) => b.artists.length - a.artists.length || compareName(a, b)));
}

function artistLastLetter(items) {
  return stableSort(items, (a, b) => compareText(lastLetter(primaryArtist(a)), lastLetter(primaryArtist(b))) || compareText(primaryArtist(a), primaryArtist(b)) || compareName(a, b));
}

function albumTitleLength(items) {
  return stableSort(items, (a, b) => String(a.album.name || "").length - String(b.album.name || "").length || a.name.length - b.name.length || compareName(a, b));
}

function albumReleasePrecision(items) {
  const rank = { day: 0, month: 1, year: 2 };
  return stableSort(items, (a, b) => (rank[a.releaseDatePrecision] ?? 3) - (rank[b.releaseDatePrecision] ?? 3) || compareReleaseDate(a, b) || compareName(a, b));
}

function durationModuloMinute(items) {
  return stableSort(items, (a, b) => (a.durationMs % 60000) - (b.durationMs % 60000) || a.durationMs - b.durationMs || compareName(a, b));
}

function addedDayOfWeek(items) {
  return stableSort(items, (a, b) => addedWeekday(a) - addedWeekday(b) || compareText(a.addedAt, b.addedAt) || compareName(a, b));
}

function spotifyIdLottery(items, seed) {
  const salt = seed || "";
  return stableSort(items, (a, b) => hashString(`${a.id}${salt}`) - hashString(`${b.id}${salt}`) || compareName(a, b));
}

function colorRainbow(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "dominantHue", "asc") || compareMetric(a, b, "brightness", "asc") || compareName(a, b));
}

function colorReverseRainbow(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "dominantHue", "desc") || compareMetric(a, b, "brightness", "desc") || compareName(a, b));
}

function colorDarkToLight(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "brightness", "asc") || compareMetric(a, b, "saturation", "desc") || compareName(a, b));
}

function colorLightToDark(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "brightness", "desc") || compareMetric(a, b, "saturation", "desc") || compareName(a, b));
}

function colorMutedToVivid(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "colorfulness", "asc") || compareMetric(a, b, "saturation", "asc") || compareName(a, b));
}

function colorVividToMuted(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "colorfulness", "desc") || compareMetric(a, b, "saturation", "desc") || compareName(a, b));
}

function colorWarmToCool(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "warmth", "desc") || compareMetric(a, b, "dominantHue", "asc") || compareName(a, b));
}

function colorCoolToWarm(items) {
  return colorSort(items, (a, b) => compareMetric(a, b, "warmth", "asc") || compareMetric(a, b, "dominantHue", "desc") || compareName(a, b));
}

function colorContrastWave(items) {
  return alternateFromEnds(colorSort(items, (a, b) => compareMetric(b, a, "contrast", "asc") || compareName(a, b)));
}

function colorComplementHop(items) {
  return colorSort(items, (a, b) => compareNumber(complementBucket(a), complementBucket(b)) || compareMetric(a, b, "brightness", "asc") || compareName(a, b));
}

function compareReleaseDate(a, b) {
  return normalizeReleaseDate(a.album.release_date).localeCompare(normalizeReleaseDate(b.album.release_date));
}

function releaseYear(item) {
  const match = String(item.album.release_date || "").match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function normalizeReleaseDate(releaseDate = "") {
  if (/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return releaseDate;
  if (/^\d{4}-\d{2}$/.test(releaseDate)) return `${releaseDate}-01`;
  if (/^\d{4}$/.test(releaseDate)) return `${releaseDate}-01-01`;
  return "0000-01-01";
}

function compareName(a, b) {
  return compareText(a.name, b.name);
}

function compareText(a = "", b = "") {
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

function primaryArtist(item) {
  return item.artists[0]?.name || "";
}

function alternateFromEnds(items) {
  const result = [];
  let left = 0;
  let right = items.length - 1;

  while (left <= right) {
    if (left <= right) result.push(items[left++]);
    if (left <= right) result.push(items[right--]);
  }

  return result;
}

function roundRobinBuckets(items, getBucketName, seed) {
  const buckets = new Map();

  for (const item of items) {
    const bucketName = getBucketName(item);
    const bucket = buckets.get(bucketName) || [];
    bucket.push(item);
    buckets.set(bucketName, bucket);
  }

  const sortedBuckets = [...buckets.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([bucketName, bucket]) => randomOrder(bucket, `${seed || ""}-${bucketName}`));
  const result = [];

  while (result.length < items.length) {
    for (const bucket of sortedBuckets) {
      if (bucket.length > 0) result.push(bucket.shift());
    }
  }

  return result;
}

function letterAt(value, index) {
  return [...String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")][index] || "";
}

function lastLetter(value) {
  const letters = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return letters.at(-1) || "";
}

function countMatches(value, pattern) {
  return String(value || "").match(pattern)?.length || 0;
}

function density(value, pattern) {
  const compact = String(value || "").replace(/\s/g, "");
  if (!compact) return 0;
  return countMatches(compact, pattern) / compact.length;
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function addedWeekday(item) {
  const date = new Date(item.addedAt);
  return Number.isNaN(date.getTime()) ? 7 : date.getUTCDay();
}

function colorSort(items, compare) {
  const withColor = items.filter((item) => item.color);
  const withoutColor = items.filter((item) => !item.color);
  return [...stableSort(withColor, compare), ...stableSort(withoutColor, compareName)];
}

function compareMetric(a, b, metric, direction = "asc") {
  const left = Number(a.color?.[metric] ?? 0);
  const right = Number(b.color?.[metric] ?? 0);
  return direction === "desc" ? compareNumber(right, left) : compareNumber(left, right);
}

function compareNumber(a, b) {
  return a - b;
}

function complementBucket(item) {
  const hue = Number(item.color?.dominantHue ?? 0);
  return Math.round(((hue + 180) % 360) / 30);
}

function stableSort(items, compare) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

function seededRandom(seed) {
  let hash = 2166136261;

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizePlaylistId(value) {
  const trimmed = value.trim();
  const urlMatch = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
  const uriMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]+)/);
  return urlMatch?.[1] || uriMatch?.[1] || trimmed;
}

function bestAlbumImage(images = []) {
  return [...images].sort((a, b) => {
    const aSize = Number(a.width || a.height || 0);
    const bSize = Number(b.width || b.height || 0);
    return bSize - aSize;
  })[0] || null;
}

function randomFrom(values, random) {
  return values[Math.floor(random() * values.length)];
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

function loadColorCache() {
  if (!existsSync(COLOR_CACHE_PATH)) return {};

  try {
    return JSON.parse(readFileSync(COLOR_CACHE_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${COLOR_CACHE_PATH}: ${error.message}`);
  }
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
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
