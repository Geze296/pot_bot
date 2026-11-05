# Pot Bot PRD

## Summary

Pot Bot is a Telegram bot with a Mini App that runs a weekly paid FPL classic league for a friend group. It imports the league from FPL, collects and verifies Telebirr payments, settles each gameweek on its own, and keeps the group chat fun. Version 1 serves our own group of 10 players. It is built for many groups so it can be open-sourced.

**Goals**

1. No manual winner checks: every gameweek settles from FPL data with no human input.
2. No missed or fake payments: every payment is verified against Telebirr, and nobody misses the deadline without at least three reminders.
3. One trusted record: a season ledger of who paid, who won and who is up or down, visible to everyone.
4. More fun: weekly awards and AI banter based on real FPL numbers.

**Non-goals**

- The bot never holds, sends or moves money. The coordinator still pays out the pot by hand.
- No public betting, odds or strangers joining a pot. Every league is a private group of friends.
- No FPL team management: no transfer advice and no logging in to FPL accounts.
- Head-to-head leagues are not supported in v1, only classic.

The full product design is in `docs/SPEC.md`. This PRD sets what must be built and how to know it works.

## Users and roles

There are three roles per league, and one person can hold more than one.

| Role | Who | Can do |
| --- | --- | --- |
| Owner | Whoever adds the bot to the group | Run `/setup`, import the FPL league, edit rules and persona, assign coordinators, plus everything a coordinator can do |
| Coordinator | Whoever receives the Telebirr money | Review payments, mark cash payments, override results, record payouts, schedule posts |
| Member | Each player in the FPL league | Pay, check status and stats, take part in banter and polls, opt out of roasts |

A Telegram user in the group who is not linked to an FPL manager is a **guest**. Guests can read bot messages but are not counted in the pot.

## FPL league import

The owner pastes one league link and the bot loads every manager and every past gameweek of this season, so the table, past winners and the ledger are right from day one.

**Finding the league ID:** open the classic league on the FPL website. The address looks like `fantasy.premierleague.com/leagues/123456/standings/c`, and `123456` is the league ID. The owner can paste the ID or the whole link.

**What gets imported**

| Data | FPL endpoint | Used for |
| --- | --- | --- |
| League name and all managers: team name, manager name, entry ID, rank, total | `leagues-classic/{id}/standings/` | Member list, overall table |
| Every gameweek: deadline, finished, data checked, current or next | `bootstrap-static/` (the `events` list) | Reminders, payment windows, which weeks to backfill |
| Each manager's points per gameweek, transfer cost, points on bench, chips | `entry/{id}/history/` | Past winners, net scores, season stats, Bench Boss and Hit Man awards |
| Each manager's 15 picks, captain, vice-captain, active chip | `entry/{id}/event/{gw}/picks/` | Captain Calamity, differentials, roasts |
| Every player's points in a gameweek | `event/{gw}/live/` | Captain returns, match-day pings |
| Whether bonus points and league tables are final | `event-status/` | When it is safe to settle |
| Player and club names | `bootstrap-static/` (the `elements` and `teams` lists) | Readable roasts ("Salah", not "element 328") |

**Import flow**

1. Owner runs `/setup` in the group and pastes the league link.
2. Bot loads the league and replies with the league name and the 10 managers, so the owner can confirm it's the right league.
3. The **first pot gameweek** is the next gameweek to play, found automatically from FPL, so a group can go live at any point in the season. The runner-up of the gameweek before it gets a free pass. An owner who wants earlier weeks in the table can run `/setup <league> <gameweek>`.
4. Bot backfills every finished gameweek from that point. It computes each week's net score, winner and runner-up using the league's rules, then shows a "Season so far" table for the owner to confirm or correct.
5. For past payments, the owner chooses "everyone paid, except free passes" or ticks each week by hand in a grid in the Mini App. The ledger then starts correct.
6. Bot posts a link in the group. Each member taps it, presses Start, and picks their team from buttons listing the league's managers. A team that has been claimed disappears from the list, and the owner can link or unlink anyone.

**Keeping it correct**

