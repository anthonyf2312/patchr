# Security

## Reporting a vulnerability

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/anthonyf2312/patchr/security/advisories/new), not in a public issue.

It helps to include what an attacker could do, the steps to reproduce it, and the version (shown in `/help`). You'll get a reply within a week. Fixes ship as a normal release, and the advisory is published once servers have had time to update.

## Worth knowing

- Patchr only follows public repositories. It refuses private ones even if its token could read them, and stops following a repository that later turns private.
- Messages Patchr posts can only ping the role a server chose. Text from release notes can never ping anyone.
- Keep `DISCORD_TOKEN` and `GITHUB_TOKEN` out of version control. The GitHub token only needs read access to public repositories, so don't give it more.
