# BCP Central Display (Facilitator / Projector)

## Starting the presentation

1. Create or join a BCP room as the **Admin**, then enable Solo Test if demonstrating without seven real participants.
2. Click **CENTRAL DISPLAY ↗** in the Admin's top navigation.
3. A new read-only browser tab opens. Move that tab to the projector/TV.
4. Click **⛶ FULLSCREEN** in the projector tab (a browser user gesture is required).
5. The display automatically refreshes from Supabase approximately every **3 seconds** and updates the countdown smoothly between responses.

**REVOKE** in Admin navigation immediately invalidates the active display capability. Opening a new Central Display also rotates the token so an older link/tab no longer has access. The display tab never stores a player/session/admin credential.

## What is shown

- Round and Scenario Set, room code, clock, pause/playing/completed state
- BC (Business Continuity), available Cash, and Ready progress
- Global Story only; the private HO/PPD/NKL brief is **not** shown
- Twist's *global* event, only after it is revealed in the game
- Shared placed Action Cards grouped by Site, with no unplayed private hand
- Safe event summaries and latest scored Round result (no hidden answer key)
- End state of the simulation

This is a **spectator surface**. It cannot add/remove/arrange Actions, Ready users, issue admin commands, disclose private cards, or reveal answer keys.

## Security and operation

- Display access is an unguessable room-specific 256-bit token. The database stores only its SHA-256 hash.
- Only room Admin may issue/revoke display capabilities.
- The viewer token is delivered in a URL **fragment**, consumed into sessionStorage, and removed from the address bar.
- The RPC checks the capability and returns a narrow read-only projection of allowed room state.
- The display is not a counted player; it sends no heartbeat to keep an abandoned room alive.
- Do not share the token-bearing link; access may be revoked at any time from Admin.
- There is a 3-second polling fallback rather than any dependence on anonymous Realtime table subscriptions.
- Fullscreen must be activated by clicking the viewer button. Browsers prohibit forced fullscreen without user interaction.

## CHP Library

Each private CHP card shows code, short English category label, and the Action count for the selected Role. Desktop hover reveals the exact official Thai name; selecting a deck exposes that Thai name in the detail heading. Labels are sourced from the authoritative BCP master workbook; translations are concise UI labels only, not replacements for official Thai CHP terminology.
