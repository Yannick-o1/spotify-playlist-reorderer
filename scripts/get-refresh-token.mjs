import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = ["playlist-read-private", "playlist-read-collaborative", "playlist-modify-private", "playlist-modify-public"];

loadDotEnv();

const clientId = readRequiredEnv("SPOTIFY_CLIENT_ID");
const clientSecret = readRequiredEnv("SPOTIFY_CLIENT_SECRET");
const state = randomUUID();

const authorizeUrl = new URL(AUTH_URL);
authorizeUrl.searchParams.set("client_id", clientId);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
authorizeUrl.searchParams.set("state", state);

console.log("1. Add this Redirect URI in your Spotify Developer app:");
console.log(`   ${REDIRECT_URI}`);
console.log("\n2. Open this URL, approve access, then return here:");
console.log(`   ${authorizeUrl.toString()}\n`);

const code = await waitForAuthorizationCode(state);
const refreshToken = await exchangeCodeForRefreshToken(code);

console.log("\nYour SPOTIFY_REFRESH_TOKEN is:\n");
console.log(refreshToken);
console.log("\nStore it as a GitHub repository secret, not in committed files.");

function waitForAuthorizationCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", REDIRECT_URI);
      const code = requestUrl.searchParams.get("code");
      const returnedState = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        response.end("Spotify authorization failed. You can close this tab.");
        server.close();
        reject(new Error(`Spotify authorization failed: ${error}`));
        return;
      }

      if (!code || returnedState !== expectedState) {
        response.end("Invalid Spotify authorization response. You can close this tab.");
        server.close();
        reject(new Error("Invalid authorization response."));
        return;
      }

      response.end("Spotify authorization complete. You can close this tab.");
      server.close();
      resolve(code);
    });

    server.listen(8888, "127.0.0.1");
  });
}

async function exchangeCodeForRefreshToken(code) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error_description || body.error || "Failed to exchange authorization code.");
  }

  return body.refresh_token;
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
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
