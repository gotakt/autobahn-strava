// Shared online leaderboard.
//
// Talks to Firebase over its REST endpoints rather than pulling in the SDK: the
// rest of this app is dependency-free and a few hundred KB of SDK to write one
// document and run two queries is a bad trade on a phone in a car.
//
// Everything here is opt-in and off by default. Nothing leaves the device unless
// the user turns the online board on *and* shares a specific trip. What gets
// uploaded is the same derived data the app already shows — metrics plus the
// trimmed speed track — never coordinates of the path. The segment's two
// endpoints go up so drives can be matched to each other; that is the minimum
// the feature cannot work without, and it is exactly what PRIVACY.md allows.

(function (global) {
  "use strict";

  const CONFIG = {
    projectId: "autobahn-strava",
    apiKey: "AIzaSyCOkJzNUB3Ho0ioMtwIGO-EQjbnXbo6nis", // public client key; rules do the enforcing
  };

  const AUTH = "https://identitytoolkit.googleapis.com/v1/accounts";
  const DB =
    `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents`;

  const KEY_SESSION = "as_cloud_session";
  const KEY_ENABLED = "as_cloud_enabled";
  const KEY_EINWILLIGUNG = "as_cloud_einwilligung";

  // ---- Einwilligung ---------------------------------------------------------
  // Fassung des Textes, dem zugestimmt wurde. Aendert sich der Text
  // inhaltlich, wird diese Zahl erhoeht und erneut gefragt — eine Zustimmung
  // zu einem alten Text ist keine Zustimmung zum neuen.
  const EINWILLIGUNG_FASSUNG = 1;

  function einwilligung() {
    try {
      return JSON.parse(localStorage.getItem(KEY_EINWILLIGUNG) || "null");
    } catch (e) {
      return null;
    }
  }

  function hatEingewilligt() {
    const e = einwilligung();
    return !!(e && e.fassung === EINWILLIGUNG_FASSUNG);
  }

  function einwilligungSetzen(ja) {
    if (!ja) {
      localStorage.removeItem(KEY_EINWILLIGUNG);
      return;
    }
    localStorage.setItem(KEY_EINWILLIGUNG, JSON.stringify({
      fassung: EINWILLIGUNG_FASSUNG,
      am: new Date().toISOString(),
    }));
  }

  // ---- Opt-in ---------------------------------------------------------------

  /** Ist die Online-Rangliste aktiv?
   *
   *  Der Schalter ALLEIN reicht nicht. Steht er auf 1 und die Einwilligung
   *  wird danach ungueltig — geloescht, kaputt, oder der Text hat eine neue
   *  Fassung —, dann ist die Antwort nein. Sonst koennte weiter hochgeladen
   *  werden, obwohl niemand mehr zugestimmt hat, und die Zusage "bei neuer
   *  Fassung wird erneut gefragt" waere wirkungslos.
   *
   *  Damit haengt jeder Upload-Pfad an dieser einen Pruefung, statt dass jeder
   *  Aufrufer daran denken muss. */
  function isEnabled() {
    return localStorage.getItem(KEY_ENABLED) === "1" && hatEingewilligt();
  }

  /** Nur der Schalter, ohne die Einwilligung — fuer die Oberflaeche, die
   *  unterscheiden muss zwischen "aus" und "an, aber Zustimmung fehlt". */
  function schalterAn() {
    return localStorage.getItem(KEY_ENABLED) === "1";
  }

  function setEnabled(on) {
    // Einschalten geht nur mit gueltiger Einwilligung. Ausschalten immer —
    // ein Widerruf darf an nichts haengen.
    if (on && !hatEingewilligt()) {
      throw new Error("Ohne Einwilligung kann die Online-Rangliste nicht eingeschaltet werden.");
    }
    localStorage.setItem(KEY_ENABLED, on ? "1" : "0");
  }

  // ---- Anonymous identity ---------------------------------------------------
  // No email, no password, no profile — just a durable id so you can delete your
  // own entries later. That id is the only thing linking two of your drives.

  function session() {
    try {
      return JSON.parse(localStorage.getItem(KEY_SESSION) || "null");
    } catch (e) {
      return null;
    }
  }

  async function signIn() {
    const s = session();
    // Tokens last an hour; refresh a few minutes early rather than on failure.
    if (s && s.expiresAt - Date.now() > 5 * 60 * 1000) return s;
    if (s && s.refreshToken) {
      try {
        return await refresh(s.refreshToken);
      } catch (e) {
        /* fall through to a fresh anonymous account */
      }
    }
    const res = await fetch(`${AUTH}:signUp?key=${CONFIG.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(describe(data, "Anmeldung fehlgeschlagen"));
    return store(data.idToken, data.refreshToken, data.expiresIn, data.localId);
  }

  /** Die BESTEHENDE Identitaet, oder ein Fehler. Legt niemals eine neue an.
   *
   *  Fuer Loeschen und Export unverzichtbar: `signIn()` faellt bei einem
   *  Refresh-Fehler auf `signUp` zurueck. Man wuerde dann die Daten einer
   *  frisch erzeugten, leeren Identitaet loeschen oder exportieren, waehrend
   *  die eigentlichen Daten unberuehrt online blieben — und haette obendrein
   *  eine zusaetzliche Kennung erzeugt, die man gerade loswerden wollte. */
  async function bestehendeSitzung() {
    const s = session();
    if (!s) throw new Error("Keine Online-Kennung auf diesem Gerät.");
    if (s.expiresAt - Date.now() > 5 * 60 * 1000) return s;
    if (!s.refreshToken) throw new Error("Die Online-Kennung ist abgelaufen und nicht erneuerbar.");
    return refresh(s.refreshToken);
  }

  async function refresh(refreshToken) {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(describe(data, "Token-Refresh fehlgeschlagen"));
    return store(data.id_token, data.refresh_token, data.expires_in, data.user_id);
  }

  function store(idToken, refreshToken, expiresIn, uid) {
    const s = {
      idToken,
      refreshToken,
      uid,
      expiresAt: Date.now() + Number(expiresIn || 3600) * 1000,
    };
    localStorage.setItem(KEY_SESSION, JSON.stringify(s));
    return s;
  }

  function describe(data, fallback) {
    const msg = data && data.error && data.error.message;
    if (msg === "ADMIN_ONLY_OPERATION" || msg === "OPERATION_NOT_ALLOWED") {
      return "Anonyme Anmeldung ist im Firebase-Projekt nicht aktiviert.";
    }
    if (msg === "CONFIGURATION_NOT_FOUND") {
      return "Die Online-Rangliste ist serverseitig noch nicht eingerichtet.";
    }
    if (msg === "TOO_MANY_ATTEMPTS_TRY_LATER") {
      return "Zu viele Versuche — bitte später erneut probieren.";
    }
    return msg || fallback;
  }

  // ---- Firestore REST value mapping ----------------------------------------
  // Firestore's REST shape is typed values; these two convert to and from it.

  /** Ein Zeitstempel, den Firestore als solchen versteht — nicht als Text.
   *  Nur so kann eine TTL-Regel darauf greifen. */
  function alsZeitpunkt(iso) {
    return { __zeitpunkt: iso };
  }

  function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (v && typeof v === "object" && typeof v.__zeitpunkt === "string") {
      return { timestampValue: v.__zeitpunkt };
    }
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    return { mapValue: { fields: toFields(v) } };
  }

  function toFields(obj) {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = toValue(obj[k]);
    return out;
  }

  function fromValue(v) {
    if (!v) return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("stringValue" in v) return v.stringValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
    if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
    return null;
  }

  function fromFields(fields) {
    const out = {};
    for (const k of Object.keys(fields)) out[k] = fromValue(fields[k]);
    return out;
  }

  async function authed(url, opts) {
    const s = await signIn();
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.idToken, ...(opts || {}).headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body.error && body.error.message) || res.statusText;
      throw new Error(`${res.status}: ${msg}`);
    }
    return res.json();
  }

  // ---- Publishing -----------------------------------------------------------

  // Push a trip to the shared board. Returns the created entry id.
  async function publishTrip(trip, segment, area) {
    // Doppelt geprueft, mit Absicht: isEnabled() deckt es bereits ab, aber
    // diese Funktion ist der einzige Weg, auf dem Daten das Geraet verlassen.
    // Eine Schranke, die nur woanders steht, kann beim naechsten Umbau
    // wegrutschen.
    if (!hatEingewilligt()) {
      throw new Error("Für die Online-Rangliste liegt keine gültige Einwilligung vor.");
    }
    if (!isEnabled()) throw new Error("Online-Rangliste ist nicht aktiviert.");

    // Dieselbe Bedingung, unter der die Oberflaeche den Knopf ueberhaupt zeigt —
    // hier noch einmal. Bis zum 08.09.2026 war die Oberflaeche die einzige
    // Schranke: ein Track-Lauf oder eine als unplausibel geflaggte Fahrt haette
    // ueber einen direkten Aufruf in der oeffentlichen Rangliste landen koennen,
    // und die Firestore-Regeln kennen weder `mode` noch `eligible`, koennen es
    // also nicht auffangen.
    if (trip.mode !== "public") {
      throw new Error("Track-Fahrten gehoeren nicht in die oeffentliche Rangliste.");
    }
    if (!trip.eligible) {
      throw new Error("Diese Fahrt ist nicht gewertet und kann nicht veroeffentlicht werden.");
    }

    const s = await signIn();

    // The segment has to exist before entries can point at it.
    await ensureSegment(segment);

    const doc = {
      segmentId: segment.id,
      uid: s.uid,
      nickname: trip.nickname,
      score: trip.score.total,
      avgKmh: Math.round(trip.avgKmh),
      sustainedKmh: Math.round(trip.sustainedKmh),
      hardBraking: trip.score.hardBrakingEvents,
      // Der Legalitaetsnachweis muss mit, sonst kann die Gegenseite ihn nicht
      // pruefen und muesste jeden Online-Eintrag ausschliessen. Immer ein
      // Boolescher Wert: auf Abschnitten ohne festes Limit ist er `false` und
      // ohne Bedeutung, weil es die Ansicht dort gar nicht gibt.
      withinLimit: trip.withinLimit === true,
      // Aufbewahrungsfrist. Die Regeln pruefen, dass sie rund 180 Tage voraus
      // liegt, damit sich niemand eine laengere ausstellt.
      expiresAt: alsZeitpunkt(global.Store.verfaelltAm()),
      distanceM: Math.round(trip.distanceM),
      durationSec: Math.round(trip.durationSec),
      // Already downsampled to <= 60 points when the trip was saved.
      speedTrack: (trip.speedTrack || []).slice(0, 120),
      area: area || null,
      roadType: segment.roadType || "autobahn",
    };

    // createdAt has to equal request.time for the rules to accept the write, so
    // it is applied as a server-side transform in the *same* commit as the
    // document. Creating first and stamping after would be rejected outright.
    const id = randomId();
    await commitCreate("entries", id, toFields(doc), "createdAt");
    return id;
  }

  function randomId() {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    const bytes = new Uint8Array(20);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    for (const b of bytes) out += abc[b % abc.length];
    return out;
  }

  // Atomic "create if absent" with a server timestamp applied in the same write.
  async function commitCreate(collection, id, fields, timeField) {
    const name =
      `projects/${CONFIG.projectId}/databases/(default)/documents/${collection}/${id}`;
    return authed(`${DB}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: [
          {
            update: { name, fields },
            updateTransforms: [{ fieldPath: timeField, setToServerValue: "REQUEST_TIME" }],
            currentDocument: { exists: false },
          },
        ],
      }),
    });
  }

  async function ensureSegment(segment) {
    const s = await signIn();
    try {
      await authed(`${DB}/segments/${encodeURIComponent(segment.id)}`, { method: "GET" });
      return; // already shared by someone
    } catch (e) {
      if (!String(e.message).startsWith("404")) throw e;
    }
    const fields = toFields({
      name: segment.name,
      autobahn: segment.autobahn,
      roadType: segment.roadType || "autobahn",
      limitKmh: segment.limitKmh === undefined ? null : segment.limitKmh,
      from: { lat: segment.from.lat, lon: segment.from.lon },
      to: { lat: segment.to.lat, lon: segment.to.lon },
      createdBy: s.uid,
    });
    await commitCreate("segments", segment.id, fields, "createdAt").catch((e) => {
      // Losing a race with another driver publishing the same segment is fine —
      // the document we wanted now exists, which is all this function promises.
      const m = String(e.message);
      if (!m.startsWith("409") && !m.includes("ALREADY_EXISTS")) throw e;
    });
  }

  // ---- Reading --------------------------------------------------------------

  // ACHTUNG: liefert die Zeilen UNGEFILTERT. Firestore kann zwei Felder nicht
  // miteinander vergleichen, also kann diese Abfrage nicht gegen das Tempolimit
  // des Abschnitts pruefen. Die Legalitaetspruefung passiert genau einmal, in
  // Store.mischeRanglisten(). Wer diese Funktion direkt benutzt, muss sie selbst
  // dort hindurchschicken.
  async function leaderboard(segmentId, sort, limit) {
    const orderField = sort === "legalSpeed" ? "sustainedKmh" : "score";
    const body = {
      structuredQuery: {
        from: [{ collectionId: "entries" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "segmentId" },
            op: "EQUAL",
            value: { stringValue: segmentId },
          },
        },
        orderBy: [{ field: { fieldPath: orderField }, direction: "DESCENDING" }],
        limit: limit || 25,
      },
    };
    const rows = await authed(`${DB}:runQuery`, { method: "POST", body: JSON.stringify(body) });
    const mine = (session() || {}).uid;
    return (rows || [])
      .filter((r) => r.document)
      .map((r) => {
        const d = fromFields(r.document.fields || {});
        return { ...d, id: r.document.name.split("/").pop(), mine: d.uid === mine, online: true };
      });
  }

  // Eine Seite Treffer fuer diese Kennung. `nach` ist der volle Dokumentname
  // des letzten Treffers der vorigen Seite.
  //
  // Ohne Blaettern endete jede dieser Abfragen bei 500. Beim Loeschen hiess
  // das: wer mehr veroeffentlicht hat, behielt den Rest online — und die
  // Kennung, mit der man ihn haette erreichen koennen, wurde danach entfernt.
  const SEITE = 300;

  async function seiteMeinerEintraege(uid, nach) {
    const q = {
      from: [{ collectionId: "entries" }],
      where: {
        fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } },
      },
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: SEITE,
    };
    if (nach) q.startAt = { values: [{ referenceValue: nach }], before: false };
    const rows = await authed(`${DB}:runQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredQuery: q }),
    });
    return (rows || []).filter((r) => r.document).map((r) => r.document);
  }

  /** Alle Dokumente dieser Kennung, ueber beliebig viele Seiten. */
  async function alleMeineEintraege(uid) {
    const alle = [];
    let nach = null;
    for (;;) {
      const seite = await seiteMeinerEintraege(uid, nach);
      if (!seite.length) return alle;
      alle.push(...seite);
      nach = seite[seite.length - 1].name;
      if (seite.length < SEITE) return alle;
    }
  }

  async function deleteEntry(id) {
    await authed(`${DB}/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Eigene Strecken im geteilten Verzeichnis. */
  async function meineSegmente(uid) {
    const rows = await authed(`${DB}:runQuery`, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "segments" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "createdBy" }, op: "EQUAL", value: { stringValue: uid },
            },
          },
          limit: SEITE,
        },
      }),
    });
    return (rows || [])
      .filter((r) => r.document)
      .map((r) => ({ ...fromFields(r.document.fields || {}), id: r.document.name.split("/").pop() }));
  }

  /** Den persoenlichen Bezug aus einer eigenen Strecke loesen.
   *
   *  Die Strecke selbst bleibt: andere Eintraege koennen darauf zeigen, und
   *  sie zu loeschen wuerde fremde Ergebnisse verwaisen lassen. Entfernt wird
   *  nur die Verknuepfung zur Kennung. Die Regeln erlauben genau diesen einen
   *  Uebergang — und danach hat man selbst keine Rechte mehr daran, was
   *  richtig ist: sie gehoert dann niemandem mehr. */
  const OHNE_URHEBER = "geloescht";

  async function segmentAnonymisieren(id) {
    const name = `projects/${CONFIG.projectId}/databases/(default)/documents/segments/${encodeURIComponent(id)}`;
    await authed(`${DB}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: [{
          update: { name, fields: { createdBy: { stringValue: OHNE_URHEBER } } },
          updateMask: { fieldPaths: ["createdBy"] },
          currentDocument: { exists: true },
        }],
      }),
    });
  }

  /** Das anonyme Firebase-Konto selbst loeschen — nicht nur die Spur davon
   *  auf diesem Geraet. Ohne das bliebe der Benutzer in der Anmeldeverwaltung
   *  stehen, und "die Kennung ist weg" waere zu stark formuliert. */
  async function kontoLoeschen(idToken) {
    const res = await fetch(`${AUTH}:delete?key=${CONFIG.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(describe(body, "Konto konnte nicht gelöscht werden"));
    }
  }

  /** Recht auf Loeschung, in Selbstbedienung.
   *
   *  Reihenfolge und Fehlerverhalten sind der eigentliche Inhalt:
   *
   *    1. bestehende Kennung holen — NIE eine neue anlegen,
   *    2. Eintraege seitenweise loeschen, bis keiner mehr da ist,
   *    3. eigene Strecken vom Urheber loesen (die Strecken bleiben),
   *    4. das anonyme Konto loeschen,
   *    5. erst ganz zum Schluss die lokale Spur entfernen.
   *
   *  Bricht es zwischendrin ab, bleibt die Kennung erhalten — sonst waere der
   *  einzige Weg zu den restlichen Daten weg. Der Fehler traegt mit, wie viel
   *  schon geloescht wurde, damit niemand faelschlich "es wurde nichts
   *  geloescht" behauptet. Erneutes Ausfuehren ist gefahrlos. */
  async function deleteAllMine() {
    const s = await bestehendeSitzung();
    let geloescht = 0;
    try {
      // Immer wieder ab vorn: geloeschte Dokumente fallen aus der Abfrage
      // heraus, die erste Seite ist also jedes Mal eine andere. Fortschritt
      // wird an den IDs gemessen, nicht an der Seitengroesse — bei 700
      // Eintraegen ist auch der zweite Durchgang wieder voll. Kommt eine Seite
      // zurueck, die nur aus schon behandelten IDs besteht, hat der Server
      // eine Anfrage angenommen ohne sie anzuwenden: abbrechen statt endlos
      // weiterzudrehen.
      let vorigeEintraege = null;
      for (;;) {
        const seite = await seiteMeinerEintraege(s.uid, null);
        if (!seite.length) break;
        const ids = seite.map((d) => d.name);
        if (vorigeEintraege && ids.every((id) => vorigeEintraege.has(id))) {
          throw new Error("Einträge lassen sich nicht löschen.");
        }
        vorigeEintraege = new Set(ids);
        for (const d of seite) {
          await deleteEntry(d.name.split("/").pop());
          geloescht += 1;
        }
      }
      // Und dasselbe fuer die eigenen Strecken. `meineSegmente` liefert
      // hoechstens `SEITE` Stueck; wer mehr angelegt hat, behielte den Rest
      // verknuepft — und "alles geloescht" waere gelogen. Der Filter ist
      // `createdBy == uid`, jede geloeste Strecke faellt also aus der
      // naechsten Abfrage heraus.
      let vorigeStrecken = null;
      for (;;) {
        const seite = await meineSegmente(s.uid);
        if (!seite.length) break;
        const ids = seite.map((x) => x.id);
        if (vorigeStrecken && ids.every((id) => vorigeStrecken.has(id))) {
          throw new Error("Strecken lassen sich nicht vom Urheber lösen.");
        }
        vorigeStrecken = new Set(ids);
        for (const seg of seite) await segmentAnonymisieren(seg.id);
      }
      await kontoLoeschen(s.idToken);
    } catch (e) {
      const fehler = new Error(e.message || String(e));
      fehler.geloescht = geloescht;
      throw fehler;
    }
    localStorage.removeItem(KEY_SESSION);
    return geloescht;
  }

  /** Alles, was diese Kennung online stehen hat — fuer den Datenexport.
   *  Rohe Dokumente, nichts weggelassen, ueber alle Seiten. */
  async function meineEintraege() {
    const s = await bestehendeSitzung();
    const docs = await alleMeineEintraege(s.uid);
    return docs.map((d) => ({ ...fromFields(d.fields || {}), id: d.name.split("/").pop() }));
  }

  global.Cloud = {
    isEnabled,
    setEnabled,
    signIn,
    publishTrip,
    leaderboard,
    deleteEntry,
    deleteAllMine,
    meineEintraege,
    meineSegmente,
    bestehendeSitzung,
    schalterAn,
    OHNE_URHEBER,
    hatEingewilligt,
    einwilligungSetzen,
    einwilligung,
    EINWILLIGUNG_FASSUNG,
    uid: () => (session() || {}).uid || null,
  };
})(typeof window !== "undefined" ? window : globalThis);
