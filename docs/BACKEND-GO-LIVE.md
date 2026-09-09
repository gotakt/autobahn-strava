# Backend go-live — the order, and why it is an order

The online leaderboard has never been live. The Firebase project `autobahn-strava` exists,
but Cloud Firestore and anonymous sign-in are disabled in it — measured on 09.09.2026:

```
POST accounts:signUp               →  CONFIGURATION_NOT_FOUND
GET  documents/entries             →  PERMISSION_DENIED — "Cloud Firestore API has not been
                                      used in project autobahn-strava before or it is disabled."
firebase firestore:databases:list  →  HTTP 403, same message
```

There is not even a database. That is good news: **there is no legacy data, no document
without an `expiresAt`, and no migration.** The first production start can be done properly
instead of repaired afterwards.

This file is the condition for doing it. It is **not** permission to switch anything on
today, and it is not a tutorial — each step exists because skipping it breaks something the
app has already promised its users in [`PRIVACY.md`](../PRIVACY.md).

Steps 1, 2 and 6 are the ones that cannot be fixed later, or that silently break a promise.
Everything else is ordinary setup.

---

## The gate

### 1. Decide the Firestore region — before the database exists

**A Firestore location cannot be changed after creation.** The only way to move is a new
project and a data migration. For an app written in German, about German Autobahn sections,
whose users are in Germany, the default US region is the wrong answer arrived at by clicking
past a dialog.

Pick a European region deliberately (`eur3` or `europe-west3`) and write the decision and
its date into this file before creating anything.

> Decision: _not yet made._

### 2. Enable billing — deliberately, because retention depends on it

`PRIVACY.md` promises that a published entry is **deleted after 180 days**. The mechanism
for that is a Firestore TTL policy, and **TTL deletions are not covered by the free tier —
Firestore requires billing to be enabled for TTL to run.**

So a Spark project with a database and auth is *not* enough to keep the promise. Either
billing is enabled, or the retention promise has to be rewritten before the backend goes
live. Those are the only two honest options; a TTL policy that never runs is the dishonest
third one.

Note that this only concerns TTL. Server-side scoring is a separate, later gate (step 10).

### 3. Create the Firestore database

In the region decided in step 1. Native mode.

### 4. Deploy the tested rules

```bash
firebase deploy --only firestore:rules
```

Deploy the rules that are in `main` and that the emulator suite passes — never a locally
edited copy. The rules are the only thing standing between a published entry and anyone
else's write access, and they are the enforcement point for the 180-day window
(`expiresAt` must be ~180 days ahead, checked in `firestore.rules`).

Rules and client belong together: publishing breaks if the client sends a field the
deployed rules do not know, and vice versa. Deploy from a checkout of the merged commit.

### 5. Enable anonymous sign-in

Identity Toolkit → Sign-in method → Anonymous. This is the identity the whole erasure path
hangs on: the rules allow `delete` only to the `uid` that created an entry, and the app
keeps that identity in `localStorage` under `as_cloud_session`.

### 6. Make sure the automatic cleanup of anonymous accounts cannot break erasure

**This is the one that would quietly contradict the app's own privacy promise.**

Firebase / Identity Platform can automatically remove anonymous accounts after 30 days.
The app's published entries live for **180 days**, and deleting them requires *that same
anonymous uid* — no other identity is allowed to.

If the account is removed at day 30, a user who comes back at day 60 can no longer delete
entries that will sit online until day 180. The right to erasure would be gone while the
data is still there. That is a self-inflicted contradiction, not an edge case.

Before going live, verify the cleanup is **off**, and record here that it was checked:

> Checked: _not yet._

If it is ever turned on, the retention window and the cleanup window have to be reconciled
first — not afterwards.

### 7. Configure TTL on `entries.expiresAt`, and wait for it to be active

Firestore → TTL → collection `entries`, field `expiresAt`. A TTL policy takes time to
become `ACTIVE`; until it is, nothing is being deleted. Verify the state rather than
assuming it, and remember that TTL deletion is eventual — documents can survive up to about
24 hours past their expiry.

The client already filters expired rows out of the board, so nobody *sees* an expired entry
either way. But "not shown" is not "deleted", and only step 7 makes the second one true.

### 8. Smoke test with two fresh identities

Not one. Two — because half of what the rules protect is *other people's* data, and a
single identity cannot exercise that.

For each identity, in order:

1. **Publish** a trip → entry appears
2. **Read** the board → both identities' entries visible
3. **Ranking** → sorted by score, and no entry with `withinLimit != true` is ranked
4. **Export** → the JSON contains that identity's own entries and nothing of the other's
5. **Delete one entry** → gone; and confirm identity B *cannot* delete identity A's entry
6. **Alles löschen** → all own entries gone, own segments show `createdBy: "geloescht"`,
   the anonymous account is gone from the auth console, and the local session key is gone
7. Re-run **Alles löschen** on the emptied identity → no crash, no new identity created

Then leave one entry alive and check back after the TTL window if you want the retention
proof end to end. That takes 180 days; note the date rather than pretending otherwise.

### 9. Only now may the documentation say "live"

Until step 8 passes, `README.md` and `PRIVACY.md` keep saying the backend is not switched
on. Changing that sentence is the **last** step, not the first — a README that announces a
service before the service works is exactly the kind of claim this repository has spent
several rounds removing.

### 10. Server-side scoring stays a separate gate

Scores are computed on the device. The rules can check that a value is physically possible
and that it belongs to the identity writing it — they cannot check that a drive happened.
Anyone can obtain anonymous accounts and submit plausible fabrications.

For a portfolio project that is fine and it is stated openly in the README. For a public
leaderboard it means: the board is **friendly competition**, and it says so, until
server-side validation exists. That is its own slice, its own proof, and its own decision
about cost — not part of switching the backend on.

---

## What this file is not

It is not a plan to go live. As of 10.09.2026 the decision is explicitly **to leave the
backend off**: as a portfolio project the repository is complete without it, and switching
it on turns a piece of code into a service with users, costs and obligations.

When that decision changes, it changes here first.
