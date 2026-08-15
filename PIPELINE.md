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
| 5 | Build         | done — PR #1 MERGED 2026-08-15 (debates live-data-only, all fabrication paths dead); PR #2 MERGED (README, MIT, gitignore) | `main` |
| 6 | Code review   | IN PROGRESS — full audit done (7 blockers, scratchpad/stage6-audit.md); Tier-1 security fix agent on branch `fix/tier1-security` | scratchpad/stage6-audit.md |
| 7 | Browser QA    | pending                                   | — |
| 8 | Ship          | pending — BofA scrub + open-source publish | — |
| 9 | Learn         | pending                                   | — |

## Verified facts (fresh evidence 2026-07-07)
- App runs: `cd mission-control && node server.js` → http://localhost:3000 (HTTP 200, file-watcher active).
- Stack: express ^4.18, ws ^8.16, chokidar ^3.5, cors. Single `server.js` (2663 lines) + single `public/index.html` (116 KB). No build step, no tests, no linter, not a git repo.
- Agents (10): jarvis, netops, sentinel, firewall-pro, loadbal-pro, router-expert, monitor-eye, config-keeper, incident-handler, doc-writer. Each = CLAUDE.md persona + STATUS.json. Coordinate via network-squad/shared/*.md.
- **Biggest finding: agent answers are largely SIMULATED** — canned BGP/F5/config reports with hardcoded `{delay, msg}` strings (server.js ~554-740). NetOps prechecks write real report files but SSH is simulated (hardcoded `sandbox-iosxr-1.cisco.com`, password [redacted — Cisco public sandbox password]).
- Hardcoded absolute path `SQUAD_ROOT = C:\Users\vikasmit\network-squad`. Regex-based intent routing. No auth / users / roles.

## Open questions (Stage 1)
1. ~~MVP demo: polished simulation vs real read-only against Cisco sandbox vs hybrid?~~
   **ANSWERED by Vikas 2026-08-14: REAL read-only against the Cisco DevNet always-on
   sandbox.** No fabricated data. This is now a fixed requirement, not an option.
2. Deployment model: self-host single-tenant open-source core (recommended) vs cloud multi-tenant vs hybrid.
3. Which agents + which connectors in the MVP.
4. Auth model. 5. What "done" = for the company demo.
6. **NEW — repo visibility: public vs private?** Blocks the GitHub push. ASKED 2026-08-14.
7. ~~firstmate on Windows?~~ **ANSWERED by Vikas 2026-08-14: use Claude Code agents
   natively.** firstmate is macOS/Linux-only; his PROCESS is what matters, not the tool.
   Every feature still runs branch → PR → brainstorm → todo → build → a DIFFERENT agent
   reviews → merge, executed with Claude Code subagents. firstmate-in-WSL not pursued.
8. **NEW — sandbox coverage gap (see below): which agents become real?** ASKED 2026-08-14.

## Repo (done 2026-08-14, verified)
Public: https://github.com/vikas53953/mission-control — `main`, initial commit f7930c0,
7 files, node_modules ignored. Secret scan clean before push. Git identity set repo-local
(vikas53953) so his global config was left untouched.

## SANDBOX AUDIT — probed live 2026-08-14 (CORRECTED)
**My earlier "only 4 switches exist" claim was WRONG** — it generalised from the single
sandbox NetJarvis uses. Vikas corrected me: the DevNet catalogue is much wider (ACI,
Cat 9200/8000, Umbrella, Secure Network Analytics, SD-WAN, FMC/FTD, ISE, IOS XE/XR,
Meraki, NSO). I then probed 13 endpoints from his machine. Real results:

| Sandbox | Host | Result |
|---|---|---|
| Catalyst Center | sandboxdnac.cisco.com | **LIVE** — token OK, 4 devices sw1–sw4 C9KV-UADP-8P, all Reachable |
| Catalyst Center 2 | sandboxdnac2.cisco.com | LIVE — token endpoint 200 |
| ACI APIC | sandboxapicdc.cisco.com | reachable, **login REFUSED** (password rotated) |
| IOS XE Cat8000 | sandbox-iosxe-latest-1.cisco.com | 401 |
| IOS XE recommended | sandbox-iosxe-recomm-1.cisco.com | 401 |
| SD-WAN vManage | sandbox-sdwan-2.cisco.com | returns login HTML, not data |
| FMC | fmcrestapisandbox.cisco.com | 401 |
| Meraki | api.meraki.com | 401 (old public sandbox key dead) |
| Umbrella | api.umbrella.com | 401 (always needed an org key) |
| IOS XR | sandbox-iosxr-1.cisco.com | TIMEOUT on 443 — retired or moved |
| NSO | sandbox-nso-1.cisco.com | not RESTCONF on 443 — wrong port |
| ISE | sandboxise.cisco.com | DNS does not resolve — hostname was my guess |

**Root cause of the 401s: DevNet moved always-on labs to per-user dynamic credentials.**
Hosts are alive; the old shared passwords no longer authenticate. This is a credentials
problem, not a coverage problem. Only Vikas can fix it (credentials sit behind his login).

**BLOCKER → Vikas to supply current credentials from devnetsandbox.cisco.com**, plus the
correct hostnames for ISE and IOS XR. Not needed all at once — Catalyst Center works today.

Probe scripts: `scratchpad/probe-devnet.js`, `scratchpad/probe2.js`.
Review page (with feedback layer): https://claude.ai/code/artifact/1574877a-8607-4f3b-be98-d8f78faa4e1d

## Agent → sandbox mapping (proposed, awaiting Vikas)
Real today via Catalyst Center: **netops, monitor-eye, incident-handler, doc-writer, jarvis**.
Need credentials: **router-expert** (IOS XE), **config-keeper** (IOS XE running-config),
**firewall-pro** (FMC), **sentinel** (Umbrella).
No Cisco equivalent: **loadbal-pro** (F5 is not Cisco) — Vikas said he will explain these himself.
NEW agents to create: **aci-expert, nexus-expert, sdwan-expert, umbrella-guard, ise-expert,
meraki-expert**.

## Build shape (proposed)
One pluggable source module per sandbox behind a shared interface (the pattern NetJarvis
proved). Credentials in gitignored `.env.local` — **the repo is PUBLIC, so this is mandatory**.
An agent without working credentials must say "not connected", never invent data.
Read-only enforced in code. One sandbox per branch/PR.

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

## STAGE 5 BUILD — "fetch data from Cisco DevNet always-on sandbox" (2026-08-14)

Branch `feat/real-network-sources`. **The simulation is gone.** Every network
number the squad now says was read from a real Cisco DevNet always-on sandbox
seconds earlier, or the agent says it is not connected.

### What became real
| Agent | Source | What it answers with |
|---|---|---|
| NetOps | Catalyst Center | live switch inventory, mgmt IPs, software, reachability, health score |
| Monitor-Eye | Catalyst Center + SD-WAN | live health score, open issues, vManage alarm counts |
| Incident-Handler | Catalyst Center + ACI | open issues + real critical/major fabric faults |
| Doc-Writer | all three | writes a real inventory document from live reads |
| Router-Expert | ACI **or** SD-WAN | fabric nodes/health/tenants + tenant audit; overlay devices/controllers/vEdges/alarms |
| Config-Keeper | Catalyst Center Command Runner | real `show` output from a real switch, allowlist-guarded |
| Jarvis | all three | one live overview, per-source, with unreachable sources named |

### Still "not connected" (says so, invents nothing)
Sentinel (no CVE feed), Firewall-Pro (no FMC), LoadBal-Pro (F5 has no Cisco
sandbox). Each replies "not connected — needs sandbox credentials".

### Read-only, enforced in code
- `sources/guardrails.js` — allowlist: only `show / ping / traceroute / dir / more`,
  and any chained or state-changing keyword (`config`, `write`, `reload`, `|`, `;` …)
  is rejected. Applied by the caller **and** inside the Catalyst adapter.
- Any `configure_device` intent is refused before an adapter is touched.
- The fabricated "NetOps configuration engine" (which pretended to commit config
  to a device) and every canned BGP/F5/FortiGate/Splunk report were **deleted**,
  not left dormant — along with the hardcoded [redacted — Cisco public sandbox password] password that lived in
  the fake pre-check.

### Files
- `sources/env.js` — 12-line `.env.local` reader, no new dependency
- `sources/http.js` — shared HTTPS helper (per-request TLS relaxation)
- `sources/catalyst-center.js`, `sources/aci.js`, `sources/sdwan.js` — read-only adapters
- `sources/guardrails.js` — the read-only allowlist
- `sources/live-agents.js` — turns live reads into the chat messages the dashboard already renders
- `.env.example` — variable names only, no values
- New endpoint `GET /api/sources` — which sources are live / unreachable / not connected

### Evidence (live, this session)
```
GET /api/sources → catalyst-center live, aci live, sdwan live
NetOps      → sw1–sw4  C9KV-UADP-8P  10.10.20.175-178  17.12.1prd9  4/4 Reachable  health 100
Router-Expert (ACI)   → leaf-1, leaf-2 (N9K-C9396PX), spine-1 (N9K-C9508), apic1 · 27 tenants · health 88
Router-Expert (SD-WAN)→ Manager01, Controller01, Validator01, Edge1-4 · 3 controllers · 30 vEdges · 217 alarms
Incident-Handler      → 0 Catalyst issues · 121 critical / 5 major real ACI faults
Config-Keeper         → real `show version` from sw1 ("sw1 uptime is 29 weeks, 1 day…") via Command Runner
Sentinel/Firewall-Pro/LoadBal-Pro → "not connected — needs sandbox credentials"
NetOps "configure interface lo10" → refused, read-only, nothing sent to the device
```
Secret scan before commit: clean — no credential value or secret pattern in any
tracked file; `.env.local` absent from `git status`.

Deviations: see implementation-notes.md (to be created at build stage)

## 2026-08-15 session — merges + audit
- PR #1 merged (72026e2): debates grounded in live reads (930c2ce), ack sweep — no agent
  names a tool it doesn't have (d7e4c94), C1sco12345 redacted, stuck-active bug fixed.
  Re-reviewed by an independent agent with live evidence before merge.
- PR #2 merged (a5e4bb6): README (claims verified against code), MIT license, .gitignore
  covers scratchpad/, repo description + topics set.
- Stage 6 audit complete: 7 blockers / 14 major — worst: proven path traversal via
  /api/files/download, stored XSS via activity feed, wildcard CORS + open WS origin,
  binds all interfaces. Verdict: home-network only until fixed. Report: scratchpad/stage6-audit.md.
- Tier-1 security fix agent in flight on `fix/tier1-security` (class fixes: safeJoin,
  escape-at-every-sink, origin allowlist, 127.0.0.1 default, env SQUAD_ROOT, rate limit).
- Ship report for Vikas (writeable page): https://claude.ai/code/artifact/7fb38f85-d85d-4fc4-b9a4-069c4f9ca192

## FEATURE — "Real NOC triage" (requested by Vikas 2026-08-15, his words kept)
Rename debate → TRIAGE. An issue (P1/P2/P3) starts a real-time triage: Jarvis
pulls MANY relevant engineer-agents (not one) who each investigate from their
own front with live data. UI: chat window gets a maximize button; Live
Activity panel gets collapse/minimize. "We are building a real network center
wherein all the expert engineers are there in the form of agents."
Stage: 1-Unknowns (in progress). Build must wait for PR #3 (security) to merge
— same files. Note: Vikas reported seeing agents named "steven"/"aci" in the
UI; no such agents exist in code — to be checked with him.
