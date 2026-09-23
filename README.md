<p align="center">
  <a href="https://anthonyf2312.github.io/patchr">
    <img src="brand/export/github/readme-banner-1280x320.png" alt="Patchr. Patch notes, posted beautifully." width="100%">
  </a>
</p>

<p align="center">
  <a href="https://anthonyf2312.github.io/patchr"><img src="https://img.shields.io/badge/website-patchr-FF5E8A?style=flat-square" alt="Website"></a>
  <a href="https://github.com/anthonyf2312/patchr/releases/latest"><img src="https://img.shields.io/github/v/release/anthonyf2312/patchr?style=flat-square&color=8B7CFF&label=release" alt="Latest release"></a>
  <a href="https://discord.gg/hsWvqgs9eG"><img src="https://img.shields.io/badge/support-Discord-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Support server"></a>
  <a href="https://github.com/anthonyf2312/patchr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/anthonyf2312/patchr/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-17142B?style=flat-square" alt="MIT license"></a>
  <br>
  <img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js v14">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-24-3DDC97?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <a href="docs/SELF-HOSTING.md"><img src="https://img.shields.io/badge/Docker-self--host-17142B?style=flat-square&logo=docker&logoColor=white" alt="Self-host with Docker"></a>
</p>

<p align="center">
  Patchr posts clean, formatted patch notes to your Discord server,<br>
  automatically from GitHub releases or written by you for any project.
</p>

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1552316775461425152&permissions=19456&integration_type=0&scope=bot+applications.commands"><img src="https://img.shields.io/badge/Add%20to%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Add Patchr to Discord"></a>
</p>

## Features

- **GitHub releases, automatically.** Pick a public repo and a channel. New releases post themselves, and edits on GitHub update the post.
- **Custom notes for everything else.** `/patch` opens a form, shows you a private preview, then posts. Fix a typo later from the message's **Apps** menu.
- **Easy to read.** Markdown, headings and lists come through properly, and sections get their own badges:
  <img src="brand/export/embeds/badge-new-128.png" width="16" height="16" alt=""> New&nbsp;
  <img src="brand/export/embeds/badge-fix-128.png" width="16" height="16" alt=""> Fixes&nbsp;
  <img src="brand/export/embeds/badge-change-128.png" width="16" height="16" alt=""> Changes
- **Made for announcements.** Ping an opt-in role, and posts in announcement channels reach every server that follows them.

## Commands

| Command | |
|---|---|
| `/feed add github` | Post a repo's releases to a channel |
| `/feed list` · `/feed edit` · `/feed remove` | Manage your feeds |
| `/patch` | Write, preview and post your own notes |
| `/settings` | Default channel, ping role and publishing |
| `/help` | How it all works |

By default these need **Manage Server**. You can change that in Server Settings → Integrations → Patchr.

## Add Patchr to your server

[Add Patchr](https://discord.com/oauth2/authorize?client_id=1552316775461425152&permissions=19456&integration_type=0&scope=bot+applications.commands), pick a channel, then run `/feed add github` or `/patch`. Questions or ideas? Join the [support server](https://discord.gg/hsWvqgs9eG).

## Run your own

```sh
curl -O https://raw.githubusercontent.com/anthonyf2312/patchr/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/anthonyf2312/patchr/main/.env.example
docker compose up -d   # after adding your tokens to .env
```

The full guide is in [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

## Contributing

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) · [Privacy](PRIVACY.md) · [Terms](TERMS.md)

<p align="center">
  <img src="brand/export/web/mark.svg" width="44" alt="Patchr">
</p>
