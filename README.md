# Spotify Playlist Reorderer

Automatically reorder a Spotify playlist on a schedule. It is designed for GitHub Actions, so it can run hourly without a server or your laptop being on.

## What it can do

By default `ORDER_MODE=random-eccentric`, which randomly chooses 1 to 3 eccentric methods and applies them as a combined ordering. About one third of random runs include an album-cover colour method when `data/album-colors.json` exists.

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
- `color-rainbow`: album covers by dominant hue
- `color-reverse-rainbow`: dominant hue in reverse
- `color-dark-to-light`: darkest album covers first
- `color-light-to-dark`: brightest album covers first
- `color-muted-to-vivid`: greyscale-ish covers into vivid covers
- `color-vivid-to-muted`: vivid covers into muted covers
- `color-warm-to-cool`: warm reds/yellows into cooler blues/greens
- `color-cool-to-warm`: cool covers into warm covers
- `color-contrast-wave`: high contrast, low contrast, and inward
- `color-complement-hop`: hue buckets offset around the colour wheel

You can also use one method directly:

```bash
ORDER_MODE=duration-long-short npm start
```

Or combine no more than 3 methods yourself:

```bash
ORDER_MODE=combo:vowel-density,least-popular-first,duration-long-short npm start
```

All data comes from Spotify's Web API playlist and track objects.

## Album-cover colour cache

Colour ordering uses album cover image URLs returned by Spotify. Build or refresh the local cache with:

```bash
npm install
npm run colors:build
```

This writes `data/album-colors.json`, keyed by Spotify album ID. Normal scheduled runs only read this file; they do not download and analyze thousands of images every time.

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
MAX_MOVES_PER_RUN
```

`ORDER_MODE` is optional and defaults to `random-eccentric`. `MAX_MOVES_PER_RUN` defaults to `40`, which keeps hourly runs conservative with Spotify rate limits.

The workflow in `.github/workflows/reorder-playlist.yml` runs hourly. Spotify rate limits are handled by waiting and retrying when Spotify returns `429`.

If other people fork this project, they should create their own Spotify Developer app and GitHub secrets. Do not share your refresh token.

## Change the schedule

Edit the cron line in `.github/workflows/reorder-playlist.yml`.

Examples:

```yaml
# Every 5 minutes
- cron: "*/5 * * * *"

# Every hour
- cron: "0 * * * *"

# Every 6 hours
- cron: "0 */6 * * *"
```

GitHub Actions cron schedules use UTC.

## Notes

- Local Spotify files are skipped because Spotify cannot reorder them through the Web API.
- The app rewrites the playlist item order with Spotify's current playlist items endpoints.
- GitHub scheduled workflows may be delayed during busy periods, which is normal for GitHub Actions.
