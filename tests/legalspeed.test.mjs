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
const { Segments, Store, Score, Geo } = globalThis;

// a7-b3-hannover-celle traegt ein echtes Limit von 100 km/h,
// a2-hannover-braunschweig traegt keines.
const MIT_LIMIT = "a7-b3-hannover-celle";
const OHNE_LIMIT = "a2-hannover-braunschweig";
const segMit = Segments.byId(MIT_LIMIT);
const segOhne = Segments.byId(OHNE_LIMIT);

/** Eine Ranglistenzeile, wie sie aus der Online-Abfrage zurueckkaeme.
 *  `withinLimit` ist der Legalitaetsnachweis; `undefined` steht fuer einen
 *  Alteintrag, der vor dem 09.09.2026 veroeffentlicht wurde. */
function onlineZeile(sustainedKmh, score = 95, withinLimit = true) {
  const r = {
    id: "online-" + sustainedKmh,
    segmentId: MIT_LIMIT,
    nickname: "Fremd" + sustainedKmh,
    score,
    avgKmh: sustainedKmh - 10,
    sustainedKmh,
    hardBraking: 0,
    online: true,
  };
  if (withinLimit !== undefined) r.withinLimit = withinLimit;
  r.expiresAt = Store.verfaelltAm();
  return r;
}

/** Samples mit gleichmaessigem Tempo und optional EINEM Ausreisser. */
function fahrt(grundKmh, ausreisserKmh, anzahl = 120) {
  const s = [];
  let lat = 52.6, lon = 10.06;
  const t0 = Date.now();
  for (let i = 0; i < anzahl; i++) {
    const kmh = (ausreisserKmh && i === Math.floor(anzahl / 2)) ? ausreisserKmh : grundKmh;
    const v = kmh / 3.6;
    lon += v / (111320 * Math.cos((lat * Math.PI) / 180));
    s.push({ t: t0 + i * 1000, lat, lon, acc: 5, spd: v, src: "gps" });
  }
  return s;
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
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: 100, score: 95, withinLimit: true }, segMit), true);
  });

  test("die GPS-Toleranz gilt, aber nicht weiter", () => {
    const grenze = segMit.limitKmh + Store.GPS_TOLERANZ_KMH;
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: grenze, score: 95, withinLimit: true }, segMit), true);
    assert.equal(Store.legalSpeedZulaessig({ sustainedKmh: grenze + 1, score: 95, withinLimit: true }, segMit), false);
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

describe("Ein Fuenf-Sekunden-Mittel beweist keine Legalitaet", () => {
  // Der Befund vom 09.09.2026: `sustainedKmh` mittelt ueber fuenf Sekunden.
  // Eine kurze, deutliche Ueberschreitung verschwindet darin.

  test("die kurze Ueberschreitung verschwindet wirklich im 5-s-Wert", () => {
    // Erst nachweisen, dass der Fall real ist — sonst prueft der Test darunter
    // eine Lage, die es gar nicht gibt.
    const s = fahrt(95, 130);
    const sustained = Geo.sustainedMaxKmh(s, 5);
    const grenze = segMit.limitKmh + Store.GPS_TOLERANZ_KMH;
    assert.ok(sustained <= grenze, `sustained ${sustained.toFixed(1)} liegt nicht unter ${grenze}`);
    assert.ok(Math.max(...s.map((x) => x.spd * 3.6)) > grenze, "kein Ausreisser im Material");
  });

  test("bliebImLimit sieht sie trotzdem", () => {
    assert.equal(Score.bliebImLimit(fahrt(95, 130), segMit.limitKmh), false);
  });

  test("eine durchgehend legale Fahrt gilt als legal", () => {
    assert.equal(Score.bliebImLimit(fahrt(95, null), segMit.limitKmh), true);
  });

  test("die GPS-Toleranz gilt auch hier", () => {
    assert.equal(Score.bliebImLimit(fahrt(95, 103), segMit.limitKmh), true);
    assert.equal(Score.bliebImLimit(fahrt(95, 104), segMit.limitKmh), false);
  });

  test("ohne festes Limit gibt es keine Aussage — und das ist nicht 'ja'", () => {
    assert.equal(Score.bliebImLimit(fahrt(180, null), null), null);
  });

  test("ohne fahrende Werte gibt es keine Aussage", () => {
    assert.equal(Score.bliebImLimit(fahrt(0, null, 20), segMit.limitKmh), null);
  });

  test("DER FALL: kurze Ueberschreitung, 5-s-Wert unter der Grenze, Score >= 70 — trotzdem raus", () => {
    const s = fahrt(95, 130);
    const zeile = {
      sustainedKmh: Math.round(Geo.sustainedMaxKmh(s, 5)),
      score: Score.legalDriveScore(s, segMit).total,
      withinLimit: Score.bliebImLimit(s, segMit.limitKmh),
    };
    assert.ok(zeile.sustainedKmh <= segMit.limitKmh + Store.GPS_TOLERANZ_KMH, "Voraussetzung");
    assert.ok(zeile.score >= Store.MIN_SCORE, "Voraussetzung");
    assert.equal(
      Store.legalSpeedZulaessig(zeile, segMit),
      false,
      "eine Fahrt mit 130 km/h auf einem 100er-Abschnitt gilt als 'schnellste legale Fahrt'",
    );
  });

  test("ohne Nachweis: konservativ raus", () => {
    // Alteintraege von vor dem 09.09.2026 koennen ihn nicht tragen.
    for (const wert of [undefined, null, false, "true", 1]) {
      const zeile = { sustainedKmh: 95, score: 95 };
      if (wert !== undefined) zeile.withinLimit = wert;
      assert.equal(Store.legalSpeedZulaessig(zeile, segMit), false, `withinLimit=${String(wert)}`);
    }
  });
});

