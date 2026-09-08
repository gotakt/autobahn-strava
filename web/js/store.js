// Persistence, privacy trimming, and a seeded demo leaderboard.
//
// Everything in THIS file is local: trips and the profile live in localStorage
// and nothing here talks to a network. What is stored per trip is metrics plus
// a downsampled speed track — never lat/lon, so a stored trip cannot be turned
// back into a route.
//
// The shared online leaderboard is NOT a later step any more; it ships in
// cloud.js. It is opt-in, off by default, and uploads only when the user
// publishes one specific trip. The two are deliberately separate: local
// deletion here does not reach published entries, and Cloud.deleteAllMine()
// does not touch what is stored here.

(function (global) {
  "use strict";

  const KEY_TRIPS = "as_trips";
  const KEY_PROFILE = "as_profile";
  const H = global.Segments.haversine;

  // ---- Profile --------------------------------------------------------------

  function getProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY_PROFILE) || "null");
      if (p && p.nickname) return p;
    } catch (e) {}
    const fresh = { nickname: randomNickname(), trimEnds: true, defaultPrivate: true };
    localStorage.setItem(KEY_PROFILE, JSON.stringify(fresh));
    return fresh;
  }

  function saveProfile(p) {
    localStorage.setItem(KEY_PROFILE, JSON.stringify(p));
    return p;
  }

  function randomNickname() {
    const a = ["Ruhig", "Sanft", "Stetig", "Cruise", "Eco", "Gelassen", "Smooth", "Vernünftig"];
    const b = ["Falke", "Biber", "Luchs", "Otter", "Igel", "Dachs", "Reh", "Specht"];
    const n = 10 + Math.floor(Math.random() * 89);
    return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)] + n;
  }

  // ---- Privacy trimming -----------------------------------------------------

  // Drop the first and last `metres` of the route so home / destination aren't
  // exposed. Returns a new sample array (never mutates the input).
  function trimEnds(samples, metres) {
    metres = metres || 500;
    if (samples.length < 4) return samples.slice();

    // Trim from the start.
    let startIdx = 0;
    let acc = 0;
    for (let i = 1; i < samples.length; i++) {
      acc += H(samples[i - 1], samples[i]);
      if (acc >= metres) {
        startIdx = i;
        break;
      }
    }
    // Trim from the end.
    let endIdx = samples.length - 1;
    acc = 0;
    for (let i = samples.length - 1; i > 0; i--) {
      acc += H(samples[i - 1], samples[i]);
      if (acc >= metres) {
        endIdx = i;
        break;
      }
    }
    if (endIdx <= startIdx) return samples.slice(); // trip too short to trim safely
    return samples.slice(startIdx, endIdx + 1);
  }

  // ---- Trips ----------------------------------------------------------------

  function getTrips() {
    try {
      return JSON.parse(localStorage.getItem(KEY_TRIPS) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveTrip(trip) {
    const trips = getTrips();
    trips.unshift(trip);
    localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
    return trip;
  }

  function deleteTrip(id) {
    const trips = getTrips().filter((t) => t.id !== id);
    localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
  }

  function setTripPrivacy(id, isPrivate) {
    const trips = getTrips();
    const t = trips.find((x) => x.id === id);
    if (t) {
      t.private = isPrivate;
      localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
    }
  }

  // Remembers which online entry a trip became, so it can't be published twice
  // and so the entry can be withdrawn later.
  function setTripPublished(id, entryId) {
    const trips = getTrips();
    const t = trips.find((x) => x.id === id);
    if (t) {
      t.publishedId = entryId;
      localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
    }
  }

  function deleteAll() {
    localStorage.removeItem(KEY_TRIPS);
    localStorage.removeItem(KEY_PROFILE);
    // Self-created routes are derived from where the user drove, so "delete
    // everything" has to take them too — otherwise endpoints survive the wipe.
    localStorage.removeItem("as_custom_segments");
  }

  function newId() {
    return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Seeded demo ghosts (so the leaderboard isn't empty on first run) ------
  // These are clearly-labelled synthetic entries, not real people.
  const DEMO = [
    { segmentId: "a2-hannover-braunschweig", nickname: "GelassenOtter42", score: 94, avgKmh: 118, sustainedKmh: 129, hardBraking: 0, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a2-hannover-braunschweig", nickname: "EcoDachs17", score: 88, avgKmh: 112, sustainedKmh: 126, hardBraking: 1, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a2-hannover-braunschweig", nickname: "SmoothReh63", score: 81, avgKmh: 124, sustainedKmh: 138, hardBraking: 2, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a2-braunschweig-hannover", nickname: "RuhigFalke28", score: 90, avgKmh: 116, sustainedKmh: 131, hardBraking: 0, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a7-hannover-hildesheim", nickname: "StetigLuchs55", score: 86, avgKmh: 109, sustainedKmh: 124, hardBraking: 1, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a81-stuttgart-heilbronn", nickname: "VernünftigIgel11", score: 92, avgKmh: 108, sustainedKmh: 119, hardBraking: 0, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a7-b3-hannover-celle", nickname: "RuhigDachs31", score: 91, avgKmh: 88, sustainedKmh: 99, hardBraking: 0, withinLimit: true, mode: "public", demo: true },
    { segmentId: "a7-b3-hannover-celle", nickname: "SanftOtter08", score: 84, avgKmh: 92, sustainedKmh: 103, hardBraking: 1, withinLimit: true, mode: "public", demo: true },
    // Over the B3's 100 limit: ranks last on score, and the "schnellste legale
    // Fahrt" board filters it out entirely rather than crowning it.
    { segmentId: "a7-b3-hannover-celle", nickname: "EiligSpecht77", score: 62, avgKmh: 97, sustainedKmh: 118, hardBraking: 3, withinLimit: false, mode: "public", demo: true },
    { segmentId: "b3-a7-celle-hannover", nickname: "StetigReh44", score: 89, avgKmh: 86, sustainedKmh: 97, hardBraking: 0, withinLimit: true, mode: "public", demo: true },
  ];

  // ---- "Schnellste legale Fahrt": eine Regel, eine Stelle -------------------
  //
  // Diese Ansicht darf es nur geben, wo ein ECHTES Tempolimit gilt. Auf einem
  // unbegrenzten Abschnitt gaebe es nichts, woran "legal" sich messen liesse —
  // und die Richtgeschwindigkeit taugt nicht als Ersatz: 130 ist eine Empfehlung,
  // kein Gesetz. Sie hier als Grenze zu behandeln hiesse, eine falsche Aussage
  // durch eine andere zu ersetzen. Also wird die Ansicht dort gar nicht
  // angeboten; der Legal-Drive-Score bleibt davon unberuehrt.
  //
  // Bis zum 08.09.2026 stand diese Pruefung nur hier, und der Online-Weg lief
  // daran vorbei: Cloud.leaderboard() sortiert nur nach sustainedKmh, und der
  // Mischschritt haengte das Ergebnis ungefiltert an. Ein Eintrag mit 118 km/h
  // stand so auf Platz 1 eines 100er-Abschnitts. Deshalb liegt die Regel jetzt
  // als Praedikat hier und BEIDE Wege muessen hindurch.

  // Aus score.js bezogen, nicht noch einmal hingeschrieben: zwei Zahlen an
  // zwei Stellen laufen frueher oder spaeter auseinander. score.js wird vor
  // dieser Datei geladen (siehe index.html).
  const GPS_TOLERANZ_KMH = global.Score.GPS_TOLERANZ_KMH;

  // Mindestqualitaet, damit "schnell" nicht "ruecksichtslos" heissen kann.
  const MIN_SCORE = 70;

  /** Gibt es auf diesem Abschnitt ueberhaupt ein gesetzliches Limit? */
  function legalSpeedVerfuegbar(seg) {
    return !!(seg && typeof seg.limitKmh === "number" && seg.limitKmh > 0);
  }

  /** Darf diese Zeile in "Schnellste legale Fahrt"? Gilt fuer lokale UND
   *  Online-Zeilen — es gibt keinen zweiten Weg hinein. */
  function legalSpeedZulaessig(row, seg) {
    if (!legalSpeedVerfuegbar(seg)) return false;
    const v = row && row.sustainedKmh;
    const s = row && row.score;
    // Bewusst KEINE Umwandlung: `Number("118")` waere 118, und damit koennte
    // eine Zeile, deren Zahlen als Text ankommen, unbemerkt durchrutschen. Die
    // Firestore-Regeln verlangen `is number`, und cloud.js wandelt
    // `integerValue` selbst um — es gibt also keinen legitimen Weg, auf dem
    // hier ein Text ankaeme. Wenn doch einer kommt, ist etwas kaputt und die
    // richtige Antwort ist "nein", nicht "vielleicht".
    if (typeof v !== "number" || !isFinite(v)) return false;
    if (typeof s !== "number" || !isFinite(s)) return false;
    if (v > seg.limitKmh + GPS_TOLERANZ_KMH) return false;
    if (s < MIN_SCORE) return false;

    // Der eigentliche Nachweis. `sustainedKmh` ist ein Fuenf-Sekunden-Mittel
    // und kann eine kurze, deutliche Ueberschreitung verschlucken — gemessen:
    // 130 km/h auf einem 100er-Abschnitt, sustained-5s 101,9. `withinLimit`
    // kommt dagegen aus jedem einzelnen Sample.
    //
    // Streng auf `true`: fehlt der Nachweis, ist die Antwort nein. Das trifft
    // Eintraege, die vor dem 09.09.2026 entstanden sind — die koennen ihn
    // nicht tragen, und "wir wissen es nicht" darf in einer Liste namens
    // "legal" nicht als Ja gelten.
    return row.withinLimit === true;
  }

  /** Die LOKALEN Trip-Ids der Fahrten, die schon online stehen.
   *
   *  Steht hier und nicht in app.js, damit es pruefbar ist. Vorher baute app.js
   *  das Set selbst — aus `t.publishedId`, also aus Online-Ids — und verglich
   *  sie mit den lokalen Ids der Ranglistenzeilen. Ein stiller Dauerfehler, den
   *  keine Ansicht meldet: die eigene veroeffentlichte Fahrt stand einfach
   *  zweimal da. */
  function veroeffentlichteLokaleIds() {
    return new Set(getTrips().filter((t) => t.publishedId).map((t) => t.id));
  }

  /** Lokale und Online-Zeilen zusammenfuehren.
   *
   *  Als eigene, reine Funktion, damit der Vertrag pruefbar ist: vorher steckte
   *  das Mischen in einer DOM-gebundenen async-Funktion in app.js, und genau
   *  dort ist der Filter vergessen worden.
   *
   *  `veroeffentlichteLokaleIds`: die LOKALEN Trip-Ids der Fahrten, die schon
   *  online stehen. Eine veroeffentlichte Fahrt liegt lokal UND online vor; die
   *  Online-Fassung gewinnt, damit sie nicht doppelt zaehlt.
   *
   *  Die Betonung auf LOKAL ist der Punkt: die lokale Ranglistenzeile traegt
   *  `t.id`, das Trip-Feld `t.publishedId` traegt dagegen die ONLINE-Id. Wer das
   *  Set aus `publishedId` baut, vergleicht Online-Ids mit lokalen Ids — die
   *  treffen sich nie, und jede veroeffentlichte Fahrt stand doppelt in der
   *  Liste. Genau so war es bis zum 09.09.2026, und der erste Test dazu hat es
   *  zugedeckt, weil er die lokale Id ins Set legte statt die echte. */
  function mischeRanglisten(lokal, online, seg, sort, veroeffentlichteLokaleIds) {
    const schon = veroeffentlichteLokaleIds instanceof Set
      ? veroeffentlichteLokaleIds
      : new Set(veroeffentlichteLokaleIds || []);
    const zeilen = (lokal || [])
      .filter((r) => !r.id || !schon.has(r.id))
      .concat(online || []);

    if (sort === "legalSpeed") {
      const erlaubt = zeilen.filter((r) => legalSpeedZulaessig(r, seg));
      erlaubt.sort((a, b) => b.sustainedKmh - a.sustainedKmh);
      return erlaubt;
    }
    zeilen.sort((a, b) => b.score - a.score);
    return zeilen;
  }

  // Leaderboard for a segment: demo ghosts + this device's own eligible trips.
  // `sort`: "score" (default) or "legalSpeed" (fastest, limited to lawful drives).
  function leaderboard(segmentId, sort) {
    sort = sort || "score";
    const seg = global.Segments.byId(segmentId);

    const mine = getTrips()
      .filter((t) => t.segmentId === segmentId && t.mode === "public" && !t.private && t.eligible)
      .map((t) => ({
        id: t.id,
        segmentId: t.segmentId,
        nickname: t.nickname,
        score: t.score.total,
        avgKmh: Math.round(t.avgKmh),
        sustainedKmh: Math.round(t.sustainedKmh),
        hardBraking: t.score.hardBrakingEvents,
        withinLimit: t.withinLimit === true,
        mode: "public",
        mine: true,
      }));

    let rows = DEMO.filter((d) => d.segmentId === segmentId).concat(mine);

    if (sort === "legalSpeed") {
      // Ohne echtes Limit gibt es diese Ansicht nicht — die Oberflaeche bietet
      // sie dort gar nicht erst an, und falls doch jemand danach fragt, ist die
      // ehrliche Antwort eine leere Liste statt eines Temporankings.
      rows = rows.filter((r) => legalSpeedZulaessig(r, seg));
      rows.sort((a, b) => b.sustainedKmh - a.sustainedKmh);
    } else {
      rows.sort((a, b) => b.score - a.score);
    }
    return rows;
  }

  global.Store = {
    getProfile,
    saveProfile,
    randomNickname,
    trimEnds,
    getTrips,
    saveTrip,
    deleteTrip,
    setTripPrivacy,
    setTripPublished,
    deleteAll,
    newId,
    leaderboard,
    legalSpeedVerfuegbar,
    legalSpeedZulaessig,
    mischeRanglisten,
    veroeffentlichteLokaleIds,
    GPS_TOLERANZ_KMH,
    MIN_SCORE,
  };
})(typeof window !== "undefined" ? window : globalThis);
