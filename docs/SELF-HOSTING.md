# Self-hosting Patchr

Your own copy works exactly like the public bot.

## 1. Create the Discord application

1. In the [Developer Portal](https://discord.com/developers/applications), create an application.
2. **Bot**: reset the token and copy it. Patchr needs no privileged intents.
3. **Installation**: choose **Guild Install** only, with the `bot` and `applications.commands` scopes and the **View Channels**, **Send Messages** and **Embed Links** permissions. Or use this link with your application id:
   `https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=19456`
4. Optional: use `brand/export/discord/patchr-avatar-1024.png` and `patchr-banner-1500x600.png` as the avatar and banner. Patchr uploads its badge emojis by itself.

## 2. Create a GitHub token

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with **Public repositories (read-only)** access and nothing else. Without one, GitHub allows only 60 requests an hour. With one, Patchr can follow a few thousand repos: checks that find nothing new don't count against GitHub's limit, and quiet repos are checked less often.

## 3. Start it

### With Docker (recommended)

```sh
mkdir patchr && cd patchr
curl -O https://raw.githubusercontent.com/anthonyf2312/patchr/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/anthonyf2312/patchr/main/.env.example
# Edit .env: set DISCORD_TOKEN, GITHUB_TOKEN and POSTGRES_PASSWORD.
docker compose up -d
```

This runs Patchr with its own Postgres. Slash commands register themselves on first start, and again whenever an update changes them. Images are built for `amd64` and `arm64`, so a Raspberry Pi works too.

### With Node

You need Node 24 or newer. Without `DATABASE_URL`, Patchr uses PGlite, a copy of Postgres that runs inside the process and keeps its data in `./data`, so there's no database server to install.

```sh
git clone https://github.com/anthonyf2312/patchr.git && cd patchr
npm ci && npm run build
cp .env.example .env   # then fill it in
npm start
```

## Staying up to date

`compose.yaml` follows the newest `1.x` release, so a breaking `2.0` never installs itself. To update automatically, copy `deploy/` to the server and turn on the timer, which checks for a new image every 10 minutes:

```sh
sudo cp deploy/patchr-update.service deploy/patchr-update.timer /etc/systemd/system/
sudo systemctl enable --now patchr-update.timer
```

The server pulls updates rather than waiting for them, so this works on a home server behind a router too.

## Configuration

| Variable | Default | |
|---|---|---|
| `DISCORD_TOKEN` | required | Bot token |
| `GITHUB_TOKEN` | none | Fine-grained token, public repos read-only |
| `DATABASE_URL` | PGlite | Postgres connection string |
| `PGLITE_DIR` | `./data/pglite` | Where PGlite keeps its data |
| `POLL_INTERVAL_SECONDS` | `180` | How often an active repo is checked (minimum 60). Repos quiet for 30+ days are checked 2× less often, and 180+ days 5× less |
| `MAX_FEEDS_PER_GUILD` | `25` | Feed limit per server |
| `DEV_GUILD_ID` | none | Register commands in one server only, for development |
| `HEALTH_PORT` | `3000` | Port for `GET /healthz`; `0` turns it off |
| `LOG_LEVEL` | `info` | `debug` for more detail |
| `SUPPORT_URL` | none | Support server link shown in `/help` |
| `WEBSITE_URL` | Patchr's site | Website link shown in `/help` |
| `REPO_URL` | this repo | Source link shown in `/help` |
| `PATCHR_TAG` | `1` | Docker image tag `compose.yaml` follows |

## Backups

```sh
docker compose exec db pg_dump -U patchr patchr > patchr-$(date +%F).sql
```
