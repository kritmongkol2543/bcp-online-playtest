# Production Readiness — BCP Online Playtest

Last hardening pass: 2026-10-08

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
- Detailed scoring and the Answer Key remain unavailable until Simulation completes (normally Round 4, or early defeat at BC = 0).

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

## Project-fit / playtest changes (2026-10-08)

- **Authoritative loss:** BC = 0 marks the Simulation completed immediately, even if it were to happen before Round 4. Current default 100 BC and maximum 30 loss per round ordinarily make this possible only by Round 4.
- **Round Consequence:** the next screen includes BC loss, Cash Used, BC Remaining, and Crisis Outcome, without revealing required Actions during gameplay. The game timer for the new round starts as soon as the previous round is scored; the panel explicitly discloses that timing. Server-side intermission/ready-to-resume is a possible later improvement but has not been implemented.
- **Debrief & Replay:** after completion, an RPC provides scored CHP/Level, expected Action sequences, Missing/Wasted/Extra, actual placement/reorder/remove history with actor names, and cost comparison. The browser reconstructs active Action placement from the event log.
- **Feedback:** role holders may submit 1–5 ratings for Rules Clarity, Engagement, BCP Realism, Balance, and Collaboration, plus optional comments, through token-authorized RPC. One record per member per room; resubmission updates that record. Direct table grants are revoked from anon and RLS is enabled.
- **Timer:** client-side alerts at 60/30/10 seconds; no audiovisual warning is required.
- **Solo UX:** virtual participant rows are labelled TEST rather than suggesting autonomous AI Bot behavior.
- **Cash rule unchanged:** playing an Action debits Cash immediately; removing it does not refund Cash. Round Cash Used reporting now includes removed charged placements so it matches the debit ledger. Whether to move to reservation-and-commit is an unresolved game-rule decision.
- **Testing:** 8/8 automated bot/lifecycle/operations regressions passed; an isolated disposable room verified BC=0 early terminal outcome and submission/aggregation of playtest feedback. Browser-rendered multi-device tests still required.

## Solo Test manual round completion (2026-10-08)

Admin of a Solo Test room with exactly seven virtual role holders can use **All Ready · End Round** in the Team panel, regardless of the currently selected virtual role. The action atomically marks all seven virtual roles Ready, executes the existing authoritative round scorer, and advances the game or opens the final Debrief. No Action Card is auto-filled, and skipped/missing/wasted Actions are penalized by the ordinary rule system.

If that scripted round contains an unrevealed Twist, this shortcut refuses to lock the round. The Admin can press **Reveal Twist Now** first (no need to wait for the countdown), adjust Actions after seeing the Twist, then press All Ready. Rounds without Twist can be ended immediately. A confirmation dialog warns that locking cannot be undone and that all real placements are scored.

The two RPCs, `bcp_web_solo_reveal_twist_now` and `bcp_web_solo_all_ready_and_lock`, require an active admin token, an active and unpaused Solo Test room, and all seven roles assigned to active virtual (is_bot) members. These checks are enforced server-side; regular human multiplayer rooms cannot invoke the shortcuts even if the UI is modified. No gameplay/source scoring changes were made.

## Cash lifecycle — Reserve / Release / Commit (2026-10-09)

This rule replaces the former nonrefundable-on-placement behavior.

- **Committed Cash** (`room.cash_remaining`) changes only at the server-authoritative round lock. It carries over into subsequent rounds.
- **Reserved Cash** is the sum of non-removed `bcp_web_placements` for the *currently playing* round.
- **Available Cash** = Committed Cash − Reserved Cash. The UI uses this balance to prevent over-allocation before a round lock.
- **Place a card**: creates/reactivates an active placement; checks funds against Available Cash under a `FOR UPDATE` row lock on the room; Committed Cash remains unchanged.
- **Remove before lock**: sets `removed_at`, releases its reservation immediately and restores Available Cash. Multiple removals do not refund twice.
- **Re-place**: checks availability again, including when reactivating a previously removed placement.
- **Lock / All Ready / Timeout**: the scoring procedure sums only placements still active, commits their Cash cost exactly once, stores `cash_used_round` and `cash_after`, and advances or completes the game transactionally.
- Both `bcp_web_play_action_direct` and legacy `bcp_web_play_action` use the same reservation guard.
- The player UI and Central Display expose `cash_available`, `cash_reserved`, and `cash_committed` separately, while `cash_remaining` remains the authoritative committed balance.
- Previous completed rounds were intentionally not retroactively changed. At migration, any previous immediate charges within **playing** rounds were restored into Committed Cash once; those rounds now obey the reserve model going forward.
- Regression QA: six scenario bot checks, operational, lifecycle; plus a disposable Solo Test round proving place → remove → re-place → round lock and a low-budget case proving over-allocation is refused.

## Role-private site timelines and historical Central Display (2026-10-09)

