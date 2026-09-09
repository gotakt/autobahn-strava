/**
 * Das Recht auf Loeschung, der Export und die Frage, wann ueberhaupt etwas
 * hochgeht.
 *
 * Diese vier Zusagen standen am 09.09.2026 im Code, aber keine war geprueft.
 * Beim Nachmessen kamen genau die Faelle heraus, die man von Hand nie
 * ausprobiert, weil sie erst ab einer gewissen Menge oder nur bei einem
 * Abbruch auftreten:
 *
 *   1. Der Schalter allein darf nichts hochladen — die Einwilligung
 *      entscheidet, und ein Widerruf muss sofort greifen.
 *   2. "Alles loeschen" muss ueber mehr als eine Seite gehen. Firestore
 *      liefert hoechstens `SEITE` Dokumente je Abfrage.
 *   3. Bricht es in der Mitte ab, darf die Kennung NICHT verschwinden — sonst
 *      ist der Weg zu den restlichen Daten weg und der Rest bleibt fuer immer
 *      online. Und der Fehler muss mittragen, wie viel schon weg ist.
 *   4. Zum Loeschen gehoert das anonyme Firebase-Konto selbst, nicht nur die
 *      Spur davon auf diesem Geraet.
 *
 * Gearbeitet wird gegen ein `fetch`, das die REST-Schnittstelle nachstellt und
 * jede Anfrage mitschreibt. Das ist Absicht: geprueft werden soll nicht nur
 * das Ergebnis, sondern die REIHENFOLGE — welche Anfrage vor welcher kam, und
 * wann die lokale Spur faellt.
 *
 * Start:  npm test
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.window = globalThis;
globalThis.localStorage = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
for (const m of ["segments", "geo", "score", "store", "cloud"]) {
  require(join(WURZEL, "web", "js", `${m}.js`));
}
const { Cloud } = globalThis;

const KEY_SESSION = "as_cloud_session";
const KEY_ENABLED = "as_cloud_enabled";
const SEITE = 300; // muss zu cloud.js passen; unten wird das mitgeprueft

/** Eine gueltige, noch lange laufende Sitzung im Speicher ablegen. */
function sitzungAnlegen(uid = "uid-1") {
  localStorage.setItem(KEY_SESSION, JSON.stringify({
    idToken: "TOKEN-A", refreshToken: "R", uid, expiresAt: Date.now() + 3600e3,
  }));
}

/** Ein Firestore-Dokument, wie `runQuery` es zurueckgibt. */
function dok(i, uid = "uid-1") {
  return {
    document: {
      name: `projects/autobahn-strava/databases/(default)/documents/entries/e${String(i).padStart(4, "0")}`,
      fields: { uid: { stringValue: uid }, score: { integerValue: "90" } },
    },
  };
}

/**
 * Ein `fetch`, das die benutzten Endpunkte nachstellt.
 *
 * `eintraege` ist der Serverzustand: eine Menge von Ids. DELETE nimmt daraus
 * weg, `runQuery` liest daraus — damit bildet der Mock den Ablauf wirklich ab,
 * statt nur Zaehler zu vergleichen. `stolpert` laesst genau eine Anfrage
 * scheitern.
 */
