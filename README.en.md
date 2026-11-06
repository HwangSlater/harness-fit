<div align="center">

# harness-fit

### Find the skills, hooks and rules your project actually needs.

Just started with Claude Code and not sure what to install?<br>
It reads your repo and walks you through picking the skills, hooks and CLAUDE.md instructions that fit — step by step.<br>
<sub>A harness is the set of skills, hooks and instructions Claude works within. This fits one to your project.</sub>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A52.1.139-d97757.svg)](#claude-code)
![Skills](https://img.shields.io/badge/skills-81%20from%2024%20repos%20%E2%98%85%E2%89%A51k-7b61ff.svg)
![Hooks](https://img.shields.io/badge/hooks-23-555.svg)
![Languages](https://img.shields.io/badge/UI-KO%20%C2%B7%20EN-555.svg)
[![Local first](https://img.shields.io/badge/runs-locally-555.svg)](#your-data-stays-on-your-machine)

[한국어](README.md) · **English**

<img src="docs/images/overview-en.png" alt="harness-fit picker — step 1, combo and branch strategy" width="760">

</div>

---

## Skills, hooks, CLAUDE.md… what should I install?

Right after installing Claude Code, the questions pile up.

- There are dozens of skill repos on GitHub. **Which ones fit my project?**
- More sounds better, until you learn **they cost tokens in every conversation.**
- "Don't `git add .`", "don't commit to main"… **do I have to say this every time?**

**harness-fit** reads your repo (stack, team size, branches) and preselects a combo. Click "Next" through to the review step and press "Apply", or change only what you want on the way.

## Quick start

```bash
npx github:HwangSlater/harness-fit
```

It reads the repo in the current folder and opens the picker in your browser (`cli/harness-fit.js`). This is for browsing: hooks only run through the plugin, so applying without it writes the settings file but blocks nothing (the picker says so, and the CLAUDE.md instructions are written as if the hooks were off). To use it for real, install it as in "Claude Code" below.

## Claude Code

Requires **Claude Code v2.1.139 or later** (the hooks use the exec form with `args`, added in that version). Tested on 2.1.318. Install once.

```
/plugin marketplace add HwangSlater/harness-fit
/plugin install harness-fit@harness-fit
```

Then, in your project:

```
/harness-fit:setup
```

No need to describe your project: it reads the repo (package.json, recent committers, branches, CI) and preselects the recommended combo. If there is nothing to read yet, such as a brand-new empty repo, it tells you a tailored recommendation isn't possible and asks whether to start from the default set or hear what you're building (e.g. "Next.js + Supabase, 3 people").

When it's applied, Claude summarizes the result and continues with what's left (skills to install yourself, requests you typed on the screen).

| Command | What it does |
| --- | --- |
| `/harness-fit:setup` | Open the picker |
| `/harness-fit:setup auto` | No browser: review the recommendation and apply (remote/SSH) |
| `/harness-fit:setup undo` | Undo the last apply |

## What you do on the screen (6 steps)

One question per screen. The step tabs at the top and the "Your picks" summary on the right jump to any step, and every step has its own address (`#combo` …), so the browser's Back button works too.

1. **How much should Claude help?** (combo & branch strategy) Light · Solo · Team · Thorough. "What it turns on" on each card previews its skills, hooks and instructions. Stack-specific skills (React, Supabase, GitHub Actions…) are added automatically. Below the combos you pick a **branch strategy** (GitHub Flow · Git Flow · Trunk-based · None); the related hooks follow your choice.
2. **Which skills should go in?** Click chips to turn skills on or off in each stage: plan → design & UI → build → test & debug → review & security → ship. "Also recommended" is matched to your stack; "See all skills" searches all 81.
3. **Which mistakes should be blocked?** The 23 hooks in 6 groups (Secrets & danger / Git history / Code / Per language / Way of working / Saving tokens). "Details" shows what each one blocks and its options. "Blocking only" turns on just the hooks that block a command or file write and turns off the notice-only ones (Report commit hashes, Work checklist, Answer language).
4. **Which instructions go into CLAUDE.md?** The exact text that will be written, matched to the hooks you turned on, is previewed on the right (short / full). The top block, **"Commands in this repo"**, lists the test, lint, type-check, format and build commands read from package.json scripts (using pnpm, yarn or bun when their lockfile is there), Makefile, pyproject (pytest, ruff, mypy, tox, hatch), Cargo and go.mod. Only what the repo really has goes in; if nothing is found, or your CLAUDE.md already lists them, it is left out. Turning on a chip under "Hooks that take over a line" lets that hook enforce the rule, so the overlapping line is dropped; "Show removed lines" shows lines dropped because a hook or skill covers them (or your CLAUDE.md already says it), struck through with the reason.
5. **Anything else?** Write "commit messages in English" and Claude applies it after setup.
6. **Apply this?** Every pick has a "Change" link back to its step, and you see what gets added where. Only the "Apply" button on this step applies (the summary card's "Review before applying" brings you here).

If you picked a branch strategy, the review step asks **"Should teammates get the same hooks?"** and Apply stays locked until you answer. "Yes" adds an install prompt to `.claude/settings.json` and shows, before and after applying, what teammates need: the files to commit and push, the install prompt they get when opening the repo, and that the git pre-commit hook has to be applied on each teammate's PC.

<div align="center">
<img src="docs/images/confirm-en.png" alt="Step 6, review — what gets added and the teammate question" width="760">
</div>

**Reopening starts from your previous selection.** Opening `/harness-fit:setup` again in a project you already set up starts from what you applied last time (hooks you turned off stay off), not a fresh recommendation; skills, hooks and instructions added since then start off and are marked "New". "Reset to recommended" leaves "Restore previous choice" in the same place. `auto` keeps your previous selection too and only names what's new.

## What goes where?

| What | Where | What it does |
| --- | --- | --- |
| Skills | `.claude/skills/<name>/` | Ways of working Claude reads only when needed, downloaded at a version pinned to a commit. |
| Hooks | `.claude/harness.json` | The hook program is this plugin; the file only lists which hooks are on, their options and your last selection. |
| Git pre-commit hook | `.git/hooks/pre-commit` | Re-checks what actually goes into each commit with the same hooks (files written from the shell, and commits made outside Claude, too). |
| CLAUDE.md instructions | marked block in `CLAUDE.md` | Read every conversation. Existing text stays. |
| Teammate install prompt | `.claude/settings.json` | Teammates who open the repo are prompted to install this plugin (pinned version). Existing settings are kept; two entries are added. |
| Request note | `.claude/harness-request.md` | What you typed on the screen; Claude reads and applies it. |
| Backup | `.claude/harness-backup/` | The original of every changed file, used for undo (one line in `.gitignore` keeps it out of commits). |

### Nothing you already have is added twice

- **Hooks**: your existing hooks (user and project settings, other plugins) are run with sample inputs. If one already blocks the same thing, harness-fit's hook starts off and the picker says so. Hooks that block before a write (PreToolUse) and Stop, SessionStart and UserPromptSubmit hooks are compared with hooks of the same event; hooks that report afterwards (PostToolUse) are not treated as the same. The test runs in a temporary repo and home folder and takes a few seconds; each existing hook is called once per sample input (dozens of times), so a hook that logs records that many. Hooks inside the repo are only test-run when opened from Claude Code.
- **Skills**: a skill with the same name is left out. Skills with a different name that do the same job are picked out by Claude at setup from their names and descriptions.
- **CLAUDE.md**: lines your project or global CLAUDE.md already says are left out by Claude. Things a hook enforces are not repeated as instruction text.
- **With team sharing on**, hooks and skills that exist only on this PC (global settings) do not count as overlap — teammates don't have them.
- Within harness-fit, skills that do the same job (e.g. "Test first" and "Light test-first") are never in a combo together (`catalog/overlaps.json`).

### GitHub repository settings (only if you want them)

Hooks only see the commands Claude runs. Merging from the GitHub web UI, through `gh api`, or by another person gets past them. So the review step has "Also turn on GitHub repository settings". **It is off by default.** Turned on, you pick the items below one by one. Recommended values are preselected, but the right answer differs per team, so you decide each one. It applies to everyone who uses the repository, so the picker lists what changes (now → after) for the chosen items before anything is changed.

| Item | GitHub Flow | Git Flow | Trunk-based |
| --- | --- | --- | --- |
| Squash merging only (merge-commit and rebase buttons go away) | on | not offered | not offered |
| Automatically delete merged branches | on | not offered | not offered |
| Require a pull request before merging | on | **off** — release and hotfix are merged locally and pushed | not offered |
| Required approvals (0, 1, 2) | 0 | 0 | not offered |
| Block force pushes | on | on | on |
| Block deletion | on | on | on |
| Include administrators (you cannot push straight to the branch either) | on | on | on |

Protected branches: the default branch for GitHub Flow and trunk-based, main (or master) and develop for Git Flow. None offers nothing.

- With 1 or more required approvals someone else has to approve, so a solo owner can no longer merge their own PR.
- An item left off means "leave as is": nothing already on in GitHub is turned off, and existing protection settings (status checks etc.) are kept.
- Available when origin is a github.com repository, `gh` is installed and logged in, and you are an admin of the repository. Otherwise the picker says why in one line, with "Check again" if you were offline or not logged in.
- On free accounts, GitHub does not allow branch protection on private repositories (Pro or Team needed). The picker says those items will be skipped; only the merge settings can be chosen.
- Without the picker (`auto`), Claude shows the items with their recommended values and passes only the ones you pick (`--github-settings=squash,pr:main,…`).
- Undo puts the changed settings back. Values someone changed on GitHub since then are left alone.

### Hook options are yours to choose too

"Details" in step 3 shows only the options a hook actually reads. Values a branch strategy sets (protected branches, blocking direct pushes, branch name prefixes) become the defaults when you pick that strategy; a value you change stays when you switch strategies.

| Hook | Options |
| --- | --- |
| Block secrets | Accept allow comments (off by default) |
| Protect .env & key files | Extra files and folders |
| Protected branches | Branch list, block direct pushes too, allow direct commits |
| Commit message format | Format (type: summary / any), language (any, Korean, English), subject limit (50, 72, 100) |
| Branch naming | Allowed prefixes (GitHub Flow list / Git Flow list) |
| Block large new files | Line limit (300, 400, 600, 800) |
| Docs format check | Check the date line |
| Answer language | Language (Korean, English, Japanese, Chinese) |

## Mistakes it blocks (23 hooks)

Rules that need no judgment are enforced by hooks, not prose. They cost no tokens until they fire. A hook only exists if it can catch every form it promises; things that would need guessing (hard-coded values, SQL/shell injection, secrets in logs) stay as instructions and skills instead (the one heuristic hook, "Answer language", is harmless when it misses, so it is an opt-in, off by default). Every hook has tests that feed "must block" and "must pass" inputs through the real entry point (`hooks/test/strict.test.mjs`).

**Secrets & danger**

| Hook | Blocks |
| --- | --- |
| Block secrets | GitHub/AWS/OpenAI/Slack/Google/Stripe keys, private keys, JWT-shaped strings and `password = "real value"` written to files or commits (listed forms only) |
| Protect .env & key files | Writing or committing `.env`, certificates and SSH keys |
| Block dangerous commands | Wiping with `rm -rf ~` or `Remove-Item -Recurse`, `curl … \| sh`, `irm … \| iex`, `chmod 777`, `reset --hard` over uncommitted work (listed forms only) |
| Block passwords on the command line | `mysql -pSECRET`, `curl -u user:pass`, `PGPASSWORD=value`, `postgres://user:pass@` (listed forms only) |

**Git history**

| Hook | Blocks |
| --- | --- |
| Block git add -A | `git add .`, `-A`, `-u` without paths, `git commit -a` — stage only what you changed |
| Protected branches | Direct commits (including `cherry-pick`, `revert`, `am`), force-pushes and remote deletes on main (with GitHub Flow, direct pushes too; `merge` is allowed) |
| Commit message format | `feat:` / `fix:` style, subject up to 72 chars; asks for a direct message when it cannot read one |
| Branch naming | New branches (`switch -c`, `checkout -b`, `branch`, `worktree add -b`) must start with `feature/`, `fix/`, … |
| Block --no-verify | `--no-verify`, `commit -n`, `HUSKY=0`, `SKIP=`, changing `core.hooksPath` |
| Block rewriting pushed commits | `git commit --amend` or `git rebase` on commits already pushed (`git pull --rebase` is fine) |
| PR merge style | `gh pr merge` without `--squash` and `--delete-branch` (GitHub Flow only) |
| Block unsquashed pushes | `git push` with two or more commits that are not on the remote, with how to squash them via `git reset --soft` (teams differ, so it is off in every combo) |

**Code**

| Hook | Blocks |
| --- | --- |
| Block large new files | New code files over 400 lines (also files first added by a commit) |
| Block unsafe HTML | `innerHTML =`, `dangerouslySetInnerHTML`, `v-html`, `eval(`, `new Function(` |
| Pin dependency versions | Ranges such as `^1.2.3`, `~1.2`, `latest` in package.json (also from `npm install`, at commit time; peerDependencies excluded) |
| Block GitHub Actions injection | `${{ github.event.issue.title }}` straight in `run:`, fetching PR code under `pull_request_target`, third-party actions at `@v1` instead of a commit SHA |

**Per language** (on in Solo, Team and Thorough when that stack is detected)

| Hook | Blocks |
| --- | --- |
| Block Swift try! and print | `try!`, `print(` and `debugPrint(` on new lines in `.swift` files (tests and vendored code excluded) |
| Block Python shell=True and eval | `shell=True`, `eval(` and `exec(` on new lines in `.py` files (tests and vendored code excluded) |

**Way of working** (checked when Claude finishes an answer or a session starts)

| Hook | Does |
| --- | --- |
| Report commit hashes | Asks once when an answer leaves out the hash of a commit made in that turn |
| Work checklist | Gives each session a checklist file and shows what is left when you send a message (never blocks) |
| Docs format check | Only docs and images in `docs/`; `# Title`, date line and index link for changed docs (on in Thorough) |
| Answer language | Asks for a rewrite when the final answer is not in the chosen language (a word-count heuristic, so off by default) |

**Saving tokens**

| Hook | Blocks |
| --- | --- |
| Read GitHub with gh | Scraping GitHub pages instead of using `gh` |

- File hooks run on Write/Edit; files written from the shell or other tools (`cat >`, `sed -i`, `npm install`) are checked again with the same hooks at commit time. Applying adds a small git hook at `.git/hooks/pre-commit` that looks at what is actually being committed — also when a person commits outside Claude (undo removes it). The git hook is not part of the repo, so each teammate gets it by opening `/harness-fit:setup` on their PC and applying as is.
- If another pre-commit hook or `core.hooksPath` (husky, pre-commit, lefthook) already exists, it is not overwritten; you get one line to add to that hook. In that case, and in a teammate's fresh clone, the `git commit` command is read inside Claude Code instead, and a command that writes files and then commits is asked to run separately.
- Shell hooks read the command text and what runs inside `bash -c "…"` or `pwsh -Command "…"`. They cannot see inside script files or git aliases.
- Exactly what each hook blocks is under "Details" → "More" in the picker (`detail` in `catalog/packs.json`).

### Letting one line through

You don't have to turn a whole hook off. Add `lint:allow <hook id> <reason>` at the end of the line or in a comment line right above it, and only that line passes; you are told the hook id, file:line and reason every time (with no reason, or one shorter than 3 characters, it stays blocked).

```js
el.innerHTML = renderMarkdown(src); // lint:allow unsafe-html the renderer only returns DOMPurify-sanitised HTML
```

- Accepted by: Block unsafe HTML (`unsafe-html`), Block GitHub Actions injection (`gha-inject`), the Swift and Python hooks, Block large new files (`file-size`, within the first 10 lines), and Block secrets (`secrets`, only with the "Accept allow comments" option on — a real key is too easy to wave through with a comment).
- Not accepted by: Pin dependency versions (package.json has no comments), Protect .env & key files (it looks at files, not lines), and the hooks that read commands.
- The older `harness:allow <id> <reason>` form from 0.2.x is still accepted under the same rules.

### When a hook crashes

It lets the action through but does not go quiet: "harness-fit: the … hook crashed, so this action runs without it." (a notice line in Claude Code, terminal text for the git pre-commit hook). Blocking instead would leave Claude unable to fix even the settings file, and would stop people's commits too. If another hook finds something to block, it still blocks. A broken `.claude/harness.json` is reported too, rather than silently turning everything off.

Installing the plugin does nothing in projects without `.claude/harness.json` (the hook modules are not even loaded).

## How many tokens?

Hooks cost 0. Skills keep only a name and one-line description until used. These are the "Read every conversation" numbers from the picker's summary card for an example Next.js · TypeScript · Supabase · GitHub Actions repo (test, lint, typecheck and build scripts in package.json) (skill one-liners + CLAUDE.md instructions, roughly 4 English characters per token). Skill counts include one skill you install yourself (React performance).

| Combo | Skills · hooks · instructions | Per conversation |
| --- | --- | --- |
| Light | 0 · 4 · 2 | ~83 tokens (0.0%) |
| Solo | 9 · 9 · 4 | ~891 tokens (0.4%) |
| Team | 13 · 17 · 6 | ~1,187 tokens (0.6%) |
| Thorough | 16 · 19 · 6 | ~1,408 tokens (0.7%) |

The percentage is the share of what Claude can hold at once (200k tokens). The instruction counts include "Commands in this repo", and the 6 in Team and Thorough also include the branch strategy (GitHub Flow).

## Where do the skills come from?

- 81 skills from 24 GitHub repositories with 1,000+ stars, updated within the last six months (`catalog/catalog.json`).
- A saved list goes stale, so every time the picker opens it reruns the same searches for **repositories that appeared or were updated after the catalog date** and lists them at the bottom of the skills step. They are not vetted, so nothing is installed; tick one and Claude reviews it after setup.
- "More" in "See all skills" shows each skill's source, license, pinned commit, any executable files it contains, and the original text.
- Only permissively licensed skills (MIT, Apache-2.0, …) are copied; others link to their own install instructions. Downloaded skills are never run.

Skills belong to their authors. The source is recorded in `.harness-source.json` inside each installed folder.

## Undo

```
/harness-fit:setup undo
```

Or `npx github:HwangSlater/harness-fit --undo`. Restores the state before the last apply.

Files you edited after setup are not wiped: only the harness-fit block is taken out of CLAUDE.md and only its line out of `.gitignore`; other edited files are saved to the backup folder as you left them, then reverted, and you are told where. If you applied twice, undo goes back one apply at a time. If GitHub repository settings were turned on, they are set back first; anything that could not be set back is listed with the value to set by hand.

## Your data stays on your machine

The picker runs only on your machine (`127.0.0.1`) and checks a one-time token on every data request. The only outgoing requests are downloading skill files, searching GitHub for new repositories, and — if origin is on GitHub and `gh` is logged in — reading the repository settings when the picker opens (`gh api`, read-only). Requests that change settings are sent only when "Also turn on GitHub repository settings" is on. No code or file contents are sent anywhere.

## License

[MIT](LICENSE) © [HwangSlater](https://github.com/HwangSlater)
