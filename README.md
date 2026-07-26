# Spotify Shuffler

Automatically reorder the Spotify playlist **Stuff** every three days with GitHub Actions. The first four tracks always remain at the top in this exact order:

1. Livin' Loose — George Clanton
2. Know by Heart — The American Analog Set
3. I Can Change — LCD Soundsystem
4. Dayvan Cowboy — Boards of Canada

Each run makes an unbiased 50/50 choice for every remaining playlist item:

- **Reverse chronological:** newest playlist additions first, based on Spotify's `added_at` timestamp.
- **Random:** a fresh Fisher–Yates shuffle of every playlist item.

The script moves items in place instead of clearing and rebuilding the playlist, preserving local and unavailable entries. It uses Spotify snapshot IDs so a concurrent playlist edit causes a safe failure instead of reordering stale positions. Writes are deliberately throttled and Spotify `Retry-After` responses are honored.

## Requirements

- Node.js 20 or newer
- A Spotify app from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
- A playlist owned by the Spotify account that authorizes the app

## Local setup

Create a local environment file:

```bash
cp .env.example .env
```

Fill in these four values in `.env`:

```text
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN
SPOTIFY_PLAYLIST_ID
```

`SPOTIFY_PLAYLIST_ID` can be a raw ID, a Spotify playlist URL, or a `spotify:playlist:` URI.

Run the shuffler with:

```bash
npm start
```

The console reports which of the two orderings was selected.

## Get a Spotify refresh token

1. In your Spotify app settings, add this redirect URI:

   ```text
   http://127.0.0.1:8888/callback
   ```

2. Put `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env`.
3. Run `npm run auth`.
4. Open the printed authorization URL and approve access.
5. Copy the refresh token printed in the terminal into `.env` or your GitHub secrets.

The helper requests these scopes:

```text
playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public
```

Treat the refresh token like a password and never commit it.

## GitHub Actions setup

In the GitHub repository, open `Settings → Secrets and variables → Actions` and add these repository secrets:

```text
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN
SPOTIFY_PLAYLIST_ID
```

The workflow in `.github/workflows/reorder-playlist.yml` checks once per day at 00:17 UTC and uses a date-independent cadence gate to run exactly every third UTC day. It can also be triggered manually from the Actions tab. Scheduled GitHub workflows can be delayed during busy periods.

To change the schedule, edit its cron expression. GitHub Actions cron schedules use UTC.

## Verification

Run the syntax checks and ordering tests with:

```bash
npm run check
```

Spotify rate limits are handled by waiting for the server's retry interval. Temporary Spotify server errors are retried with exponential backoff.
