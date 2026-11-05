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

Chosen by Claude to fit that schedule, not yet confirmed by the owner:

- Exact reminder times, counted back from the deadline: 48h; 24h and 18h; 6h, 3h, 1h and 15m.

Recommended defaults, not yet confirmed by the owner (must be settled before Milestone M2):

- Settling waits for the coordinator if a `needs_review` payment dated inside the window is still open.
- A receipt dated after the deadline goes to `needs_review` with the reason "after deadline".
