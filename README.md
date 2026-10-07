# BCP Online Playtest

Team-based online simulator for the TCCC BCP learning game.

## Architecture

- Hosting: GitHub Pages (static, build-free)
- Backend: existing Supabase project, isolated `bcp_web_*` tables
- Browser access: **RPC only** for game data; no direct SELECT/INSERT/UPDATE/DELETE on game tables
- Guest identity: server-issued random session token stored only as SHA-256 in the database
- Realtime: browser subscribes only to `bcp_web_live_signals` (room UUID + revision); actual state is refetched through an authorized RPC
- Hidden answer key: `bcp_private.*`, returned only after Round 4 through `bcp_web_get_debrief`

This intentionally avoids Supabase Anonymous Auth so the workshop can run inside the existing Free-plan project without adding auth users.

## Core game

- 7 roles: CMC, CMD-HO, CMD-PPD, CMD-NKL, CMT/LRTs-HO, CMT/LRTs-PPD, CMT/LRTs-NKL
- Admin assigns online participants to all 7 roles before start
- 4 rounds, 15 min default / round
- Twist default at 6 min remaining, controlled by scenario roadmap
- CMC sees only Big Story; site roles see Big Story + their Site Story
- Private Action Hand; cards become visible to everyone only after placement
- Multiple CHP decks per Site; game never hints how many decks/cards are required
- Card owner adds/removes own Action; all role-holders may reorder a shared deck
- Team Ready locks when all 7 confirm; timeout also locks automatically
- Metrics: Cash + Business Continuity
- Detailed scoring and answer key only after Round 4

## Static configuration

`config.js` contains the Supabase project URL and a Supabase **publishable key**. A publishable key is intended for browser use. Never put a service-role/secret key in this repository.

## Run locally

Serve the folder over HTTP (ES modules do not work reliably from `file://`):

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

Publish the repository root from the `main` branch. No build step is required.

## Security boundary

The BCP browser cannot directly read the Emily Brain tables through this app. The BCP tables have RLS enabled and direct table privileges revoked. Game mutations/state reads are handled by `bcp_web_*` RPCs, while Realtime exposes only a non-sensitive invalidation signal.

Because this shares the same Supabase project, the project-wide publishable key still identifies the same Supabase project. Other pre-existing RPCs that were deliberately granted to the `anon` role remain technically reachable by any holder of that publishable key. Sensitive Emily runtime RPCs should remain non-anon; this is an accepted Free-plan trade-off until BCP moves to a separate project.


## Production readiness

Room lifecycle, retention, presence, Admin failover, bot regressions, security boundaries, and the pre-workshop QA gate are documented in [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).