- Re-sync the league every hour to pick up new joiners, leavers and team-name changes. A manager who left the FPL league is flagged, not deleted.
- Never settle a gameweek until FPL says bonus points are added and league tables are updated, plus a 1-hour grace period.
- **Net score = gameweek points minus transfer cost.** The FPL data lists the two separately. Confirm against one real past gameweek in our league (does `points` already include the hit?) and lock that in a test.
- Every imported or computed number has a matching "source: fpl" or "source: manual" flag. A manual override always wins and is logged.
- All FPL calls go through the server, because FPL does not allow calls straight from a browser. Use a descriptive User-Agent, cache `bootstrap-static` for at least 5 minutes, and back off on errors. For a 10-person league, a season backfill of scores takes about 12 calls; adding picks for awards takes about 10 more per gameweek.

## Requirements

P0 is the first version our group uses. P1 follows within a few gameweeks, and P2 comes before or after open-sourcing.

### P0: must have for the first gameweek

| ID | Requirement | Done when |
| --- | --- | --- |
| L1 | `/setup` links the group to an FPL classic league by ID or link | A correct ID shows the league name and all managers within 10 seconds; a wrong ID gives a clear error |
| L2 | Season backfill from the first pot gameweek | Computed winners and runners-up match a hand check for 3 past gameweeks |
| L3 | Members claim their FPL team through a deep link and buttons | A team can be claimed only once; the owner can link and unlink anyone |
| R1 | League rules are settings: fee, prize split, runner-up perk, ties, net or gross score, late rule | Unit tests cover every option, including 2-way and 3-way ties for 1st and 2nd |
| R2 | Automatic settling | Never settles before FPL says bonus is added and leagues are updated; results post within 90 minutes of that |
| R3 | Owner or coordinator can override a score or winner | The override is logged and the group gets a "corrected result" message |
| P1 | Deferred, see "Screenshot payments" below. `/paid <transaction ID>` verifies against the Telebirr receipt page | A valid payment is verified in under 15 seconds; wrong receiver, short amount, out-of-window date, failed status or a reused ID are each rejected with the reason |
| P2 | Deferred with P1. Optional Ethiopia relay for receipt fetches | Setting `RELAY_URL` and `RELAY_SECRET` routes every receipt fetch through the relay |
| P3 | Payments that can't be read go to the coordinator | The coordinator gets a private message with the screenshot and Approve and Reject buttons, and an approved payment is then shown in the group; a screenshot that couldn't be read because of a service failure is never auto-rejected |
| P6 | Screenshot payments, in the group when the bot is mentioned and always in private chat | A successful Telebirr screenshot showing a transaction number and receiver, with the receiver matching the admin's name and an amount of at least the fee, marks the member paid. Any other image is not considered. A private screenshot is then announced and shown in the group. A reused reference is rejected. A screenshot dated after the deadline is rejected for this gameweek and counts toward the next |
| M1 | Reminders before payment close, then a participants post | Seven rounds before the deadline: 48h; 24h and 18h; 6h, 3h, 1h and 15m. Each round sends a group message @mentioning every unpaid member and a private message to each of them, and goes only to members who haven't paid. At the deadline the group gets a message listing who is participating in this gameweek |
| M2 | `/status` and `/table` | They show who paid, the pot, time to deadline, and live gameweek and overall tables |
| O1 | Data model supports many leagues in one install | Two test leagues in one database never see each other's data |

### P1: next

| ID | Requirement | Done when |
| --- | --- | --- |
| P4 | Read the transaction ID from a forwarded Telebirr SMS (screenshots moved to P6) | Correct ID from at least 9 of 10 real sample screenshots; the image is deleted after processing |
| P5 | Record the pot payout | Coordinator taps "Paid out" or sends the payout ID; group gets "pot delivered" |
| F1 | Weekly awards (Wooden Spoon, Bench Boss, Captain Calamity, Hit Man, The Genius) | Computed from FPL data and posted with the results |
| F2 | AI persona: weekly recap, sassy reminders, `/roast`, replies when mentioned | Daily cap per league enforced; template fallback with no AI key; `/nofun` respected |
| F3 | Member memory with `/me` to view and delete | A member can see and delete every stored fact about themselves |
| A1 | Mini App with Telegram login and role checks | A member can't open coordinator screens; dashboard, payments, results, members and rules screens work |
| A2 | Season ledger with CSV export | Paid in, won, and net per member match the sum of payments and payouts |
| A3 | Audit log | Every manual change shows who, what and when |
| L4 | Hourly league re-sync | A new FPL joiner appears within 1 hour; a leaver is flagged |
| O2 | One-command self-hosting | `docker compose up` with a filled `.env` runs everything |
| O3 | English and Amharic messages | Every bot message comes from `locales/en.json` or `locales/am.json` |

