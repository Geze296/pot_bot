# Pot Bot progress

`M1` and `M2` are both milestones and PRD requirements, so this file always says "Milestone M1" or "Req M1".

## Milestones (P0)

- [x] Milestone M0: skeleton. Monorepo, Postgres on host port 5433, first migration, `/start` covered by a stubbed test (not yet tried with a real token)
- [x] Milestone M1: FPL and league import (L1, L2, L3). Tested with real fixtures and stubbed Telegram; not yet tried in a real group
- [x] Milestone M2: rules and settling (R1, R2, R3, O1). Tested with real fixtures and a simulated GW10; not yet run on a real gameweek
- [x] Milestone M3: payments (P3, P6; P1 and P2 deferred). Screenshot reading checked on real samples through live Gemini; the Telegram side is tested with a simulated Telegram
- [x] Milestone M4: reminders and status (Req M1, Req M2). Weekly cycle run once against live FPL with messages printed; not yet tried in real Telegram

## P0 requirements

- [x] L1: `/setup` links the group to a classic league. By ID or standings link; invite links get a clear error
- [x] L2: season backfill from the first pot gameweek. Reproduces all 9 weeks from the check script; the owner's hand check of 3 weeks is still to do. Money for backfilled weeks arrives in Milestone M2
- [x] L3: members claim their team through a deep link. Owner uses `/link` (reply to a message) and `/unlink`, both audited. Claims are announced in the group, and people outside it are refused
- [x] R1: league rules are settings. `/rules`, `/setrule`. Not built because the docs don't define how they work: season-long fee, "double or nothing", double-fee gameweeks
- [x] R2: automatic settling. A job every 15 minutes, after bonus, leagues updated and 1 hour of grace
- [x] R3: owner or coordinator override. `/override score`, `/override winner`, `/coordinator`, all audited, with a corrected result message
- [ ] P1: `/paid` verifies against the Telebirr receipt. Deferred at the owner's request; `/paid` now explains how to send a screenshot
- [ ] P2: optional Ethiopia relay. Deferred with P1
- [x] P3: screenshots that can't be confirmed go to the coordinator, with Approve/Reject; shown in the group if they never pressed Start
- [x] P6: screenshot payments in the group (when mentioned) and in private. `/settelebirr`, `/markpaid`, `/markunpaid`. PRD asks for 9 of 10 real samples read correctly; measured on too few so far
- [x] Req M1: seven rounds in the group (@mention) and by private message, unpaid members only, plus a participants post at the deadline
- [x] Req M2: `/status` and `/table`. The table subtracts hits and shows manual corrections, with FPL data cached for 5 minutes
- [x] O1: many leagues in one install. Two leagues in one database tested together

## P1 requirements

- [x] L4: hourly re-sync. Joiners are added and charged, leavers are flagged and stop being charged, name changes are picked up, and the group is told about joins and leaves