function netz({ eintraege = [], segmente = [], stolpert = null } = {}) {
  const serverEintraege = new Set(eintraege);
  const serverSegmente = new Map(segmente.map((s) => [s, "uid-1"]));
  const anfragen = [];

  async function fetchMock(url, opt = {}) {
    const koerper = opt.body ? JSON.parse(opt.body) : null;
    anfragen.push({ url: String(url), methode: opt.method || "GET", koerper });

    if (stolpert && stolpert(anfragen.length, String(url), opt)) {
      return { ok: false, status: 500, json: async () => ({ error: { message: "SERVER_KAPUTT" } }) };
    }

    if (String(url).includes(":runQuery")) {
      const q = koerper.structuredQuery;
      const art = q.from[0].collectionId;
      if (art === "segments") {
        const treffer = [...serverSegmente].filter(([, wer]) => wer === "uid-1").map(([id]) => id);
        return json(treffer.slice(0, q.limit).map((id) => ({
          document: {
            name: `projects/autobahn-strava/databases/(default)/documents/segments/${id}`,
            fields: { createdBy: { stringValue: "uid-1" } },
          },
        })));
      }
      // entries, nach __name__ sortiert, mit Cursor
      let ids = [...serverEintraege].sort();
      const nach = q.startAt && q.startAt.values[0].referenceValue;
      if (nach) ids = ids.filter((id) => id > nach);
      return json(ids.slice(0, q.limit).map((id) => ({
        document: { name: id, fields: { uid: { stringValue: "uid-1" } } },
      })));
    }

    if (opt.method === "DELETE") {
      const id = decodeURIComponent(String(url).split("/entries/")[1]);
      for (const n of serverEintraege) if (n.endsWith(`/entries/${id}`)) serverEintraege.delete(n);
      return json({});
    }

    if (String(url).includes(":commit")) {
      const w = koerper.writes[0];
      const id = w.update.name.split("/segments/")[1];
      serverSegmente.set(id, w.update.fields.createdBy.stringValue);
      return json({});
    }

    if (String(url).includes("accounts:delete")) return json({ kind: "ok" });

    throw new Error(`unerwarteter Aufruf: ${url}`);
  }

  function json(wert) {
    return { ok: true, status: 200, json: async () => wert };
  }

  return { fetchMock, anfragen, serverEintraege, serverSegmente };
}

/** `n` Eintragsnamen, so sortiert wie Firestore sie nach `__name__` liefert. */
function namen(n) {
  return Array.from({ length: n }, (_, i) =>
    `projects/autobahn-strava/databases/(default)/documents/entries/e${String(i).padStart(5, "0")}`);
}

beforeEach(() => {
  globalThis.localStorage._d = {};
  delete globalThis.fetch;
});

describe("Der Schalter allein laedt nichts hoch", () => {
  test("Schalter an, Einwilligung widerrufen: isEnabled() ist aus", () => {
    Cloud.einwilligungSetzen(true);
    Cloud.setEnabled(true);
    assert.equal(Cloud.isEnabled(), true);

    Cloud.einwilligungSetzen(false);
    assert.equal(Cloud.isEnabled(), false, "nach Widerruf immer noch aktiv");
  });

  test("der Schalter selbst bleibt sichtbar — die Oberflaeche muss unterscheiden", () => {
    Cloud.einwilligungSetzen(true);
    Cloud.setEnabled(true);
    Cloud.einwilligungSetzen(false);
    assert.equal(Cloud.schalterAn(), true, "der Schalter wurde heimlich mit umgelegt");
    assert.equal(Cloud.isEnabled(), false);
  });

  test("ein von Hand gesetzter Schalter ohne Einwilligung wirkt nicht", () => {
    // Genau der Weg, den ein manipulierter oder alter Speicherstand nimmt.
    localStorage.setItem(KEY_ENABLED, "1");
    assert.equal(Cloud.hatEingewilligt(), false);
    assert.equal(Cloud.isEnabled(), false, "ohne Einwilligung eingeschaltet");
  });

  test("publishTrip weigert sich ohne Einwilligung — auch bei gesetztem Schalter", async () => {
    localStorage.setItem(KEY_ENABLED, "1");
    let gerufen = false;
    globalThis.fetch = async () => { gerufen = true; throw new Error("darf nicht passieren"); };
    await assert.rejects(
      () => Cloud.publishTrip({ id: "t1", mode: "public", eligible: true }, { id: "s1" }),
      /Einwilligung/,
    );
    assert.equal(gerufen, false, "es ging trotzdem eine Anfrage hinaus");
  });
});

