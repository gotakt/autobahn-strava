# Autobahn Strava 🛣️

**Strava for Autobahn journeys — but the winning metric is *best legal drive*, not top speed.**

Record a drive with your phone's GPS, then compare it against other people who drove the
same Autobahn section. Instead of rewarding whoever went fastest, the leaderboard rewards
**lawful, smooth and efficient** driving.

> ⚠️ This is not a racing app. Top-speed ranking on public roads is deliberately **not**
> a feature — see [Safety & the law](#safety--the-law).

---

## What it does (MVP)

- 🔴 **Start / stop trip recording** — GPS position, time, speed, accuracy, sampled continuously.
- 🗺️ **Automatic Autobahn-segment detection** — matches your drive to a known section
  (e.g. *A2 Hannover → Braunschweig*) by start/end position and direction.
- 📈 **Speed graph + trip stats** — distance, duration, average moving speed, and a
  **sustained max** (fastest rolling 5-second average, not a single GPS spike).
- 🏆 **Same-segment leaderboard** ranked by a **Legal-Drive Score**, not by top speed.
- 👤 **Anonymous nicknames** — no real names required.
- 🔒 **Privacy controls** — trips default to private, the first & last 500 m of every route
  are trimmed before anything is measured, the raw GPS path is never stored at all, and any
  trip can be deleted. Local data and published online entries have **separate** delete
  buttons — see [Deleting things](#deleting-things).
- 🌐 **Optional online leaderboard** — off until you switch it on, and then still per trip.
- 🕵️ **GPS-cheating detection** — implausible speeds, teleport jumps and junk-accuracy
  traces are flagged and excluded from ranking.
- 🏁 **Track mode** — a separate mode where top-speed / acceleration are allowed, intended
  for **closed / private tracks only**. Track results never mix with public-road leaderboards.

Recording, scoring and storing a drive happen **client-side in the browser**; local trips
and their metrics live in `localStorage`, so the app works with no setup at all. A
**shared online leaderboard exists** on top of that — opt-in, off by default, and only ever
for a trip you explicitly publish. See [Online leaderboard](#online-leaderboard).

---

## Online leaderboard

The app ships with a shared leaderboard backed by Firebase (Firestore over its REST
endpoints — no SDK). It is **opt-in and off by default.** Nothing leaves the device until
you both

1. switch **Online-Rangliste** on in Settings, **and**
2. press **publish** on one specific trip.

**What is uploaded for a published trip:** nickname, the segment's id and — if the segment
is new to the shared registry — its name, road type, limit and its two endpoints; the
derived metrics (score, average and sustained speed, hard-braking count, distance,
duration); the downsampled speed-over-time track (≤ 120 points); a coarse area name; and an
anonymous user id.

**What is never uploaded:** the GPS path. No lat/lon of where you actually drove is sent,
because none is stored in the first place — see [`PRIVACY.md`](PRIVACY.md).

**Who you are online:** switching the feature on creates an anonymous Firebase identity —
no email, no password, no profile. It is kept in `localStorage` under `as_cloud_session`
and is the only thing linking two of your published drives to each other.

### Deleting things

There are **two separate paths**, and one does not do the other's work:

| Action | Removes | Leaves |
|---|---|---|
| **Alle lokalen Daten löschen** | local trips, profile, self-created routes | published online entries, `as_cloud_session` |
| **Meine Online-Daten löschen** | every entry this identity published, then the identity | local trips and profile |

To leave nothing behind, use both. Merging them into one button is on the list; until then
this table is the honest description.

---

## The Legal-Drive Score

A public-road drive is scored 0–100 from four components — **none of them is "who was fastest".**

| Component | Weight | Rewards |
|---|---|---|
| **Lawfulness** | 40% | Staying at/under the applicable limit; where none applies, staying near the 130 km/h *Richtgeschwindigkeit*. Exceeding a known limit is penalised hard. |
| **Smoothness** | 25% | Low jerk — gentle, steady speed changes rather than surging. |
| **Calm braking** | 20% | Few hard-braking events (strong decelerations). |
| **Efficiency** | 15% | Steady cruising speed, the fuel-friendly band. |

The leaderboard's default sort is **Legal-Drive Score ↓**. "Fastest *legal* journey" is
available as a view, but it only ranks drives that stayed within the limit.

---

## Run it

```bash
npm run serve
# → http://localhost:8123
```

Or just open `web/index.html` in a browser. On a phone, serve it over HTTPS (Geolocation
requires a secure context) — e.g. GitHub Pages or any static host.

**Recording a real drive:** press **Start before you move**, mount the phone in a holder,
and don't touch it while driving. Recording is fully automatic — see below.

---

## Safety & the law

This app is designed around German road law and the GDPR:

- **No public-road top-speed contest.** Organising or joining illegal races, and lone
  reckless driving to reach the highest possible speed, are criminal offences
  (§315d StGB). The public-road leaderboard therefore ranks *legal* driving quality only.
- **Even where no limit applies**, drivers must stay in control and adapt to traffic,
  weather, visibility and road conditions; Germany recommends **130 km/h** *Richtgeschwindigkeit*.
- **No phone-in-hand.** Start recording before departure; the app never needs to be touched
  while driving.
- **GPS speed is an estimate**, not a police-grade or legally certified measurement — the
  true speed can change between location updates.
- **Privacy by design (GDPR):** nicknames instead of names, private-by-default trips,
  first/last 500 m trimmed, no raw route stored or uploaded, self-service deletion for local
  data and for published entries (two separate actions), no video/dashcam recording.

See [`SAFETY.md`](SAFETY.md) and [`PRIVACY.md`](PRIVACY.md) for detail.

---

## Project layout

```
web/
  index.html        app shell (Record / Trips / Leaderboard / Settings)
  css/app.css       styles
  js/
    segments.js     known Autobahn sections + segment detection
    places.js       nearest coarse area name for a segment
    geo.js          GPS recording, haversine, speed & sustained-max maths
    score.js        Legal-Drive Score + hard-braking / smoothness / cheating checks
    store.js        localStorage persistence, privacy trimming, seeded demo ghosts
    cloud.js        optional online leaderboard (Firestore over REST)
    replay.js       ghost replay of your drive against a rival
    app.js          UI wiring
scripts/serve.js    tiny static server for local preview
firestore.rules     rules for the shared leaderboard
```

All eight modules under `js/` are loaded by `index.html` and all eight are in use.

## Roadmap

- **Server-side scoring and cheat validation.** The shared leaderboard exists, but scores
  are computed on the device, so the rules can only check that a value is physically
  possible — not that it is genuine. Treat the board as friendly competition.
- Optional **OBD-II** connection for higher accuracy and anti-fraud.
- Weather / traffic condition tags per trip.
- Vehicle categories.

## License

MIT — see [`LICENSE`](LICENSE).