### P2: later

| ID | Requirement | Done when |
| --- | --- | --- |
| F4 | "Who wins this gameweek?" Telegram poll and prediction table | Season prediction accuracy shows in `/me` |
| F5 | Match-day pings for captain goals and lead changes | At most 5 pings per league per match day |
| F6 | Shareable image cards for the table, the winner and awards | Cards render with team names and no FPL logos |
| A4 | Scheduled posts and memes from the Mini App | A post goes out within 1 minute of its time |
| O4 | Pluggable payment and fantasy providers | A "cash, coordinator confirms" provider works with no Telebirr code |

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Correctness | Money and results logic lives in one pure package with unit tests; a test fixture holds real saved FPL and Telebirr responses |
| Reliability | A failed FPL or Telebirr call retries with backoff and then falls back to manual review; it never posts a wrong winner or rejects a real payment |
| Scheduling | Jobs survive restarts (stored in Postgres); every job can run twice without doing anything twice |
| Time | Store everything in UTC; show times in the league's time zone (default Africa/Addis_Ababa) |
| Security | Secrets only in `.env`; Mini App requests checked with Telegram's `initData` signature; role checks on every admin action |
| Privacy | Store transaction ID, amount, date, status and match flags only; delete screenshots after reading; members can delete their AI profile |
| Cost | Runs on one small VPS; AI calls capped per league per day; the bot works fully with no AI key |
| Spam control | Bot speaks in the group only for results, reminders, verified payments, replies and scheduled posts, within a daily cap |
| Code | TypeScript strict, ESLint and Prettier, a CI job running tests on every push |

## Release scope and success metrics

Ship P0 to our group first, run it alongside the old screenshot habit for 2 gameweeks, then switch fully.

| Release | Contents | Ready when |
| --- | --- | --- |
| v0.1, our group | All P0 | 2 gameweeks settle with no manual fix and the same winner a hand check gives |
| v0.2, our group | P1 | Every member has used `/me` or `/table` at least once |
| v1.0, open source | P2, README, licence, Docker setup | A second friend group sets it up from the README alone |

**Success metrics for our group (measured over 5 gameweeks)**

| Metric | Target |
| --- | --- |
| Payments verified automatically, no coordinator action | At least 80% |
| Members who paid before the deadline | 100% |
| Gameweeks settled with no manual override | At least 4 of 5 |
| Coordinator time per gameweek | Under 5 minutes, mostly the payout |
| Members who muted the bot or used `/nofun` | At most 1 |

## Open questions

The group should answer these before P0 rules are coded; each has a default in brackets.

- [ ] What is our FPL classic league ID? (needed for `/setup`)
- [ ] Which gameweek did we start playing for money? (the league's first gameweek)
- [ ] When does payment close: at the FPL deadline or some hours after? (at the FPL deadline)
- [ ] Score before or after transfer hits? (after hits)
- [ ] Can someone who didn't pay win? (no; the pot goes to the best paid member)
- [ ] What is the coordinator's Telebirr name and number, so receipts can be matched? (needed for P1)
- [ ] Will we host in Ethiopia, or run a relay there? (a relay on cheap Ethiopian hosting)
- [ ] Persona and language mix for the bot? (excited commentator, English with some Amharic)

## Sources

- [FPL API endpoints reference for 2026/27](https://dev.to/odeeb/fpl-api-endpoints-complete-reference-for-202627-5g3d): field lists for standings, history, picks, live and gameweeks
- [verifier-api](https://github.com/Vixen878/verifier-api): Telebirr receipt fields and the Ethiopia relay pattern
