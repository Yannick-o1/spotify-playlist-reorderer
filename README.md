# Spotify Shuffler

Automatically reorder the Spotify playlist **Stuff** every three days with GitHub Actions. The first four tracks always remain at the top in this exact order:

1. Livin' Loose — George Clanton
2. Know by Heart — The American Analog Set
3. I Can Change — LCD Soundsystem
4. Dayvan Cowboy — Boards of Canada

Each three-day cycle makes an unbiased 50/50 choice for every remaining playlist item:

- **Reverse chronological:** newest playlist additions first, based on Spotify's `added_at` timestamp.
- **Random:** a fresh Fisher–Yates shuffle of every playlist item.

The script moves items in place instead of clearing and rebuilding the playlist, preserving local and unavailable entries. It uses Spotify snapshot IDs so a concurrent playlist edit causes a safe failure instead of reordering stale positions.

Spotify applies a daily-style write quota to this playlist. To stay below the measured limit, the script makes at most 600 moves per daily run. Every run within the same three-day cycle reconstructs exactly the same target, so a partial reorder resumes instead of choosing a conflicting new shuffle. With 1,403 playlist items, the target completes within the three-day cycle. Short `Retry-After` responses are honored; a long quota reset exits cleanly for the next daily continuation.

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
STUFF_SPOTIFY_CLIENT_ID
STUFF_SPOTIFY_CLIENT_SECRET
STUFF_SPOTIFY_REFRESH_TOKEN
STUFF_SPOTIFY_PLAYLIST_ID
```

The `STUFF_` prefix isolates this production workflow from obsolete or queued historical runs. The workflow maps these repository secrets to the unprefixed environment variables expected by the local script.

`SPOTIFY_PLAYLIST_ID` can be a raw ID, a Spotify playlist URL, or a `spotify:playlist:` URI.

Run the shuffler with:

```bash
npm start
```

The console reports the three-day cycle, selected ordering, progress, and whether another daily continuation is needed.

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

The workflow in `.github/workflows/shuffle-stuff.yml` runs daily at 01:17 UTC. It creates a new target only once every three days; daily runs are continuations required to stay within Spotify's quota, and become no-ops as soon as that cycle's target is complete. It can also be triggered manually from the Actions tab. Scheduled GitHub workflows can be delayed during busy periods.

To change the schedule, edit its cron expression. GitHub Actions cron schedules use UTC.

## Verification

Run the syntax checks and ordering tests with:

```bash
npm run check
```

Short Spotify rate limits are handled by waiting for the server's retry interval. Long daily quota resets are deferred to the next scheduled continuation. Temporary Spotify server errors are retried with exponential backoff.
