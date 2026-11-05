# Pot Bot progress

`M1` and `M2` are both milestones and PRD requirements, so this file always says "Milestone M1" or "Req M1".

## Milestones (P0)

- [x] Milestone M0: skeleton. Monorepo, Postgres on host port 5433, first migration, `/start` covered by a stubbed test (not yet tried with a real token)
- [x] Milestone M1: FPL and league import (L1, L2, L3). Tested with real fixtures and stubbed Telegram; not yet tried in a real group
- [x] Milestone M2: rules and settling (R1, R2, R3, O1). Tested with real fixtures and a simulated GW10; not yet run on a real gameweek
- [ ] Milestone M3: payments (P1, P2, P3)
- [ ] Milestone M4: reminders and status (Req M1, Req M2)

## P0 requirements

- [x] L1: `/setup` links the group to a classic league. By ID or standings link; invite links get a clear error
- [x] L2: season backfill from the first pot gameweek. Reproduces all 9 weeks from the check script; the owner's hand check of 3 weeks is still to do. Money for backfilled weeks arrives in Milestone M2
- [x] L3: members claim their team through a deep link. Owner uses `/link` (reply to a message) and `/unlink`, both audited
- [x] R1: league rules are settings. `/rules`, `/setrule`. Not built because the docs don't define how they work: season-long fee, "double or nothing", double-fee gameweeks
- [x] R2: automatic settling. A job every 15 minutes, after bonus, leagues updated and 1 hour of grace
- [x] R3: owner or coordinator override. `/override score`, `/override winner`, `/coordinator`, all audited, with a corrected result message
- [ ] P1: `/paid` verifies against the Telebirr receipt
- [ ] P2: optional Ethiopia relay
- [ ] P3: failed verifications go to the coordinator
- [ ] Req M1: reminders before payment close
- [ ] Req M2: `/status` and `/table`
- [x] O1: many leagues in one install. Two leagues in one database tested together

## Rule decisions

Confirmed by the owner:

- A tied 1st place that doesn't divide evenly: each winner gets the floor share, and the leftover birr rolls into the next pot.
- Only paid members are ranked for winner and runner-up. A free pass counts as paid.
- The payment window opens at the previous gameweek's deadline.
- A member who misses the deadline has their obligation waived: they owe nothing, can't win, and the pot is smaller.
- A member who pays early and then earns a free pass keeps the payment as a credit toward their next entry fee. It isn't counted in that gameweek's pot.
- Unpaid members are reminded both in the group (@mention) and by private message: once with 2 days left, twice with 1 day left, four times on deadline day. At the deadline the group gets a list of who is participating.
- Our league: FPL classic league 1680179 ("Office", 11 managers). On going live, the bot starts at whichever gameweek is next.
- Gameweeks before that are ignored completely: no past results or money in the bot.
- The runner-up of the gameweek before the start gets a free pass for the first one.
- If a screenshot can't be read, it goes to the coordinator's private chat with Approve/Reject buttons, and an approved payment is then shown in the group. Settling waits if one sent before the deadline is still open.
- Telebirr receipt-page verification is off for now. Payment is checked from the screenshot instead (see below).
- A screenshot dated after the deadline is rejected for this gameweek and counts toward the next one.

Screenshot payments (replaces `/paid` receipt checks for now; moves P4 into Milestone M3):

- A photo counts only if it is a successful Telebirr screenshot showing a transaction number and receiver, and the receiver matches the name the admin provides. Real screenshots show no sender name, so that can't be required. Any other image is not considered.
- The amount on a screenshot includes Telebirr's own fee (101.00 for a 100 birr payment). It must be at least the fee, and the pot counts the entry fee.
- Screenshot times have no timezone and are read in the league's time zone.
- The AI provider is Gemini (owner's decision), replacing Anthropic in the stack.
- In the group, a photo is checked only when the bot is @mentioned, in the caption or in a reply to the photo. This keeps AI costs down. Every photo sent privately to the bot is checked.
- When a member sends it privately, after the check the bot tells the group that the member paid and shows the screenshot.
- A transaction reference can be used only once (hard rule 6).

Locked by real data (league 1680179, 11 managers, 7 real hits):

- `history.points` is before hits: `sum(points) - sum(event_transfers_cost) = total_points` for every manager.
- `standings.event_total` is also before hits, so live tables must subtract `event_transfers_cost`.

Chosen by Claude to fit the agreed behaviour, not yet confirmed by the owner:

- Exact reminder times, counted back from the deadline: 48h; 24h and 18h; 6h, 3h, 1h and 15m.
- `prizeShares` is any list of percentages adding up to 100 (the docs say "70/30" and "top 3" without defining top 3). Tied places pool their shares.
- With `whoCanWin: everyone`, an unpaid winner shares only the pot actually paid in.
- With `lateRule: lose_free_pass`, a late payer can still win but can't earn a free pass.
- Starting at an explicit earlier gameweek (`/setup <league> <gw>`) records results only. The past-payment choice in the PRD needs the Mini App grid, so it moves to A1.

Known limit: if a correction takes away a free pass from someone whose early payment already moved on as credit, the credit stays on the later gameweek and they owe the corrected fee. The coordinator sorts that out by hand.

