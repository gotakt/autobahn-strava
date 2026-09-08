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
- **Two separate delete actions in Settings**, and it matters which one is used:

| Action | Removes | Does **not** remove |
|---|---|---|
| *Alle lokalen Daten löschen* | all local trips, the profile, self-created routes | published online entries, the anonymous identity `as_cloud_session` |
| *Meine Online-Daten löschen* | every entry this identity published, then the identity itself | local trips and profile |

  Using only the local one leaves published entries online **and** keeps the identity, so a
  later published drive would be linked to the earlier ones. To leave nothing behind, use
  both. This is a known rough edge, described here rather than glossed over.

## Still open

The online leaderboard exists, so the questions below are live ones, not future ones:

- **No retention limit.** A published entry stays until its author deletes it. There is no
  automatic expiry.
- **No export.** Deletion is self-service; taking your data with you is not implemented.
- **No sign-up text.** There is no consent screen beyond the settings toggle and the note
  beside it.
- **Scores are computed on the device.** The rules can only check that a value is physically
  possible, not that it is genuine. Server-side scoring is the fix and is not built.

## Not collected

- No video / dashcam footage.
- No contacts, no advertising identifiers.
- No continuous background tracking. Inside the native app a background location watcher is
  used so a locked phone in a mount keeps recording — but it runs **only between an explicit
  Start and Stop**, and stops with the trip.
