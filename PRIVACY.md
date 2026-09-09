# Privacy design

Location histories are personal data under the **GDPR**. This app is built to minimise what
is collected, keep it on the user's own device by default, and make deletion self-service.
There is one way data leaves the device — the optional online leaderboard — and it is
described below rather than left implicit.

## What is stored on the device

- Trips and the profile are stored **in the browser's `localStorage`** on the user's own
  device, under the keys `as_trips`, `as_profile` and `as_custom_segments`.
- Per trip: mode, detected segment id, distance, duration, average / sustained speed,
  driving-quality scores, and a **downsampled speed-over-time track**.
- **The raw GPS route (lat/lon points) is never persisted** — not trimmed down, not at all.
  Once metrics are computed the coordinates are dropped, so the exact roads, home and
  destination cannot be reconstructed from stored data. This holds for local storage and for
  anything uploaded.

## What leaves the device

The app has a **shared online leaderboard**. It is **opt-in and off by default**, and even
once enabled nothing is transmitted until the user presses publish on one specific trip.

- **Uploaded for a published trip:** nickname, segment id, derived metrics (score, average
  and sustained speed, hard-braking count, distance, duration), the downsampled speed track
  (capped at 120 points), a coarse area name, and an anonymous user id. If the segment is new
  to the shared registry, its name, road type, limit and its **two endpoints** go up with it
  — that is the minimum needed to match two drives to the same stretch. What those endpoints
  are depends on the kind of segment:

  | Segment | Endpoints |
  |---|---|
  | **Curated** (the ones shipped in `segments.js`) | predefined, approximate junction coordinates — *Kreuz Hannover-Ost*, *Dreieck Hildesheim* and so on. They describe a motorway interchange, not anybody's drive, and are identical for every user. |
  | **Auto-created** (minted from a drive that matched nothing) | the first and last point of the **already privacy-trimmed** drive, and only for drives of at least 3 km. |
- **Never uploaded:** the driven path. No lat/lon of the route is sent, because none exists
  in storage to send.
- **Identity:** enabling the feature creates an anonymous Firebase identity — no email, no
  password, no profile. It lives in `localStorage` under `as_cloud_session` and is the only
  thing linking two published drives of the same person. `as_cloud_enabled` records the
  on/off switch.
- Transport is HTTPS. Access is governed by `firestore.rules`: entries are immutable once
  written, may only be written under one's own id, and may always be deleted by their
  author.

## Data-minimisation & anonymity

- **Nicknames, not real names.** A random nickname is generated on first run and can be changed.
- **First & last 500 m trimmed before** any metric or segment match is computed (on by
  default), so start and end locations are obscured. The trimming happens at recording time,
  not at display time.
- This is not absolute, and the code does not pretend otherwise: on a drive too short to
  remove 500 m from **both** ends without the two cuts meeting, `Store.trimEnds()` returns
  the samples unchanged rather than mangling them. Such a drive is short by definition, and
  it still never becomes a stored route — the coordinates are dropped either way. It also
  produces no shared segment: an auto-segment is only minted from a drive of **at least
  3 km** end to end (`MIN_SEGMENT_M`).
- **Segment comparison, not route sharing.** The leaderboard shows scores and speeds for a
  named Autobahn section — never a map of anyone's path.
- **Private by default.** New trips are private unless the user chooses to share them.

## User controls

- Toggle any trip between private and shared.
- Delete any single trip.
- **One delete action in Settings**, and it really removes everything:

  **One action, not two.** *Alles löschen* removes the local trips, the profile and
  self-created routes, **and** every entry this identity ever published, **and** the identity
  itself, **and** the recorded consent.

  The online part runs first on purpose: if it fails, nothing is deleted and you can try
  again. The other way round the identity would be gone and with it the only way to reach
  those entries.

  Until 09.09.2026 these were two separate buttons, and pressing only the local one left the
  published entries online and kept the identity — so a later drive would have been linked to
  the earlier ones.

## Retention

**A published entry expires after 180 days.** The purpose is comparing drives on the same
stretch; half a year covers that. Whoever wants to stay on the board drives again.

This is enforced in three places, because one is not enough:

1. the client writes an `expiresAt` timestamp when publishing;
2. `firestore.rules` requires it to be roughly 180 days ahead (±1 day for clock skew), so
   nobody can grant themselves a longer one;
3. expired entries are filtered out when the board is rendered — a promise that only takes
   effect once a cleanup job happens to run is not a promise.

The actual deletion is a **Firestore TTL policy on `expiresAt`**, configured once in the
console (Firestore → TTL → collection `entries`, field `expiresAt`). Until that policy is
set, expired entries still sit in the database even though nobody can see them any more.

**Measured on 09.09.2026: that policy is not set, and cannot be set yet.** Cloud Firestore
is disabled in the Firebase project `autobahn-strava` — there is no database to attach a
policy to, and no entry has ever been stored:

```
POST accounts:signUp    →  CONFIGURATION_NOT_FOUND
GET  documents/entries  →  PERMISSION_DENIED — "Cloud Firestore API has not been used in
                           project autobahn-strava before or it is disabled."
```

So the number of stored entries without an `expiresAt` is **zero**, not because they were
cleaned up but because the online leaderboard has never been reachable. The retention rules
described here take effect the day the project is switched on; setting the TTL policy is
part of switching it on, and is listed in the README roadmap so it cannot be forgotten.

An entry **without** an `expiresAt` counts as expired. That covers anything published before
this rule existed — which is the right answer, because an entry with no expiry is exactly
what this rule removes.

## Consent

Switching the online leaderboard on requires agreeing to a text that names what is
transmitted, when, for how long, and how to get rid of it. A toggle alone is not consent.

The agreement is recorded locally with a timestamp and a **version number**. If the text
changes materially the version is raised and the question is asked again — consent to an old
text is not consent to a new one. Switching the feature **off** never asks anything: a
withdrawal must not depend on anything.

## Export

**Settings → Deine Daten → Daten exportieren** writes a JSON file containing everything held
about you: profile, trips, self-created routes, the on/off state, your anonymous id, the
recorded consent, and — if you published any — your online entries fetched live from the
server. No request to anyone, no waiting period.

## Still open

- **Scores are computed on the device.** The rules can only check that a value is physically
  possible, not that it is genuine. Server-side scoring (Cloud Functions, which need the
  Blaze plan) is the fix and is not built. Until then the board is friendly competition, not
  evidence.

## Not collected

- No video / dashcam footage.
- No contacts, no advertising identifiers.
- No continuous background tracking. Inside the native app a background location watcher is
  used so a locked phone in a mount keeps recording — but it runs **only between an explicit
  Start and Stop**, and stops with the trip.