describe("Loeschen und Export gehen ueber mehr als eine Seite", () => {
  test("SEITE ist wirklich die Seitengroesse, die der Code benutzt", async () => {
    sitzungAnlegen();
    const n = netz({ eintraege: namen(1) });
    globalThis.fetch = n.fetchMock;
    await Cloud.meineEintraege();
    const q = n.anfragen.find((a) => a.url.includes(":runQuery")).koerper.structuredQuery;
    assert.equal(q.limit, SEITE, "dieser Test rechnet mit einer anderen Seitengroesse als der Code");
  });

  test("Export holt 700 Eintraege ueber drei Seiten", async () => {
    sitzungAnlegen();
    const n = netz({ eintraege: namen(700) });
    globalThis.fetch = n.fetchMock;

    const alle = await Cloud.meineEintraege();
    assert.equal(alle.length, 700, "der Export hat nur die erste Seite geholt");

    const abfragen = n.anfragen.filter((a) => a.url.includes(":runQuery"));
    assert.equal(abfragen.length, 3, `erwartet 3 Seiten, tatsaechlich ${abfragen.length}`);
    assert.equal(abfragen[0].koerper.structuredQuery.startAt, undefined, "erste Seite mit Cursor");
    assert.ok(abfragen[1].koerper.structuredQuery.startAt, "zweite Seite ohne Cursor");
    assert.equal(abfragen[1].koerper.structuredQuery.startAt.before, false,
      "der Cursor wuerde das letzte Dokument der Vorseite erneut liefern");
  });

  test("Alles loeschen raeumt 700 Eintraege leer, nicht 300", async () => {
    sitzungAnlegen();
    const n = netz({ eintraege: namen(700) });
    globalThis.fetch = n.fetchMock;

    const anzahl = await Cloud.deleteAllMine();
    assert.equal(anzahl, 700);
    assert.equal(n.serverEintraege.size, 0, `${n.serverEintraege.size} Eintraege blieben online`);
  });

  test("eigene Strecken werden auch jenseits der ersten Seite geloest", async () => {
    // Der Grund: `meineSegmente` holt hoechstens `SEITE` Stueck. Wer mehr
    // eigene Strecken angelegt hat, behielte den Rest verknuepft — und
    // "alles geloescht" waere gelogen.
    sitzungAnlegen();
    const segmente = Array.from({ length: 700 }, (_, i) => `s${String(i).padStart(4, "0")}`);
    const n = netz({ eintraege: [], segmente });
    globalThis.fetch = n.fetchMock;

    await Cloud.deleteAllMine();
    const uebrig = [...n.serverSegmente.values()].filter((wer) => wer === "uid-1").length;
    assert.equal(uebrig, 0, `${uebrig} Strecken zeigen weiterhin auf die Kennung`);
  });
});

describe("Bricht es ab, bleibt die Kennung", () => {
  test("ein Fehler mitten im Loeschen laesst die Sitzung stehen", async () => {
    sitzungAnlegen();
    // Anfrage 1 ist die Abfrage, danach kommen die DELETEs. Beim fuenften
    // DELETE aussteigen.
    const n = netz({ eintraege: namen(20), stolpert: (i) => i === 6 });
    globalThis.fetch = n.fetchMock;

    const fehler = await Cloud.deleteAllMine().then(() => null, (e) => e);
    assert.ok(fehler, "der Abbruch wurde verschluckt");
    assert.equal(fehler.geloescht, 4, "der Fehler traegt die falsche Zahl mit");
    assert.ok(localStorage.getItem(KEY_SESSION), "die Kennung wurde trotz Abbruch entfernt");
    assert.equal(n.serverEintraege.size, 16, "es wurde mehr oder weniger geloescht als gemeldet");
  });

  test("ein zweiter Anlauf raeumt den Rest weg", async () => {
    sitzungAnlegen();
    const n = netz({ eintraege: namen(20) });
    globalThis.fetch = n.fetchMock;
    // Erst scheitern lassen, dann ohne Stolperstein erneut.
    const kaputt = netz({ eintraege: namen(20), stolpert: (i) => i === 6 });
    globalThis.fetch = kaputt.fetchMock;
    await Cloud.deleteAllMine().catch(() => {});
    globalThis.fetch = async (u, o) => kaputt.fetchMock(u, { ...o });
    kaputt.anfragen.length = 0;
    const zweiter = netz({ eintraege: [...kaputt.serverEintraege] });
    globalThis.fetch = zweiter.fetchMock;

    const anzahl = await Cloud.deleteAllMine();
    assert.equal(anzahl, 16);
    assert.equal(zweiter.serverEintraege.size, 0);
    assert.equal(localStorage.getItem(KEY_SESSION), null, "am Ende blieb die Kennung liegen");
  });
});

