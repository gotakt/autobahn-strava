/**
 * Die ersten automatisierten Tests dieses Repositorys.
 *
 * Sie decken nicht die ganze App ab, sondern genau die Zusage, die bis zum
 * 08.09.2026 gebrochen war und die das Produktprinzip traegt:
 *
 *   "Kein Tempo-Ranking auf oeffentlichen Strassen."
 *
 * Der Fehler war nicht die Formel, sondern ein zweiter Weg an ihr vorbei:
 * Store.leaderboard() filterte, der Online-Weg nicht, und der Mischschritt in
 * app.js haengte die Online-Zeilen ungefiltert an. Ein Eintrag mit 118 km/h
 * stand damit auf Platz 1 eines Abschnitts mit 100er-Limit — obendrein
 * derselbe Demo-Eintrag, den store.js im Kommentar ausdruecklich als
 * "filters it out entirely rather than crowning it" beschreibt.
 *
 * Deshalb pruefen diese Faelle beide Wege und ausdruecklich den Mischschritt.
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

// Die Web-Module sind fuer den Browser geschrieben und haengen sich an
// `window`. Im Test ist globalThis das Fenster, und localStorage wird
// nachgebaut — kein Netz, keine Datei, nichts Bleibendes.
globalThis.window = globalThis;
globalThis.localStorage = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
for (const m of ["segments", "geo", "score", "store"]) {
  require(join(WURZEL, "web", "js", `${m}.js`));
}
const { Segments, Store } = globalThis;

// a7-b3-hannover-celle traegt ein echtes Limit von 100 km/h,
// a2-hannover-braunschweig traegt keines.
const MIT_LIMIT = "a7-b3-hannover-celle";
const OHNE_LIMIT = "a2-hannover-braunschweig";
const segMit = Segments.byId(MIT_LIMIT);
const segOhne = Segments.byId(OHNE_LIMIT);

/** Eine Ranglistenzeile, wie sie aus der Online-Abfrage zurueckkaeme. */
function onlineZeile(sustainedKmh, score = 95) {
  return {
    id: "online-" + sustainedKmh,
    segmentId: MIT_LIMIT,
    nickname: "Fremd" + sustainedKmh,
    score,
    avgKmh: sustainedKmh - 10,
    sustainedKmh,
    hardBraking: 0,
    online: true,
  };
}

beforeEach(() => {
  globalThis.localStorage._d = {};
});

describe("Wo es die Ansicht 'Schnellste legale Fahrt' geben darf", () => {
  test("mit echtem Tempolimit: ja", () => {
    assert.equal(Store.legalSpeedVerfuegbar(segMit), true);
  });

  test("ohne echtes Tempolimit: nein", () => {
    assert.equal(Store.legalSpeedVerfuegbar(segOhne), false);
  });

  test("die Richtgeschwindigkeit ersetzt das Limit NICHT", () => {
    // 130 ist eine Empfehlung, kein Gesetz. Sie hier als Grenze zu behandeln
    // hiesse, eine falsche Aussage durch eine andere zu ersetzen.
    assert.equal(segOhne.limitKmh, null);
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: 125, score: 95 }, segOhne), false);
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: 90, score: 99 }, segOhne), false);
  });

  test("ohne Limit liefert die Rangliste in dieser Sortierung nichts", () => {
    assert.deepEqual(Store.leaderboard(OHNE_LIMIT, "legalSpeed"), []);
  });

  test("der Legal-Drive-Score bleibt dort aber bestehen", () => {
    const rows = Store.leaderboard(OHNE_LIMIT, "score");
    assert.ok(rows.length >= 3, "Score-Rangliste darf nicht mit verschwinden");
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].score >= rows[i].score, "nicht nach Score sortiert");
    }
  });
});

