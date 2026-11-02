<div align="center">

# harness-fit

### Find the skills, hooks and rules your project actually needs.

Just started with Claude Code and not sure what to install?<br>
It reads your repo and lets you pick the skills, hooks and rules that fit — on one screen.<br>
<sub>A harness is the set of skills, hooks and rules Claude works within. This fits one to your project.</sub>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](#claude-code)
![Skills](https://img.shields.io/badge/skills-81%20from%2033%20repos%20%E2%98%85%E2%89%A51k-7b61ff.svg)
![Languages](https://img.shields.io/badge/UI-KO%20%C2%B7%20EN-555.svg)
[![Local first](https://img.shields.io/badge/runs-locally-555.svg)](#your-data-stays-on-your-machine)

[한국어](README.md) · **English**

<img src="docs/images/overview-en.png" alt="harness-fit picker" width="760">

</div>

---

## Skills, hooks, CLAUDE.md… what should I install?

Right after installing Claude Code, the questions pile up.

- There are dozens of skill repos on GitHub. **Which ones fit my project?**
- More sounds better, until you learn **they cost tokens in every conversation.**
- "Don't `git add .`", "don't commit to main"… **do I have to say this every time?**

**harness-fit** reads your repo (stack, team size, branches) and preselects a combo. Press "Apply" and you're done, or click to change only what you want.

## Quick start

```bash
npx github:HwangSlater/harness-fit
```

It reads the repo in the current folder and opens the picker in your browser.

## Claude Code

Install once.

```
/plugin marketplace add HwangSlater/harness-fit
/plugin install harness-fit@harness-fit
```

Then, in your project:

```
/harness-fit:setup
```

When it's applied, Claude summarizes the result and continues with what's left (skills to install yourself, requests you typed on the screen).

| Command | What it does |
| --- | --- |
| `/harness-fit:setup` | Open the picker |
| `/harness-fit:setup auto` | No browser: review the recommendation and apply (remote/SSH) |
| `/harness-fit:setup undo` | Undo the last apply |

## What you do on the screen

1. **How much should Claude help?** Light · Solo · Team · Thorough. Stack-specific skills (React, Supabase, GitHub Actions…) are added automatically.
2. **How it helps while you build.** See which skills attach to plan → design → build → test → review → ship. Click a card to remove it; "+ Add" lets you pick several at once.
3. **Mistakes it blocks.** Each check shows an example, e.g. "git add . stages everything → only the changed files get staged".
4. **How do you use branches?** GitHub Flow · Git Flow · Trunk-based · None. The related checks follow your choice.
5. **Rules added to CLAUDE.md.** Preview the exact text.
6. **Anything else?** Write "commit messages in English" and Claude applies it after setup.
7. **What gets added.** "Apply" first shows exactly what goes where; nothing changes until you confirm.

<div align="center">
<img src="docs/images/confirm-en.png" alt="Final confirmation before applying" width="760">
</div>

## What goes where?

| What | Where | What it does |
| --- | --- | --- |
| Skills | `.claude/skills/<name>/` | Ways of working Claude reads only when needed, downloaded at a pinned version. |
| Automatic checks (hooks) | `.claude/harness.json` | The checker is this plugin; the file only lists which checks are on. It checks right before Claude runs a command or writes a file. |
| Rules | marked block in `CLAUDE.md` | Read every conversation. Existing text stays. |
| Teammate install prompt | `.claude/settings.json` | Teammates who open the repo are prompted to install this plugin (pinned version). |
| Request note | `.claude/harness-request.md` | What you typed on the screen; Claude reads and applies it. |
| Backup | `.claude/harness-backup/` | The original of every changed file, used for undo. |

## Mistakes it blocks (11 hooks)

Rules that need no judgment are enforced by checks, not prose. They cost no tokens until they fire.

| Check | Blocks |
| --- | --- |
| Block secrets | API keys written to code or commits |
| Protect .env & key files | Writing to `.env`, certificates, SSH keys |
| Block dangerous commands | `rm -rf ~`, `curl … \| sh`, `reset --hard` over uncommitted work |
| No passwords on the command line | Things like `mysql -pSECRET` |
| No git add -A | `git add .` — stage only what you changed |
| Protected branches | Direct commits and force-pushes to main |
| Commit message format | `feat:` / `fix:` style, subject up to 72 chars |
| Branch naming | Must start with `feature/`, `fix/`, … |
| No --no-verify | Skipping pre-commit checks |
| Limit new file size | New files over 400 lines |
| Read GitHub with gh | Scraping GitHub pages instead of using `gh` |

Installing the plugin blocks nothing in projects without `.claude/harness.json`.

## How many tokens?

Hooks cost 0. Skills keep only a name and one-line description until used. Measured on an example Next.js · TypeScript · Supabase repo:

| Combo | Skills · hooks | Per conversation |
| --- | --- | --- |
| Light | 0 · 4 | ~70 tokens (0.0%) |
| Solo | 9 · 5 | ~850 tokens (0.4%) |
| Team | 13 · 10 | ~1,200 tokens (0.6%) |
| Thorough | 17 · 11 | ~1,570 tokens (0.8%) |

The percentage is the share of what Claude can hold at once (200k tokens).

## Where do the skills come from?

- 81 skills from 33 GitHub repositories with 1,000+ stars, updated within the last six months (`catalog/catalog.json`).
- A saved list goes stale, so every time the picker opens it reruns the same searches for **repositories that appeared after the catalog date** and lists them separately. They are not vetted, so nothing is installed; pick one and Claude reviews it after setup.
- "Details" shows each skill's source, license, pinned commit and any executable files it contains.
- Only permissively licensed skills (MIT, Apache-2.0, …) are copied; others link to their own install instructions.

Skills belong to their authors. The source is recorded in `.harness-source.json` inside each installed folder.

## Undo

```
/harness-fit:setup undo
```

Or `npx github:HwangSlater/harness-fit --undo`. Restores the state before the last apply.

## Your data stays on your machine

The picker runs only on your machine (`127.0.0.1`). The only outgoing requests are downloading skill files and searching GitHub for new repositories. No code or file contents are sent anywhere.

## License

[MIT](LICENSE) © [HwangSlater](https://github.com/HwangSlater)