- **During active gameplay:** CMD_HO/CMT_HO only see HO Action placements and HO Decks; CMD_PPD/CMT_PPD only see PPD; CMD_NKL/CMT_NKL only see NKL. CMC retains the all-site timeline because its role coordinates the incident response. Solo Test role switching applies the selected role's visibility. Enforced by `bcp_web_get_state` RPC and mirrored in the UI. Live sync notifications do not contain Action details.
- **Central Display is a retrospective scoreboard, not a surveillance screen.** The `bcp_web_get_display_state` RPC exposes only room/clock/current-round fields, team Ready status, and previous finalized round results. No `story`, `actions`, `events`, Cash reservations, site placement details, private hand, or Twist data are returned.
- **Cash/BC on projector** use server-committed values after a round is locked, never speculative Action placement amounts. Player-facing Available/Reserved Cash stays fully functional on the role screen.
- **Realtime projector elements:** countdown clock, current round, and team Ready progress (via 3-second polls and local clock interpolation). New historical result cards appear when rounds are scored and finalized.
- **Motion design:** ambient navy/cobalt/gold glows drift continuously on the projector using transform-only CSS; `prefers-reduced-motion` disables the ambient animations.
- **Regression coverage:** SQL integration asserts role isolation across two sites and CMC oversight, no projector current-round leaks, and committed Cash only after lock. Automated Node/Chromium checks assert Site-only UI, no `TEAM RESPONSE` or `LIVE EVENT FEED`, and responsive projector history cards at 4 viewport sizes.

## Admin Override — Live Human & Solo Test (2026-10-09)

The room administrator may issue three commands while a Simulation is playing, regardless of whether the 7 role holders are human or virtual:

1. **REVEAL TWIST NOW:** reveal the source-defined Twist early; resets player Ready as normal. If no Twist exists, the RPC returns NO_TWIST_THIS_ROUND.
2. **ALL READY · END ROUND:** mark all 7 assigned Role holders Ready in one atomic transaction, reveal an outstanding scripted Twist if necessary, and run canonical round scoring. Cash is committed and BC deductions apply to the Action Cards actually placed, including missing Actions. Advances normally unless Round 4 or BC=0.
3. **FORCE FINISH GAME:** same scoring and Ready operation, then complete the Simulation after the current Round, even before Round 4. The debrief answer key is restricted to played/scored rounds. This is distinct from closing/deleting the room.

These Admin commands work for a real-room Host who holds no participant Role. A confirmed Finish requires typing FINISH. Paused rooms can be ended: the RPC clears pause state and the canonical scorer initializes the next round's timer, or completes the game. The server enforces Admin authorization using the Admin token, room-level row locking, 7 assigned active roles, explicit audit events, and the existing Twist/BC/Cash score model. Users without Admin access cannot invoke the RPC even by editing the client code.

Database API: `public.bcp_web_admin_override(room_id, session_token, action)`; action is `reveal_twist`, `end_round`, or `finish_game`. The legacy Solo-only RPCs remain server-side for backward compatibility but the frontend now uses this Admin-wide API.

QA includes: 7 real human role holders with 0/7 Ready; non-admin denial; 7/7 forced Ready and lock; manual/automatic Twist; early completion in Round 2 with only two scored rounds and matching debrief; paused-room override and next-round clock restoration. Existing 8/8 scoring/operational/lifecycle regression tests also pass.

## Role acceptance / document-based CHP guides (2026-10-09)

Sources: internal TCCC BCP Basic Plan v1.0 (June 2569), sections 5.1–5.4; and Crisis Handling Procedures v1.0 (June 2569), CHP-1 through CHP-14. The original DOCX files are **not** committed into the publicly accessible GitHub Pages repository.

**Human Role invitation protocol:** Admin selects an attendee for one of seven Roles → this creates `pending_role_key`, not `role_key` → Admin sees `WAITING FOR CONFIRMATION` and 0/7 (or actual count) of confirmed Roles → recipient sees an in-app responsibilities dialog based on Basic Plan, including game-specific site communication expectations → recipient presses `ACCEPT ROLE` → `bcp_web_confirm_role` atomically assigns `role_key`, records time and event → Admin sees `CONFIRMED` with member name. Game startup remains blocked until all seven role keys have been accepted. Reassignment clears the prior pending invitation. Solo Test bots are created with preassigned Roles for test compatibility and require no confirmation.

**Document and privacy controls:** 3 role-type descriptions (CMC, CMD, CMT/LRTs) and 14 CHP descriptions are stored in `bcp_private.web_training_guides`, not in the frontend source. The role description is provided only to the invitation recipient within `bcp_web_get_state`; pending assignments of other players are exposed to Admin only. CHP information requires a valid room member's session token, `playing` status, and a confirmed participant Role. Every private CHP Deck has an independent upper-right ⓘ button to open a responsive, keyboard-accessible information modal with a source label. CHP guides describe the organization's preparedness/response principles but **never return answer-key Action IDs, hidden Scenario CHP assignments, or exact sequence**.

Key APIs: `bcp_web_assign_role` (invitation), `bcp_web_confirm_role` (recipient acknowledgement), `bcp_web_get_state` (pending invitation for self/Admin), `bcp_web_get_chp_guide` (authenticated in-game CHP reference). Security checks use the same room membership token and row-level locking for atomic assignment. The backend tracks `role_accepted_at` and logs `role_invited` / `role_accepted` events.

Regression: pending Roles do not count toward game start; 7 genuine human recipients must each acknowledge; revoking/reassigning an invitation invalidates the previous recipient's claim; CHP information cannot be read by a pending member; legacy bot scoring, role-isolation and lifecycle tests remain green.