describe("Wo es die Ansicht gibt, muss sie halten was sie sagt", () => {
  test("eine Fahrt ueber dem Limit kommt nicht hinein", () => {
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: 118, score: 95 }, segMit), false);
  });

  test("genau auf dem Limit kommt hinein", () => {
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: 100, score: 95 }, segMit), true);
  });

  test("die GPS-Toleranz gilt, aber nicht weiter", () => {
    const grenze = segMit.limitKmh + Store.GPS_TOLERANZ_KMH;
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: grenze, score: 95 }, segMit), true);
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: grenze + 1, score: 95 }, segMit), false);
  });

  test("langsam allein reicht nicht — die Fahrqualitaet zaehlt mit", () => {
    assert.equal(
      Store.legalSpeedZulaessig({ sustainedKmh: 80, score: Store.MIN_SCORE - 1 }, segMit),
      false,
    );
  });

  test("unbrauchbare Werte werden abgewiesen statt durchgereicht", () => {
    for (const kaputt of [
      { sustainedKmh: "118", score: 95 },
      { sustainedKmh: 90, score: "95" },
      { sustainedKmh: NaN, score: 95 },
      { sustainedKmh: undefined, score: 95 },
      {},
    ]) {
      assert.equal(Store.legalSpeedZulaessig(kaputt, segMit), false, JSON.stringify(kaputt));
    }
  });

  test("die lokale Rangliste laesst nichts ueber dem Limit stehen", () => {
    const rows = Store.leaderboard(MIT_LIMIT, "legalSpeed");
    assert.ok(rows.length > 0, "es sollten legale Demo-Fahrten uebrig bleiben");
    for (const r of rows) {
      assert.ok(
        r.sustainedKmh <= segMit.limitKmh + Store.GPS_TOLERANZ_KMH,
        `${r.nickname} mit ${r.sustainedKmh} km/h steht in einer 100er-Liste`,
      );
    }
  });
});

describe("Der Online-Weg darf die Regel nicht umgehen", () => {
  // Das ist der eigentliche Befund vom 08.09.2026.

  test("ein Ueber-Limit-Eintrag kommt beim Mischen NICHT zurueck", () => {
    const lokal = Store.leaderboard(MIT_LIMIT, "legalSpeed");
    const gemischt = Store.mischeRanglisten(
      lokal,
      [onlineZeile(118)],
      segMit,
      "legalSpeed",
      new Set(),
    );
    assert.ok(
      !gemischt.some((r) => r.sustainedKmh === 118),
      "118 km/h ist ueber den Online-Weg in eine 100er-Liste zurueckgekommen",
    );
  });

  test("und schon gar nicht auf Platz 1", () => {
    const gemischt = Store.mischeRanglisten(
      Store.leaderboard(MIT_LIMIT, "legalSpeed"),
      [onlineZeile(118), onlineZeile(160), onlineZeile(240)],
      segMit,
      "legalSpeed",
      new Set(),
    );
    assert.ok(gemischt.length > 0, "die legalen Zeilen sind mitverschwunden");
    assert.ok(
      gemischt[0].sustainedKmh <= segMit.limitKmh + Store.GPS_TOLERANZ_KMH,
      `Platz 1 ist ${gemischt[0].sustainedKmh} km/h auf einem ${segMit.limitKmh}er-Abschnitt`,
    );
  });

  test("ein legaler Online-Eintrag kommt sehr wohl hinein", () => {
    const gemischt = Store.mischeRanglisten([], [onlineZeile(99)], segMit, "legalSpeed", new Set());
    assert.equal(gemischt.length, 1);
    assert.equal(gemischt[0].sustainedKmh, 99);
  });

  test("ohne Limit hilft auch der Online-Weg nicht", () => {
    const gemischt = Store.mischeRanglisten(
      [],
      [{ ...onlineZeile(200), segmentId: OHNE_LIMIT }],
      segOhne,
      "legalSpeed",
      new Set(),
    );
    assert.deepEqual(gemischt, []);
  });

  test("in der Score-Sortierung bleiben Online-Zeilen erhalten", () => {
    // Der Filter gehoert zur legalSpeed-Ansicht, nicht zur Rangliste an sich.
    const gemischt = Store.mischeRanglisten([], [onlineZeile(118, 62)], segMit, "score", new Set());
    assert.equal(gemischt.length, 1);
  });

  test("eine veroeffentlichte Fahrt zaehlt nicht doppelt", () => {
    const lokal = [{ id: "t_1", sustainedKmh: 95, score: 90, nickname: "Ich" }];
    const online = [{ id: "online-95", sustainedKmh: 95, score: 90, nickname: "Ich", online: true }];
    const gemischt = Store.mischeRanglisten(lokal, online, segMit, "legalSpeed", new Set(["t_1"]));
    assert.equal(gemischt.length, 1);
    assert.equal(gemischt[0].online, true, "die Online-Fassung soll gewinnen");
  });
});
