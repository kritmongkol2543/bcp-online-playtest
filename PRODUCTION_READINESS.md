# Production Readiness — BCP Online Playtest

Last hardening pass: 2026-10-07

## Readiness target

This application is designed for a **controlled internal BCP workshop/playtest**, not as an unrestricted public SaaS product.

Frontend: GitHub Pages  
Backend: existing Supabase project using isolated `bcp_web_*` RPCs/tables  
Realtime: non-sensitive room revision signal + authorized RPC refetch

## Session lifecycle

### Lobby

- Room code uses a 6-character ambiguity-safe random alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- Maximum active members per room: 20.
- Duplicate active display names are rejected.
- Admin assigns all 7 BCP roles.
- Game start requires all 7 roles to be assigned **and online** (bot roles in Solo Test count as available).
- Lobby with no human heartbeat for 30 minutes is automatically closed.

### Playing

- Heartbeat every 15 seconds.
- Member is shown Offline after 45 seconds without a current state heartbeat.
- Offline role recovery becomes eligible after 90 seconds.
- New users cannot join after the game starts unless Admin opens a temporary late-join window (1–10 minutes; UI default 5).
- Admin can Pause/Resume and extend the round.
- While paused, gameplay mutations are rejected by the database, not only hidden in the UI.
- If a role is handed to a replacement, active cards placed by the previous role holder are transferred to the replacement so they can continue managing that role.
- If the Admin disappears, an online human participant can claim Admin after the old Admin has been offline for more than 90 seconds.
- A playing room with no human heartbeat for 60 minutes is automatically closed.

### Explicit exit

- Leaving is a server operation, not only a local browser action.
- If other active humans remain, the member is marked left and their role becomes available for recovery.
- If Admin explicitly leaves, Admin is automatically transferred to the oldest active human participant.
- If the user is the final active human, the first leave attempt is rejected with a confirmation requirement.
- After confirmation, the room closes permanently and the same Room Code cannot be used to join again.

### Browser/tab disappears without pressing Leave

A browser cannot reliably run a final request on tab close, refresh, device sleep, crash, or network loss. Therefore the system does **not** use unload events to destructively remove a participant.

Instead:
1. heartbeat stops;
2. participant becomes Offline;
3. role can be recovered after the recovery threshold;
4. if nobody returns, housekeeping closes the room automatically.

This avoids accidentally destroying a live room during a refresh or temporary connection loss.

### Completed

- Round 4 completion changes the room to `completed`.
- No new users can join.
- Existing session tokens can view the Debrief/Answer Key.
- Realtime polling is stopped on the completed screen.
- Detailed completed-session data is retained for 30 days.

### Closed / retention

- Manually closed or abandoned rooms retain detailed rows for 7 days.
- Completed rooms retain detailed rows for 30 days.
- A Supabase pg_cron housekeeping job runs every 5 minutes.
- At retention expiry a token-free summary/tombstone is copied to `bcp_web_room_archive`, then detailed session rows are cascade-deleted.
- Archived Room Codes remain reserved so an old code is not silently reused.

## Game privacy / answer leakage

- Direct anonymous SELECT/INSERT/UPDATE/DELETE is denied for gameplay tables.
- The browser reads game state through token-checked RPCs.
- `bcp_private.*` answer keys, scenario scoring data, and QA results are not anonymous-readable.
- Realtime exposes only `bcp_web_live_signals` (room UUID + revision).
- Site source data originally contained headers such as `CHP-4 | Level 2`. Public state now strips those answer headers before the story reaches players.
- CMC receives Big Story only; Site roles receive Big Story + sanitized Site Story.
- Detailed scoring and the Answer Key remain unavailable until Round 4 completes.

## Automated regression coverage

### Scoring bots

Both Scenario Sets are run through the real scoring engine in three modes:

- **Perfect** — all correct CHP/Level/Action/Sequence.
- **Empty** — no response.
- **Reverse** — correct actions but reverse order.

Current result: all 6 scenario/mode tests pass.

Perfect-play evidence:

| Scenario Set | BC Loss per Round | Perfect Cash Cost |
| --- | --- | ---: |
| Set 1 | 0 / 0 / 0 / 0 | ฿9,155,000 |
| Set 2 | 0 / 0 / 0 / 0 | ฿6,005,000 |

With the current default Starting Cash of ฿11,000,000, Set 1 leaves ฿1,845,000 above the current perfect-play path. This supports the default as a usable playtest baseline, but does not replace human balance testing.

### Lifecycle regression

Automated regression validates:

- Admin failover.
- Explicit member Leave.
- last-participant permanent-close warning.
- confirmed permanent room close.
- public Debrief available only after a complete 4-round session.

### Operational regression

Automated regression validates:

- Pause freezes gameplay mutations at the database layer.
- late-join replacement flow.
- Role handoff.
- active card ownership transfer.
- replacement role holder can manage an inherited card.

## Remaining architectural limitation

Because this version intentionally uses the existing Supabase Free-plan project:

- the browser necessarily holds that project's publishable key;
- BCP game data itself is isolated with RPC checks and table privileges;
- however, other RPCs from other apps in the same Supabase project that were intentionally granted to `anon` remain part of the same public API surface;
- database RPCs also do not have a trustworthy client IP for strong per-IP abuse throttling.

For an internal controlled workshop this is an accepted trade-off. Before treating the application as an unrestricted internet-facing service, move BCP to a dedicated Supabase project/API boundary or add a server/edge gateway with rate limiting.

## QA gate

Before an actual workshop:

1. Open the GitHub Pages URL on at least one desktop and one mobile device.
2. Run Solo Test once from Lobby through Round 4.
3. Run a two-device check for Realtime placement, Ready, Pause/Resume, and reconnect.
4. Confirm the current Scenario/Action source data is the intended workshop version.
5. If game logic/source data changes, rerun bot + lifecycle + operational regression before the event.


## Private CHP deck play model

Current play model no longer asks players to select a response Level.

- Each Game Role has its own **private CHP Deck library**.
- A private CHP Deck contains only Action Cards that the current Role is authorized to own/use.
- Choosing a CHP Deck is a local/private browsing action only; it does not create a shared response object and does not reveal an answer.
- The player chooses individual Action Cards and places them directly onto the shared Site timeline.
- The backend automatically groups placed cards by `Site + CHP` for sequence evaluation.
- CMC can place HO cards at HO and Factory cards at PPD/NKL; site roles can place only at their own Site.
- Wrong/extra Action Cards still spend Cash. Missing required Actions and wrong sequence create BC loss under the scoring rules.
- No explicit Level penalty is asked from the player. Response adequacy is inferred from which Action Cards were actually chosen against the source-required Actions for the scenario's hidden actual Level.
- Source CHP/Level remains hidden during play and is revealed only in the final Debrief.
- Source cases that intentionally require zero Action Cards at a Level are handled as zero-loss when no Action is required.
