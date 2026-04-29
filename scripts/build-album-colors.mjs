import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";
const COLOR_CACHE_PATH = "data/album-colors.json";
const MAX_PAGE_SIZE = 100;
const IMAGE_SIZE = 64;

loadDotEnv();

const config = {
  clientId: readRequiredEnv("SPOTIFY_CLIENT_ID"),
  clientSecret: readRequiredEnv("SPOTIFY_CLIENT_SECRET"),
  refreshToken: readRequiredEnv("SPOTIFY_REFRESH_TOKEN"),
  playlistId: normalizePlaylistId(readRequiredEnv("SPOTIFY_PLAYLIST_ID")),
};

const accessToken = await refreshAccessToken(config);
const albums = await getPlaylistAlbums(accessToken, config.playlistId);
const cache = loadColorCache();
let analyzedCount = 0;
let skippedCount = 0;

for (const album of albums.values()) {
  if (!album.id || cache[album.id]) {
    skippedCount += 1;
    continue;
  }

  if (!album.coverUrl) {
    skippedCount += 1;
    continue;
  }

  try {
    cache[album.id] = await analyzeImage(album.coverUrl);
    analyzedCount += 1;
    if (analyzedCount % 25 === 0) {
      console.log(`Analyzed ${analyzedCount} album covers...`);
    }
  } catch (error) {
    console.warn(`Could not analyze "${album.name || album.id}": ${error.message}`);
  }
}

mkdirSync("data", { recursive: true });
writeFileSync(COLOR_CACHE_PATH, `${JSON.stringify(sortObject(cache), null, 2)}\n`);
console.log(`Color cache updated: ${analyzedCount} analyzed, ${skippedCount} already cached or skipped, ${Object.keys(cache).length} total.`);

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

async function getPlaylistAlbums(accessToken, playlistId) {
  const albums = new Map();
  let nextUrl =
    `${API_BASE_URL}/playlists/${playlistId}/items?limit=${MAX_PAGE_SIZE}` +
    "&fields=next,items(item(album(id,name,images(url,width,height))),track(album(id,name,images(url,width,height))))";

  while (nextUrl) {
    const response = await spotifyFetch(accessToken, nextUrl);
    const page = await parseJsonResponse(response);

    for (const item of page.items || []) {
      const track = item.track || item.item;
      const album = track?.album;
      if (!album?.id || albums.has(album.id)) continue;

      albums.set(album.id, {
        id: album.id,
        name: album.name || "",
        coverUrl: bestAlbumImage(album.images)?.url || "",
      });
    }

    nextUrl = page.next;
  }

  return albums;
}

async function analyzeImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image fetch failed (${response.status})`);
  }

  const input = Buffer.from(await response.arrayBuffer());
  const { data, info } = await sharp(input)
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return analyzePixels(data, info.channels);
}

function analyzePixels(data, channels) {
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let saturationTotal = 0;
  let brightnessTotal = 0;
  let warmthTotal = 0;
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let rgTotal = 0;
  let ybTotal = 0;
  let rgSquaredTotal = 0;
  let ybSquaredTotal = 0;
  const hueWeights = Array.from({ length: 36 }, () => 0);
  const pixelCount = data.length / channels;

  for (let index = 0; index < data.length; index += channels) {
    const red = data[index] / 255;
    const green = data[index + 1] / 255;
    const blue = data[index + 2] / 255;
    const { hue, saturation, brightness } = rgbToHsv(red, green, blue);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const warmth = warmHueScore(hue) * saturation * brightness;
    const rg = red - green;
    const yb = 0.5 * (red + green) - blue;

    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    saturationTotal += saturation;
    brightnessTotal += brightness;
    warmthTotal += warmth;
    luminanceTotal += luminance;
    luminanceSquaredTotal += luminance * luminance;
    rgTotal += rg;
    ybTotal += yb;
    rgSquaredTotal += rg * rg;
    ybSquaredTotal += yb * yb;
    hueWeights[Math.floor(hue / 10) % hueWeights.length] += saturation * brightness;
  }

  const averageRed = redTotal / pixelCount;
  const averageGreen = greenTotal / pixelCount;
  const averageBlue = blueTotal / pixelCount;
  const averageHsv = rgbToHsv(averageRed, averageGreen, averageBlue);
  const luminanceMean = luminanceTotal / pixelCount;
  const luminanceVariance = Math.max(0, luminanceSquaredTotal / pixelCount - luminanceMean * luminanceMean);
  const rgMean = rgTotal / pixelCount;
  const ybMean = ybTotal / pixelCount;
  const rgStd = Math.sqrt(Math.max(0, rgSquaredTotal / pixelCount - rgMean * rgMean));
  const ybStd = Math.sqrt(Math.max(0, ybSquaredTotal / pixelCount - ybMean * ybMean));
  const dominantHueBucket = hueWeights.indexOf(Math.max(...hueWeights));

  return roundValues({
    dominantHue: dominantHueBucket * 10 + 5,
    averageHue: averageHsv.hue,
    saturation: saturationTotal / pixelCount,
    brightness: brightnessTotal / pixelCount,
    warmth: warmthTotal / pixelCount,
    contrast: Math.sqrt(luminanceVariance),
    colorfulness: Math.sqrt(rgStd ** 2 + ybStd ** 2) + 0.3 * Math.sqrt(rgMean ** 2 + ybMean ** 2),
    red: averageRed,
    green: averageGreen,
    blue: averageBlue,
  });
}

function rgbToHsv(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    if (max === green) hue = 60 * ((blue - red) / delta + 2);
    if (max === blue) hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: (hue + 360) % 360,
    saturation: max === 0 ? 0 : delta / max,
    brightness: max,
  };
}

function warmHueScore(hue) {
  const distanceFromOrange = Math.abs((((hue - 35) % 360) + 540) % 360 - 180);
  return 1 - distanceFromOrange / 180;
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

function loadColorCache() {
  if (!existsSync(COLOR_CACHE_PATH)) return {};
  return JSON.parse(readFileSync(COLOR_CACHE_PATH, "utf8"));
}

function bestAlbumImage(images = []) {
  return [...images].sort((a, b) => Number(b.width || b.height || 0) - Number(a.width || a.height || 0))[0] || null;
}

function roundValues(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Math.round(value * 10000) / 10000]),
  );
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizePlaylistId(value) {
  const trimmed = value.trim();
  const urlMatch = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
  const uriMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]+)/);
  return urlMatch?.[1] || uriMatch?.[1] || trimmed;
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
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
