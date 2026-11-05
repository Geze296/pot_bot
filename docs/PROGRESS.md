# Pot Bot progress

`M1` and `M2` are both milestones and PRD requirements, so this file always says "Milestone M1" or "Req M1".

## Milestones (P0)

- [x] Milestone M0: skeleton. Monorepo, Postgres on host port 5433, first migration, `/start` covered by a stubbed test (not yet tried with a real token)
- [ ] Milestone M1: FPL and league import (L1, L2, L3)
- [ ] Milestone M2: rules and settling (R1, R2, R3, O1)
- [ ] Milestone M3: payments (P1, P2, P3)
- [ ] Milestone M4: reminders and status (Req M1, Req M2)

## P0 requirements

- [ ] L1: `/setup` links the group to a classic league
- [ ] L2: season backfill from the first pot gameweek
- [ ] L3: members claim their team through a deep link
- [ ] R1: league rules are settings
- [ ] R2: automatic settling
- [ ] R3: owner or coordinator override
- [ ] P1: `/paid` verifies against the Telebirr receipt
- [ ] P2: optional Ethiopia relay
- [ ] P3: failed verifications go to the coordinator
- [ ] Req M1: reminders before payment close
- [ ] Req M2: `/status` and `/table`
- [ ] O1: many leagues in one install. Schema is scoped by league; isolation test comes in Milestone M2

## Rule decisions

Confirmed by the owner:

- A tied 1st place that doesn't divide evenly: each winner gets the floor share, and the leftover birr rolls into the next pot.
- Only paid members are ranked for winner and runner-up. A free pass counts as paid.
- The payment window opens at the previous gameweek's deadline.
- A member who misses the deadline has their obligation waived: they owe nothing, can't win, and the pot is smaller.
- A member who pays early and then earns a free pass keeps the payment as a credit toward their next entry fee. It isn't counted in that gameweek's pot.
- Unpaid members are reminded both in the group (@mention) and by private message: once with 2 days left, twice with 1 day left, four times on deadline day. At the deadline the group gets a list of who is participating.
- Our league: FPL classic league 1680179 ("Office", 11 managers). The bot's first pot gameweek is GW10.
- GW1-9 are ignored completely: no past results or money in the bot.
- The GW9 runner-up (Ephrem T, 67) gets a free pass for GW10, so the GW10 pot is 10 x 100 = 1,000 birr.
- Telebirr receipt-page verification is off for now. Payment is checked from the screenshot instead (see below).
- A screenshot dated after the deadline is rejected for this gameweek and counts toward the next one.

Screenshot payments (replaces `/paid` receipt checks for now; moves P4 into Milestone M3):

- A photo counts only if it is a Telebirr screenshot showing a transaction reference, sender name and receiver name, and the receiver matches the name the admin provides. Any other image is not considered.
- This applies in the group and in private chat with the bot.
- When a member sends it privately, after the check the bot tells the group that the member paid and shows the screenshot.
- A transaction reference can be used only once (hard rule 6).

Locked by real data (league 1680179, 11 managers, 7 real hits):

- `history.points` is before hits: `sum(points) - sum(event_transfers_cost) = total_points` for every manager.
- `standings.event_total` is also before hits, so live tables must subtract `event_transfers_cost`.

Chosen by Claude to fit the agreed behaviour, not yet confirmed by the owner:

- Exact reminder times, counted back from the deadline: 48h; 24h and 18h; 6h, 3h, 1h and 15m.

Still open (must be settled before Milestone M2):

- Reading a screenshot can fail, for example if the AI service is down. Recommended: it goes to the coordinator with Approve/Reject buttons, and settling waits if one sent before the deadline is still open.