- [x] O2: one-command self-hosting. `docker compose up -d --build` runs the database and bot, applying migrations on start. It also serves the Mini App, and uses a webhook when `PUBLIC_URL` is set. Checked in the container up to Telegram login. Hosting is Fly.io with Aiven for the database (the owner's choice), with Render kept as a free alternative. Oracle didn't work for the owner, and Northflank disclosed a breach. Connection tested against a private certificate, and startup peaked at about 256 MB under a 512 MB cap. Not yet run on Render or Aiven. See `docs/DEPLOY.md`

- [x] P5: record the pot payout. After results, the coordinator gets a card with a Paid button per winner, or sends `/payout` then a screenshot, in private or the group, which the bot reads and shows the group; `/paidout` records one by hand. The group gets "Pot delivered". Transaction numbers must be unused, but aren't checked with Telebirr, because receipt checks are deferred

- [x] F1: weekly awards posted after the results, and again with `/awards`. Checked against real GW9 data. Awards count everyone with a score, paid or not, because no money is involved

- [x] F2: AI persona with Gemini. Recap after each gameweek, a quip added to the later reminders, `/roast` for the owner and coordinator, and replies when mentioned or replied to. `/persona` sets voice and spice. Daily cap of 30 per league, templates when there's no key, and text naming someone who sent `/nofun` is thrown away
- [x] F3: member memory. `/fact` adds a fact, and `/me` shows the member's season and facts, with buttons to delete any of them

- [ ] O3: English and Amharic messages. Dropped at the owner's request: no Amharic. The AI writes in English by default, and `am.json` stays empty

- [x] A1: Mini App with Telegram login and role checks. Dashboard, Payments, Results, Members and Rules work. Every route is tested for each role and across two leagues, and every screen was clicked through in Chrome; not yet opened inside real Telegram
- [x] A2: season ledger per member and per gameweek. Managers get the CSV in their private chat. Tested against payments and payouts, including ties, free passes and credits
- [x] A3: audit log screen for managers, showing who, what and when, with names instead of IDs

## Added at the owner's request

- [x] `/help`, in the group and in private, explaining what to do and the member commands. `/admin` lists the owner's and coordinator's commands, and only they can see it
- [ ] The bot's replies in a group were deleted after 10 minutes. Removed at the owner's request: messages now stay

- [x] Telegram's `/` menu lists the commands, with the manager ones for group admins. `/owe` says what you owe and who to send it to

- [x] Mini App: a Table tab with live gameweek scores after hits and the overall table, and a How to pay card on the Dashboard while you owe

- [x] Mini App: Send me the screenshot on the review queue. Keeps Telegram's file reference, never the image, only while a payment is under review, and clears it once decided

- [x] Mini App: hall of fame and shame on the Ledger: most wins, biggest win, most runner-up finishes, longest run without a win

## Review before going live

A strict review of money, repeat runs and security fixed: moved FPL deadlines, credit stacking on a covered fee, chat using up the AI allowance, webhook errors being re-sent by Telegram, a group's chat ID changing on upgrade, anonymous admins becoming owner, mistyped IDs of huge public leagues, payout numbers being reusable as payments, claiming a team that left, manual scores losing bench and overall points, and a lost "settling is waiting" message.

Left as is, on purpose:

- Awards aren't recalculated after a correction. They carry no money.
- A correction that takes away a free pass can leave credit on a later gameweek. The coordinator sorts that out by hand.
- `initData` can be reused for 24 hours if someone steals it from a person's device. That's Telegram's standard model.
- A hand-typed `/paidout` number isn't checked with Telebirr, because receipt checks are deferred.

## Rule decisions

Confirmed by the owner:

- A tied 1st place that doesn't divide evenly: each winner gets the floor share, and the leftover birr rolls into the next pot.
- Only paid members are ranked for winner and runner-up. A free pass counts as paid.
- The winner and the runner-up both skip the next gameweek's fee. With 10 players that makes an 800 birr pot. Everyone tied for 1st or 2nd gets a pass, so a tie can make it 700.
- The coordinator collects the money, and in our league also plays (Kibrom, as KB Gselassie). Their fee is counted as paid automatically and stays in the pot. They're never reminded and nothing is posted about it. If they win or share a win, their share counts as delivered, with no payout request or "Pot delivered".
- The payment window opens at the previous gameweek's deadline.
- A member who misses the deadline has their obligation waived: they owe nothing, can't win, and the pot is smaller.
- A member who pays early and then earns a free pass keeps the payment as a credit toward their next entry fee. It isn't counted in that gameweek's pot.
- Unpaid members are reminded both in the group (@mention) and by private message: once with 2 days left, twice with 1 day left, four times on deadline day. At the deadline the group gets a list of who is participating.
- Our league: FPL classic league 1680179 ("Office", 11 managers). On going live, the bot starts at whichever gameweek is next.
- Gameweeks before that are ignored completely: no past results or money in the bot.
- The winner and runner-up of the gameweek before the start get a free pass for the first one.
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

Chosen by Claude for screenshots, not yet confirmed by the owner:

- Only screenshots that can't be confirmed go to the coordinator. Clear ones pass automatically.
- A receipt dated before any payment window goes to the coordinator, in case it's an old screenshot reused.
- A screenshot dated before the deadline but sent after it still counts, until the gameweek settles.
- A payment for a fee that's already covered moves on as credit toward the next one.
- An unpaid member who posts a photo with no mention gets one reminder per gameweek.
- The AI reads at most 100 screenshots per league per 24 hours; after that they go to the coordinator.

Chosen by Claude for reminders, not yet confirmed by the owner:

- Someone with a payment waiting on the coordinator isn't reminded.
- After downtime, only the latest round is sent, not the ones missed.
- The participants post also lists anyone still waiting on the coordinator, and the pot.
- A private reminder that fails, usually because the person never pressed Start, isn't retried. They still get the group mention.

Chosen by Claude for the re-sync, not yet confirmed by the owner:

- A leaver's unpaid fee is cancelled. A fee they already paid stands, so they can still win that gameweek; the coordinator can `/markunpaid` it.
- A joiner owes the fee for the gameweek open at the time, as long as its deadline hasn't passed.

League 1680179 went from 11 to 10 managers on 2026-11-05, while this was being built; the 11-manager fixture is a snapshot.

Locked by real data (league 1680179, 11 managers, 7 real hits):

- `history.points` is before hits: `sum(points) - sum(event_transfers_cost) = total_points` for every manager.
- `standings.event_total` is also before hits, so live tables must subtract `event_transfers_cost`.

Chosen by Claude to fit the agreed behaviour, not yet confirmed by the owner:

- Exact reminder times, counted back from the deadline: 48h; 24h and 18h; 6h, 3h, 1h and 15m.
- `prizeShares` is any list of percentages adding up to 100 (the docs say "70/30" and "top 3" without defining top 3). Tied places pool their shares.
- With `whoCanWin: everyone`, an unpaid winner shares only the pot actually paid in.
- With `lateRule: lose_free_pass`, a late payer can still win but can't earn a free pass.
- Starting at an explicit earlier gameweek (`/setup <league> <gw>`) records results only. The past-payment choice in the PRD needs the Mini App grid, so it moves to A1.

Chosen by Claude for the Mini App, not yet confirmed by the owner:

- Members see the dashboard, results and ledger, including everyone's balances, because the SPEC calls for one trusted record visible to everyone. Payments, Members, Rules and Audit are for the owner and coordinator.
- Pausing a member takes effect from the next gameweek's fee. What they already owe or paid stays.

Known limit: if a correction takes away a free pass from someone whose early payment already moved on as credit, the credit stays on the later gameweek and they owe the corrected fee. The coordinator sorts that out by hand.

