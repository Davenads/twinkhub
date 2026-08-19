<!--
  SINGLE SOURCE OF TRUTH for guild / community context.

  Purpose: when we generate Discord messages, announcements, or any community-facing
  copy from this repo, pull the facts, brackets, and voice rules from HERE so every
  message stays consistent and accurate. CLAUDE.md points here; README links here.

  Volatile facts to re-verify before publishing: the Discord invite code (rotates)
  and any leadership roster change. 19 is the fundamental core bracket; 29 is a recent,
  growing community endorsement. The Sept 1, 2026 target is a community queue-pop event,
  NOT a bot-content date, and no 29 bot content is planned yet.
-->

# Community context — Twinks in Your Area

TwinkHub is built for and operated by the **Twinks in Your Area** WoW **Classic Era**
community. Motto: **"Here to help support the growth of Twinking in WoW Classic Era."**
This file is the canonical reference for who the community is, so message generation
never has to guess.

## Identity

- **Community name:** Twinks in Your Area. The **Discord server is the community hub**
  that ties both factions together.
- **Structure:** an umbrella community with a **guild on each faction** (the in-game
  names differ slightly by side, reproduce them exactly, do not "normalize" them):
  - **Alliance:** `<Twinks in your Area>` (plural "Twinks", lowercase "your")
  - **Horde:** `<Twink in Your Area>` (singular "Twink", capital "Your")
- **Factions:** active on **both Alliance and Horde**, so the community and the bot
  treat faction as a first-class variant, never an assumption.
- **Region / realms:** **NA**, on the **Whitemane** Classic Era connected-realm
  cluster (a PvP ruleset group Blizzard calls **PvP West**). The cluster is:
  **Whitemane, Anathema, Arcanite Reaper, Bigglesworth, Blaumeux, Fairbanks,
  Kurinnaxx, Rattlegore, Smolderweb, Thunderfury.**
- **Game version:** WoW **Classic Era** (permanent pre-TBC realms, client patch
  1.15.x). NOT Anniversary / fresh progression realms, NOT Season of Discovery, NOT
  TBC or later. (Matches the bot's content target; see README "Scope".)
- **Discord invite:** https://discord.gg/nXmMzkbTA — **may rotate / go stale**, so
  re-verify a current invite before putting it in any published message.

## People

Founders and leads (use for attribution / sign-offs where appropriate):

- **Ibe** — Founder / CFO.
- **SweatyBetty** — Co-founder / CTO / software dev (builds TwinkHub).
- **Lemonchello** — Co-founder / Head of HR.
- **Lit** — 29s lead (point person for the 29-bracket push).

Managers (no additional title):

- **Box**, **Burnerd**, **Kyl**, **Lebs** (organized the spell-coefficient data
  behind `/spellcoef`), **Penster** (also the **Jump Counsellor** — teaches advanced
  WSG jumps), **Nicta**, **Shakabrah**, **Homeo**.

## Mission

Support the growth of Classic Era twinking and revive **Classic Era low-level PvP** in
**Warsong Gulch (WSG)**. The community's **fundamental focus is the 19 bracket** (the
long-standing core); **29 is a recent, growing addition** (see Brackets). The bot
exists to lower the barrier to entry: answer the "what should I use" questions, track
the recurring in-game events, and run a donated-gear stash so new twinks can get
kitted out.

## Brackets

The community's **fundamental focus is the 19 bracket**. **29 is a recent endorsement**
(interest jumped over the last few weeks and is expected to keep growing) and Lit leads
it, but it does not displace the 19 core.

| Bracket | Community focus | Bot support today |
|---|---|---|
| **19** (10-19 WSG) | **Fundamental focus.** The long-standing flagship bracket. | **Shipped** — full content store under `data/content/19/`. |
| **29** (20-29, WSG + Arathi Basin) | **Recent, growing push.** The community is organizing a coordinated effort to get as many players as possible queuing 29 WSG for a **Queue pop**, tentatively **Sept 1, 2026** — the first one in a long time on Classic Era. | **Not in the bot, and not planned yet.** No `data/content/29/`; TwinkHub stays **19-only for now**. The content model is bracket-namespaced, so adding 29 later is purely additive. |

When writing community copy: **19 is the core.** Describe 29 as a recent, growing
community push, not as bot functionality. The **Sept 1, 2026** target is a **community
play event** (a coordinated 29 WSG queue pop), NOT a bot-content date — TwinkHub has no
29 commands or panels and none are planned yet. Keep those two things separate.

