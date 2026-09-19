# Standings

Live league tables, form, fixtures and scores for the Premier League, Championship, LALIGA,
Ligue 1, Bundesliga, Serie A, Champions League, Europa League and Conference League.
Plain HTML/CSS/JS — no build step.

## Run it

```bash
python3 -m http.server 8766 --directory "/Users/Mickael/Desktop/Claude Code/Standings"
```

then open http://localhost:8766. (Double-clicking `index.html` also works — the data API and
asset hosts both allow requests from `file://`.)

## What's on the page

* **Home** — the match centre: everything in play right now across the nine competitions
  (score, minute, HT/FT), then today's matches grouped by competition, then the next seven
  days of fixtures. Kick-off times are in your local time zone.
* **Tables** — one per competition (or all nine stacked). Alongside the usual columns each
  row shows **Form** (last five results in that competition, most recent on the right, hover
  for the score) and **Next** (the next fixture, or — when the team is playing right now — a
  LIVE badge with the minute and score).

## How it stays accurate

* Every table is fetched live from ESPN's public standings API on load, re-fetched every
  minute while the tab is open (every 30 seconds while a match is in play), and again
  whenever you return to the tab. There is no baked-in data. Points shown are the official
  net figure; any deduction is marked with a red superscript (e.g. `10 ⁻⁴`).
* Form, fixtures and live scores come from ESPN's month-by-month scoreboard feed
  (`js/fixtures.js`). Months already finished are cached in the browser for a day, the
  current month is re-fetched on every refresh. UEFA qualifying rounds are excluded from
  form so it reflects the league phase.
* Qualification / relegation zones and their rank ranges come from the same feed, so they
  follow whatever ESPN currently flags (including odd cases like LALIGA's split Europa
  League places).
* If the network fails, the last successful table is kept on screen and labelled
  "Offline — showing HH:MM snapshot" until a refresh succeeds.

## Design

* **Default** look follows footylogos.com: DM Sans, green-tinted off-whites, deep-green
  accent, 1px hairline panels, small tracked-out eyebrows.
* **Themed** (toggle in the header, remembered between visits) re-skins each competition in
  its own branding. Colours were taken from the official vector marks (Premier League
  `#37003c`, LALIGA `#ff4b44`, Bundesliga `#d10214`, Serie A `#1a1659`/`#0373ff`, Champions
  League `#00004b`, Europa League `#ff6900`, Conference League `#00be14`, Ligue 1 McDonald's
  `#252525`/`#ffbc0d`, EFL navy). The leagues' proprietary typefaces are not freely
  licensable, so each theme uses the closest Google Fonts stand-in (Rubik, Barlow, Archivo,
  Saira, Roboto Condensed, Montserrat, Exo 2, Nunito, Chakra Petch).
* Competition marks and club crests are hot-linked from FootyLogos
  (`assets.footylogos.com`). `js/crests.js` maps ESPN team ids to FootyLogos crests for all
  190 clubs currently in these competitions; unknown teams (new promotions, qualifiers) try a
  slug guessed from the name and fall back to ESPN's own logo.

## Files

```
index.html          shell, header, nav, footer
css/base.css        FootyLogos-style default tokens and layout
css/themes.css      per-competition brand overrides (body.themed)
js/competitions.js  the nine competitions + zone normalisation
js/crests.js        ESPN team id -> FootyLogos crest URL (generated, verified)
js/fixtures.js      scoreboard feed -> per-team form, next match, live matches, day lists
js/app.js           fetching, parsing, rendering, refresh, toggle, keyboard nav
```

Keyboard: `←` / `→` switch view. URLs are deep-linkable (`#home`, `#laliga`, `#all`).
