# Spotify Playlist Reorderer

Automatically reorder a Spotify playlist on a schedule. It is designed for GitHub Actions, so it can run every other day without a server or your laptop being on.

## What it can do

By default `ORDER_MODE=random-eccentric`, which randomly chooses 1 to 3 of these eccentric methods and applies them as a combined ordering:

- `second-letter-reverse-alpha`: reverse alphabetical by the second alphanumeric character in the title
- `duration-long-short`: longest, shortest, second longest, second shortest
- `title-length-long-short`: longest title, shortest title, second longest title, second shortest title
- `least-popular-first`: lowest Spotify popularity score first
- `popularity-low-high`: least popular, most popular, second least, second most
- `release-date-old-new`: oldest releases first
- `release-date-new-old`: newest releases first
- `decade-round-robin`: interleave release decades
- `vowel-density`: titles with the highest vowel density first
- `fewest-vowels-first`: titles with the fewest vowels first
- `word-count-wave`: alternates sparse and wordy titles
- `punctuation-heavy-first`: punctuation-heavy titles first
- `explicit-centerpiece`: clean tracks around an explicit middle block
- `artist-count-long-short`: most credited artists, fewest credited artists, and inward
- `artist-last-letter`: primary artist sorted by final character
- `album-title-length`: shortest album names first, then shortest track titles
- `album-release-precision`: full release dates, then month-only, then year-only
- `duration-modulo-minute`: sort by how far each track spills into its final minute
- `added-day-of-week`: Sunday additions through Saturday additions
- `spotify-id-lottery`: deterministic pseudo-random order from Spotify track IDs

You can also use one method directly:

```bash
ORDER_MODE=duration-long-short npm start
```

Or combine no more than 3 methods yourself:

```bash
ORDER_MODE=combo:vowel-density,least-popular-first,duration-long-short npm start
```

All data comes from Spotify's Web API playlist and track objects.

## Local setup

Requirements:

- Node.js 20+
- A Spotify Developer app from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

Create a local `.env` file if you want to run it locally:

```bash
cp .env.example .env
```

The scripts read `.env` automatically for local runs, so fill in the values and run:

```bash
npm start
```

## Get a Spotify refresh token

1. In your Spotify Developer app, add this Redirect URI:

```text
http://127.0.0.1:8888/callback
```

2. Run:

```bash
npm run auth
```

3. Open the printed URL, approve access, and copy the printed `SPOTIFY_REFRESH_TOKEN`.

The token needs these scopes:

```text
playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public
```

## Deploy with GitHub Actions

1. Create an empty GitHub repo.
2. Commit and push this project:

```bash
git add .
git commit -m "Initial Spotify playlist reorderer"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

3. In GitHub, go to `Settings -> Secrets and variables -> Actions -> New repository secret`.
4. Add:

```text
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN
SPOTIFY_PLAYLIST_ID
ORDER_MODE
EVERY_OTHER_DAY_ANCHOR
```

`ORDER_MODE` is optional and defaults to `random-eccentric`. `EVERY_OTHER_DAY_ANCHOR` is optional and defaults to `2026-04-29`; change it if you want the every-other-day cadence to start on a different local UK date.

The workflow in `.github/workflows/reorder-playlist.yml` wakes at `12:00 UTC` and `13:00 UTC`. The script checks `Europe/London` time and only changes the playlist at `13:00` UK time every other day. This handles both GMT and BST. You can also start it manually from the GitHub Actions tab and pass a one-off ordering mode.

If other people fork this project, they should create their own Spotify Developer app and GitHub secrets. Do not share your refresh token.

## Change the schedule

Edit the cron line and `EVERY_OTHER_DAY_ANCHOR` in `.github/workflows/reorder-playlist.yml`.

Examples:

```yaml
# Wake daily at the two UTC hours that can be 13:00 UK time
- cron: "0 12,13 * * *"

# Wake every day at 13:00 UTC, with no UK daylight-saving correction
- cron: "0 13 * * *"

# Every 6 hours
- cron: "0 */6 * * *"
```

GitHub Actions cron schedules use UTC.

## Notes

- Local Spotify files are skipped because Spotify cannot reorder them through the Web API.
- The app rewrites the playlist item order with Spotify's replace/add playlist item endpoints.
- GitHub scheduled workflows may be delayed during busy periods, which is normal for GitHub Actions.
