# spot shuffle

spot shuffle reorders spotify playlists on a repeating three-day cycle while keeping a configurable group of tracks pinned at the top.

each cycle makes an unbiased 85/15 choice for every unpinned playlist item:

- **reverse chronological — 85%:** newest playlist additions first, based on the `added_at` timestamp
- **random — 15%:** a fresh fisher–yates shuffle of every playlist item

the script moves items in place instead of clearing and rebuilding the playlist, preserving local and unavailable entries. spotify snapshot ids ensure that a concurrent playlist edit causes a safe failure instead of reordering stale positions.

every run in the same three-day cycle reconstructs the same deterministic target. if spotify's write quota stops a run early, the next daily run resumes that target instead of choosing a conflicting order. the included workflows use staggered schedules and a combined limit of 570 moves per day to leave headroom beneath the measured shared quota.

## requirements

- node.js 20 or newer
- a spotify app from the [spotify developer dashboard](https://developer.spotify.com/dashboard)
- a playlist owned by the spotify account that authorizes the app

## local setup

create a local environment file:

```bash
cp .env.example .env
```

replace each placeholder in `.env` with the corresponding spotify app credentials, refresh token, and playlist id. the playlist id can be a raw id, a spotify playlist url, or a `spotify:playlist:` uri.

the optional workflow settings control the pinned track uris, stable cycle seed, and maximum moves per run. production workflows provide these settings separately for each playlist.

run the reorderer with:

```bash
npm start
```

the console reports the current three-day cycle, selected ordering, progress, and whether another daily continuation is needed.

## get a spotify refresh token

1. add this redirect uri in the spotify app settings:

   ```text
   http://127.0.0.1:8888/callback
   ```

2. add the app client id and client secret to `.env`.
3. run `npm run auth`.
4. open the printed authorization url and approve access.
5. copy the printed refresh token into `.env` or the repository secrets.

the helper requests these scopes:

```text
playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public
```

treat the refresh token like a password and never commit it.

## github actions setup

the repository includes two isolated workflows under `.github/workflows`. each workflow uses its own secret names, playlist-specific pinned prefix, deterministic seed, schedule, and move limit.

the larger workflow runs daily at 01:17 utc with a 470-move cap. the smaller workflow runs daily at 03:17 utc with a 100-move cap. each creates a new 85/15 target only once every three days; the daily executions are quota-safe continuations and become no-ops after the target is complete.

both workflows can also be triggered manually from the actions tab. scheduled github workflows can be delayed during busy periods. cron schedules use utc.

## verification

run the syntax checks and ordering tests with:

```bash
npm run check
```

short spotify rate limits are handled by waiting for the server's retry interval. long quota resets are deferred to the next scheduled continuation. temporary spotify server errors are retried with exponential backoff.