describe("Die Aufbewahrungsfrist gilt beim Anzeigen, nicht erst beim Loeschen", () => {
  // Die Frist steht im Datenschutztext. Eine Zusage, die erst gilt, wenn
  // Firestore irgendwann aufraeumt, ist keine.

  test("die Frist ist ein halbes Jahr", () => {
    assert.equal(Store.AUFBEWAHRUNG_TAGE, 180);
    const jetzt = Date.UTC(2026, 0, 1);
    const bis = Date.parse(Store.verfaelltAm(jetzt));
    assert.equal((bis - jetzt) / 86400000, 180);
  });

  test("ein frischer Eintrag ist nicht abgelaufen", () => {
    assert.equal(Store.istAbgelaufen({ expiresAt: Store.verfaelltAm() }), false);
  });

  test("ein abgelaufener schon", () => {
    const gestern = new Date(Date.now() - 86400000).toISOString();
    assert.equal(Store.istAbgelaufen({ expiresAt: gestern }), true);
  });

  test("ohne Frist gilt abgelaufen — nicht 'unbegrenzt'", () => {
    for (const kaputt of [{}, { expiresAt: null }, { expiresAt: 12345 }, { expiresAt: "morgen" }]) {
      assert.equal(Store.istAbgelaufen(kaputt), true, JSON.stringify(kaputt));
    }
  });

  test("abgelaufene Online-Zeilen erscheinen nicht in der Rangliste", () => {
    const gestern = new Date(Date.now() - 86400000).toISOString();
    const alt = { ...onlineZeile(95), expiresAt: gestern };
    const gemischt = Store.mischeRanglisten([], [alt], segMit, "legalSpeed", new Set());
    assert.deepEqual(gemischt, [], "ein abgelaufener Eintrag steht noch in der Liste");
  });

  test("auch nicht in der Score-Sortierung", () => {
    const gestern = new Date(Date.now() - 86400000).toISOString();
    const alt = { ...onlineZeile(95), expiresAt: gestern };
    assert.deepEqual(Store.mischeRanglisten([], [alt], segMit, "score", new Set()), []);
  });

  test("eigene lokale Fahrten sind von der Frist nicht betroffen", () => {
    // Die gehoeren dem Geraet. Was lokal liegt, verfaellt nicht.
    const lokal = [{ id: "t_9", sustainedKmh: 95, score: 90, nickname: "Ich", withinLimit: true }];
    const gemischt = Store.mischeRanglisten(lokal, [], segMit, "legalSpeed", new Set());
    assert.equal(gemischt.length, 1);
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

  test("ein Online-Alteintrag ohne Nachweis kommt nicht in legalSpeed", () => {
    // Bewusst von Hand gebaut: ein `undefined` als Argument wuerde in
    // onlineZeile() den Standardwert ausloesen und damit genau das Gegenteil
    // des gemeinten Falls erzeugen. Diese Zeile hat das Feld wirklich nicht.
    const alt = onlineZeile(95);
    delete alt.withinLimit;
    assert.ok(!("withinLimit" in alt), "der Fall ist nur echt ohne das Feld");
    const gemischt = Store.mischeRanglisten([], [alt], segMit, "legalSpeed", new Set());
    assert.deepEqual(gemischt, []);
  });

  test("in der Score-Sortierung bleiben Online-Zeilen erhalten", () => {
    // Der Filter gehoert zur legalSpeed-Ansicht, nicht zur Rangliste an sich.
    const gemischt = Store.mischeRanglisten([], [onlineZeile(118, 62)], segMit, "score", new Set());
    assert.equal(gemischt.length, 1);
  });

  test("eine veroeffentlichte Fahrt zaehlt nicht doppelt", () => {
    // Der echte Ablauf, nicht ein bequemer:
    //   lokaler Trip            id = t_1
    //   nach dem Veroeffentlichen  publishedId = online_abc  (die ONLINE-Id)
    //   Online-Zeile            id = online_abc
    //   lokale Ranglistenzeile  id = t_1                     (die LOKALE Id)
    // app.js baut das Set aus t.publishedId, also aus Online-Ids. Wer hier
    // die lokale Id ins Set legt, testet einen Ablauf, den es nicht gibt.
    // Der Trip liegt so im Speicher, wie er nach dem Veroeffentlichen aussieht.
    localStorage.setItem("as_trips", JSON.stringify([
      { id: "t_1", publishedId: "online_abc", segmentId: MIT_LIMIT, mode: "public" },
    ]));
    const lokal = [{ id: "t_1", sustainedKmh: 95, score: 90, nickname: "Ich", withinLimit: true }];
    const online = [{ id: "online_abc", sustainedKmh: 95, score: 90, nickname: "Ich", online: true,
                     withinLimit: true, expiresAt: Store.verfaelltAm() }];
    // Nicht von Hand zusammengestellt, sondern genau die Zuordnung, die auch
    // die App benutzt — sonst prueft der Test einen Ablauf, den es nicht gibt.
    const schon = Store.veroeffentlichteLokaleIds();
    assert.ok(schon.has("t_1"), "die lokale Id gehoert ins Set, nicht die Online-Id");
    const gemischt = Store.mischeRanglisten(lokal, online, segMit, "legalSpeed", schon);
    assert.equal(gemischt.length, 1, "die Fahrt steht doppelt in der Rangliste");
    assert.equal(gemischt[0].online, true, "die Online-Fassung soll gewinnen");
  });
});
