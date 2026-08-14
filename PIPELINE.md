# PIPELINE — Network Squad → production SaaS   updated: 2026-07-07

**Project (confirmed by Vikas 2026-07-07):** `mission-control` (the app: Node + Express + WebSocket dashboard, `server.js`, port 3000) **+** `network-squad` (the 10 agents + shared task board / activity log / reports). This is the chat-based Jarvis + squad Vikas built. NOT NetJarvis-cursor (explicitly out of scope).

**Epic:** Turn it into a production-grade, chat-first SaaS MVP — audit & fix, replace simulation with real read-only network integration where needed, add auth, strip all Bank of America data, open-source clean, publish to GitHub. Also: features roadmap + sibling open-source project ideas.

| # | Stage         | Status                                   | Artifact |
|---|---------------|------------------------------------------|----------|
| 0 | Intake        | done — project = mission-control + network-squad (Vikas ✓ 2026-07-07); app boots on :3000 (verified) | — |
| 1 | Unknowns      | IN PROGRESS — SaaS scope interview        | scratchpad/msc-reality-check.html |
| 2 | Requirements  | pending                                   | — |
| 3 | UX mock       | pending                                   | — |
| 4 | Architecture  | pending                                   | — |
| 5 | Build         | pending                                   | — |
| 6 | Code review   | pending — audit + fix                     | — |
| 7 | Browser QA    | pending                                   | — |
| 8 | Ship          | pending — BofA scrub + open-source publish | — |
| 9 | Learn         | pending                                   | — |

## Verified facts (fresh evidence 2026-07-07)
- App runs: `cd mission-control && node server.js` → http://localhost:3000 (HTTP 200, file-watcher active).
- Stack: express ^4.18, ws ^8.16, chokidar ^3.5, cors. Single `server.js` (2663 lines) + single `public/index.html` (116 KB). No build step, no tests, no linter, not a git repo.
- Agents (10): jarvis, netops, sentinel, firewall-pro, loadbal-pro, router-expert, monitor-eye, config-keeper, incident-handler, doc-writer. Each = CLAUDE.md persona + STATUS.json. Coordinate via network-squad/shared/*.md.
- **Biggest finding: agent answers are largely SIMULATED** — canned BGP/F5/config reports with hardcoded `{delay, msg}` strings (server.js ~554-740). NetOps prechecks write real report files but SSH is simulated (hardcoded `sandbox-iosxr-1.cisco.com`, password `C1sco12345`).
- Hardcoded absolute path `SQUAD_ROOT = C:\Users\vikasmit\network-squad`. Regex-based intent routing. No auth / users / roles.

## Open questions (Stage 1)
1. ~~MVP demo: polished simulation vs real read-only against Cisco sandbox vs hybrid?~~
   **ANSWERED by Vikas 2026-08-14: REAL read-only against the Cisco DevNet always-on
   sandbox.** No fabricated data. This is now a fixed requirement, not an option.
2. Deployment model: self-host single-tenant open-source core (recommended) vs cloud multi-tenant vs hybrid.
3. Which agents + which connectors in the MVP.
4. Auth model. 5. What "done" = for the company demo.
6. **NEW — repo visibility: public vs private?** Blocks the GitHub push. ASKED 2026-08-14.
7. **NEW — firstmate on Windows?** See blocker below. QUEUED.

## Vikas's standing workflow for this project (stated 2026-08-14)
Every new feature runs: **new branch → PR → brainstorm → todo list → build (using
firstmate) → a DIFFERENT agent reviews → merge.** This is the working law here; do not
shortcut it. Tooling: https://github.com/kunchenguid/firstmate

## New findings 2026-08-14 (fresh evidence this session)
- `mission-control` is **not a git repo** — no `.git`. First push = `git init` + first commit.
- **Secret scan clean.** No api-key/password/token literals outside `node_modules`.
  "Bank of America" appears only twice, both inside this PIPELINE.md (my own scrub notes) —
  so the BofA scrub blocking open-source is smaller than stage 8 assumed.
- `gh` is authenticated as **vikas53953** (scopes: repo, workflow, gist, read:org).
- **BLOCKER — firstmate is macOS/Linux only** (its own README badge). Vikas is on
  Windows 11. Running it natively is not possible; WSL is the likely path. It also wants a
  visible-crew backend (tmux / zellij / cmux / **Orca**) — note `~/orca` and `~/.herdr`
  already exist on this machine, so a backend may be half-present already.
- **Reuse opportunity for the Cisco work:** NetJarvis
  (`Downloads\vikas work\netops jarvis\-cursorvikas`) ALREADY has a working, verified
  Catalyst Center adapter (`electron/sources/catalyst-center.cjs`) — auth, inventory,
  health, topology, issues, Command Runner for `show` commands. Verified live this session:
  mode `live`, source `sandboxdnac.cisco.com`, 4 switches reachable, health 100.
  Porting that proven adapter is very likely better than writing a second one from scratch.
  To be decided at Stage 4, not now.

Deviations: see implementation-notes.md (to be created at build stage)
