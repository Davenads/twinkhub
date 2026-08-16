<!--
  SINGLE SOURCE OF TRUTH for guild / community context.

  Purpose: when we generate Discord messages, announcements, or any community-facing
  copy from this repo, pull the facts, brackets, and voice rules from HERE so every
  message stays consistent and accurate. CLAUDE.md points here; README links here.

  Volatile facts to re-verify before publishing: the Discord invite code (rotates)
  and any leadership roster change. The 29 bot-content timeline is intentionally open
  (endorsed play, no committed data/content/29/ date).
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
- **Lit** — 29s lead (point person for 29-bracket play).

Managers (no additional title):

- **Box**, **Burnerd**, **Kyl**, **Lebs** (organized the spell-coefficient data
  behind `/spellcoef`), **Penster** (also the **Jump Counsellor** — teaches advanced
  WSG jumps), **Nicta**, **Shakabrah**, **Homeo**.

## Mission

Support the growth of Classic Era twinking and revive **Classic Era low-level PvP**.
The focus is **Warsong Gulch (WSG)** for the 19 bracket and, alongside it, the 29
bracket, keeping those brackets active, well-geared, and fun on both factions. The bot
exists to lower the barrier to entry: answer the "what should I use" questions, track
the recurring in-game events, and run a donated-gear stash so new twinks can get
kitted out.

## Brackets

The community primarily endorses **two brackets: 19 and 29** (Lit leads 29s).

| Bracket | Community focus | Bot support today |
|---|---|---|
| **19** (10-19 WSG) | Primary. The flagship twink bracket. | **Shipped** — full content store under `data/content/19/`. |
| **29** (20-29, WSG + Arathi Basin) | Endorsed alongside 19. | **Not in the bot yet** — no `data/content/29/`. The content model is bracket-namespaced, so it is purely additive when it happens. **No committed timeline yet.** |

When writing community copy: it is accurate to say the community plays and endorses
both 19 and 29. It is NOT yet accurate to say the bot answers 29 gear/enchant/spec
questions. Frame 29 bot content as "coming, no date set" until `data/content/29/`
ships.

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
- Keep the 19 (shipped) vs 29 (endorsed, bot content pending) distinction correct.

**Attribution**
- Default to community voice (unattributed "we"). When a sign-off helps, use the
  relevant lead: bot / dev news from **SweatyBetty**, 29-bracket news from **Lit**,
  general community from **Ibe** or **Lemonchello**. Adjust on request.

---

## Reusable boilerplate (lift these into messages)

These already follow the voice rules. Re-verify the Discord invite before publishing.

**One-line blurb**
> TwinkHub is the Discord bot for Twinks in Your Area, the NA Classic Era WSG twink
> community running the 19 and 29 brackets on both factions.

**Short "who we are" paragraph**
> We are Twinks in Your Area, a Classic Era twink community on both factions on the
> Whitemane realm cluster, here to help grow twinking and keep low-level PvP alive.
> Our home brackets are 19 and 29, and most of the action is in Warsong Gulch.
> TwinkHub is our bot: it answers the gear, enchant, and spec questions, tracks the
> in-game event timers, and runs a donated gear stash so new twinks can get set up
> fast.

**Bracket line**
> Home brackets: 19 (10-19 WSG) and 29 (20-29 WSG and Arathi Basin).

**Faction guild line**
> Find us in-game as `<Twinks in your Area>` on Alliance and `<Twink in Your Area>`
> on Horde, on the Whitemane cluster.

---

## Upkeep

- **Discord invite** rotates; refresh it here and re-verify before any published use.
- **Leadership roster** above will drift; update it when roles change.
- **29 bot content** has no committed date. When `data/content/29/` ships, move 29
  from "endorsed" to "shipped" in the Brackets table and the README.