describe("Zum Loeschen gehoert das Konto", () => {
  test("das anonyme Firebase-Konto wird mit dem eigenen Token geloescht", async () => {
    sitzungAnlegen();
    const n = netz({ eintraege: namen(2) });
    globalThis.fetch = n.fetchMock;

    await Cloud.deleteAllMine();
    const konto = n.anfragen.find((a) => a.url.includes("accounts:delete"));
    assert.ok(konto, "das Konto blieb in der Anmeldeverwaltung stehen");
    assert.equal(konto.koerper.idToken, "TOKEN-A");
  });

  test("die lokale Spur faellt ZULETZT — nach dem Konto, nicht davor", async () => {
    sitzungAnlegen();
    const n = netz({ eintraege: namen(2) });
    let sitzungBeimKontoLoeschen;
    globalThis.fetch = async (url, opt) => {
      if (String(url).includes("accounts:delete")) {
        sitzungBeimKontoLoeschen = localStorage.getItem(KEY_SESSION);
      }
      return n.fetchMock(url, opt);
    };
    await Cloud.deleteAllMine();
    assert.ok(sitzungBeimKontoLoeschen,
      "die Kennung war schon weg, als das Konto geloescht werden sollte");
    assert.equal(localStorage.getItem(KEY_SESSION), null, "die lokale Spur blieb liegen");
  });

  test("scheitert das Konto, bleibt die Kennung und die Zahl stimmt", async () => {
    sitzungAnlegen();
    const n = netz({
      eintraege: namen(3),
      stolpert: (i, url) => url.includes("accounts:delete"),
    });
    globalThis.fetch = n.fetchMock;

    const fehler = await Cloud.deleteAllMine().then(() => null, (e) => e);
    assert.ok(fehler);
    assert.equal(fehler.geloescht, 3, "die Eintraege waren weg, die Meldung sagt etwas anderes");
    assert.ok(localStorage.getItem(KEY_SESSION), "Kennung weg, obwohl das Konto noch existiert");
  });
});

describe("Es wird nie eine neue Kennung angelegt, um sie zu loeschen", () => {
  test("ohne Sitzung sagt Loeschen nein statt sich eine zu besorgen", async () => {
    const n = netz({});
    globalThis.fetch = n.fetchMock;
    await assert.rejects(() => Cloud.deleteAllMine(), /Kennung/);
    assert.equal(n.anfragen.filter((a) => a.url.includes(":signUp")).length, 0,
      "es wurde eine frische Identitaet erzeugt, um sie zu loeschen");
    assert.equal(n.anfragen.length, 0, "es ging ueberhaupt eine Anfrage hinaus");
  });

  test("dasselbe fuer den Export", async () => {
    const n = netz({});
    globalThis.fetch = n.fetchMock;
    await assert.rejects(() => Cloud.meineEintraege(), /Kennung/);
    assert.equal(n.anfragen.length, 0);
  });

  test("eine abgelaufene Sitzung ohne Refresh-Token legt keine neue an", async () => {
    localStorage.setItem(KEY_SESSION, JSON.stringify({
      idToken: "ALT", uid: "uid-1", expiresAt: Date.now() - 1000,
    }));
    const n = netz({});
    globalThis.fetch = n.fetchMock;
    await assert.rejects(() => Cloud.deleteAllMine(), /abgelaufen/);
    assert.equal(n.anfragen.length, 0);
  });
});