## What the bot does for the community

Three pillars (full detail in README):

1. **Data / knowledge commands** — BiS, gear, enchants, consumables, class/spec,
   talents, quests, guides, plus an `/optimize` "did you forget X" pass.
2. **Event timers** — BG Weekend, Arena Grand Master, Darkmoon Faire, STV Fishing,
   with per-guild alerts, a self-refreshing board, and DM fan-out. Schedules are
   Classic Era cadence (not Anniversary).
3. **Community Stash** — a donated-gear giveaway system (intake, browse, request,
   approve, hand-off) so members can pass twink gear down to newcomers.

---

## Comms voice guide (standing style for all community messages)

Every Discord message, announcement, or blurb generated from this repo follows these
rules unless a specific request overrides them.

**Voice**
- Informal WoW-community tone. Talk like a guildmate, not a marketing team.
- Direct and concrete. Say what a thing does and how to use it.
- Assume WoW literacy (WSG, BiS, twink, brackets, factions), no over-explaining.
- Partly informal yet organized. Keep the prose casual, but structure the info so it
  stays skimmable: bold section labels and short bullet lists for steps, specs, and
  dates. This applies especially to announcements.

**Hard formatting rules**
- **No em-dashes or en-dashes** (`—` `–`). Use commas, parentheses, or a plain
  hyphen in a sentence instead.
- **No emojis** unless the request explicitly asks for them (global rule).
- Keep single Discord messages under the 2000-character limit; split or trim rather
  than overflow.
- Use Discord markdown that renders in-client: `**bold**`, backtick `code`,
  bullet lists, and channel/role mentions where useful.

**Avoid cliche AI phrasing.** Do not use: seamless / seamlessly, empower, dive in,
streamline, at your fingertips, unlock, elevate, game-changer, robust, leverage,
delve, tapestry, testament to, navigate the landscape, "whether you're X or Y",
"look no further", "rest assured", "in today's fast-paced". Write the plain version.

**Faction and bracket accuracy**
- Never assume a single faction. If gear/quests differ by faction, say so or cover
  both. Remember the two guild names differ by side.
- Keep 19 as the core. Present 29 as a recent, growing push, never as shipped bot
  functionality, and never conflate the Sept 1, 2026 play event with a bot date.

**Attribution**
- Default to community voice (unattributed "we"). When a sign-off helps, use the
  relevant lead: bot / dev news from **SweatyBetty**, 29-bracket news from **Lit**,
  general community from **Ibe** or **Lemonchello**. Adjust on request.

---

## Reusable boilerplate (lift these into messages)

These already follow the voice rules. Re-verify the Discord invite before publishing.

**One-line blurb**
> TwinkHub is the Discord bot for Twinks in Your Area, the NA Classic Era WSG twink
> community focused on the 19 bracket, on both factions.

**Short "who we are" paragraph**
> We are Twinks in Your Area, a Classic Era twink community on both factions on the
> Whitemane realm cluster, here to help grow twinking and keep low-level PvP alive.
> Our core bracket is 19, with a recent and growing 29 push, and most of the action is
> in Warsong Gulch. TwinkHub is our bot: it answers the gear, enchant, and spec
> questions, tracks the in-game event timers, and runs a donated gear stash so new
> twinks can get set up fast.

**Bracket line**
> Core bracket: 19 (10-19 WSG). Growing: 29 (20-29 WSG and Arathi Basin).

**29 queue-pop event (tentative)**
> We are organizing a coordinated 29 push: get as many players as possible on their
> level 29s and queue WSG together for a Queue pop, tentatively Sept 1, 2026. It would
> be the first 29 pop in a long time on Classic Era. Interest has jumped over the last
> few weeks and we expect it to keep growing.

**Faction guild line**
> Find us in-game as `<Twinks in your Area>` on Alliance and `<Twink in Your Area>`
> on Horde, on the Whitemane cluster.

---

## Upkeep

- **Discord invite** rotates; refresh it here and re-verify before any published use.
- **Leadership roster** above will drift; update it when roles change.
- **29 stays out of the bot for now** (19-only, no planned commands or panels). The
  **Sept 1, 2026** date is a community play event, not a bot-content date; revisit bot
  29 content only if the guild decides to expand. When `data/content/29/` ships, move
  29 to "shipped" in the Brackets table and the README.
