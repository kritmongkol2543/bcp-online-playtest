# BCP Central Display (Facilitator / Projector)

## Starting the presentation

1. Create or join a BCP room as the **Admin**, then enable Solo Test if demonstrating without seven real participants.
2. Click **CENTRAL DISPLAY ↗** in the Admin's top navigation.
3. A new read-only browser tab opens. Move that tab to the projector/TV.
4. Click **⛶ FULLSCREEN** in the projector tab (a browser user gesture is required).
5. The display automatically refreshes from Supabase approximately every **3 seconds** and updates the countdown smoothly between responses.

**REVOKE** in Admin navigation immediately invalidates the active display capability. Opening a new Central Display also rotates the token so an older link/tab no longer has access. The display tab never stores a player/session/admin credential.

## What is shown (2026-10-09 privacy update)

- **Realtime only:** current Round, countdown timer, and the TEAM READINESS count/status.
- **Recorded results:** BC and Cash balances committed at the most recent completed round. New active Action Cards never change projector Cash.
- **ROUND HISTORY:** four round slots displaying completed rounds' BC loss, final BC, Cash spent, and high-level outcome; uncompleted rounds show PENDING or IN PROGRESS, without disclosing solutions.
- **LAST COMPLETED ROUND:** last outcome and round-level BC/Cash summary.
- **No current-site Action Cards**, Action sequences, shared TEAM RESPONSE, private hands, Site stories, live event stream, or unrevealed (or live) Twist summaries are returned to this viewer.
- The background has continuous subtle ambient motion; `prefers-reduced-motion` disables it for accessibility.

**Player visibility:** CMD/CMT members only see their own Site's Action placements/Decks while the game is in progress, with identical enforcement in `bcp_web_get_state` and the UI. CMC retains all-Site coordination. The full after-game Debrief remains available once the simulation is completed.

## Security and operation

- Display access is an unguessable room-specific 256-bit token. The database stores only its SHA-256 hash.
- Only room Admin may issue/revoke display capabilities.
- The viewer token is delivered in a URL **fragment**, consumed into sessionStorage, and removed from the address bar.
- The RPC checks the capability and returns only read-only room state, readiness, and **committed round history**, not current placements/actions/events/reservations.
- The display is not a counted player; it sends no heartbeat to keep an abandoned room alive.
- Do not share the token-bearing link; access may be revoked at any time from Admin.
- The viewer polls the allowed status every 3 seconds and animates its countdown locally between polls.
- Fullscreen must be activated by clicking the viewer button. Browsers prohibit forced fullscreen without user interaction.

## CHP Library

Each private CHP card shows code, short English category label, and the Action count for the selected Role. Desktop hover reveals the exact official Thai name; selecting a deck exposes that Thai name in the detail heading. Labels are sourced from the authoritative BCP master workbook; translations are concise UI labels only, not replacements for official Thai CHP terminology.
