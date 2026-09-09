/**
 * Die Online-Rangliste laesst sich nur mit Einwilligung einschalten.
 *
 * Bis zum 09.09.2026 genuegte ein Schalter. Ein Schalter ist keine
 * Einwilligung: er sagt nicht, was uebertragen wird, wie lange es bleibt und
 * wie man es wieder loswird. Genau das verlangt die DSGVO, bevor Daten eines
 * Geraets zu einem fremden Server gehen.
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
const { Cloud, Store } = globalThis;

beforeEach(() => {
  globalThis.localStorage._d = {};
});

describe("Ohne Einwilligung geht die Rangliste nicht an", () => {
  test("frisch installiert liegt keine Einwilligung vor", () => {
    assert.equal(Cloud.hatEingewilligt(), false);
    assert.equal(Cloud.einwilligung(), null);
  });

  test("Einschalten ohne Einwilligung wird abgewiesen", () => {
    assert.throws(() => Cloud.setEnabled(true), /Einwilligung/);
    assert.equal(Cloud.isEnabled(), false, "trotz Fehler eingeschaltet");
  });

  test("mit Einwilligung geht es", () => {
    Cloud.einwilligungSetzen(true);
    Cloud.setEnabled(true);
    assert.equal(Cloud.isEnabled(), true);
  });

  test("die Einwilligung wird mit Zeitpunkt und Fassung festgehalten", () => {
    Cloud.einwilligungSetzen(true);
    const e = Cloud.einwilligung();
    assert.equal(e.fassung, Cloud.EINWILLIGUNG_FASSUNG);
    assert.ok(Date.parse(e.am) > 0, "kein brauchbarer Zeitpunkt");
  });

  test("eine Zustimmung zu einer aelteren Fassung zaehlt nicht", () => {
    // Aendert sich der Text inhaltlich, muss neu gefragt werden.
    localStorage.setItem("as_cloud_einwilligung",
      JSON.stringify({ fassung: Cloud.EINWILLIGUNG_FASSUNG - 1, am: new Date().toISOString() }));
    assert.equal(Cloud.hatEingewilligt(), false);
    assert.throws(() => Cloud.setEnabled(true), /Einwilligung/);
  });

  test("kaputter Eintrag zaehlt ebenfalls nicht", () => {
    localStorage.setItem("as_cloud_einwilligung", "{kein json");
    assert.equal(Cloud.hatEingewilligt(), false);
  });
});

describe("Der Widerruf haengt an nichts", () => {
  test("Ausschalten geht immer, auch ohne Einwilligung", () => {
    Cloud.setEnabled(false);
    assert.equal(Cloud.isEnabled(), false);
  });

  test("Widerruf schaltet die Rangliste nicht heimlich an", () => {
    Cloud.einwilligungSetzen(true);
    Cloud.setEnabled(true);
    Cloud.einwilligungSetzen(false);
    assert.equal(Cloud.hatEingewilligt(), false);
    // Der Schalter steht noch auf an — aber ein erneutes Einschalten nach dem
    // Ausschalten verlangt wieder eine Zustimmung.
    Cloud.setEnabled(false);
    assert.throws(() => Cloud.setEnabled(true), /Einwilligung/);
  });
});

describe("Was beim Veroeffentlichen mitgeht", () => {
  test("die Frist kommt aus einer Stelle", () => {
    // cloud.js benutzt Store.verfaelltAm(), damit Anzeige und Upload nicht
    // auseinanderlaufen koennen.
    assert.equal(typeof Store.verfaelltAm, "function");
    assert.equal(Store.AUFBEWAHRUNG_TAGE, 180);
  });

  test("eine Fahrt im Track-Modus wird gar nicht erst veroeffentlicht", async () => {
    Cloud.einwilligungSetzen(true);
    Cloud.setEnabled(true);
    await assert.rejects(
      () => Cloud.publishTrip({ mode: "track", eligible: true }, {}, null),
      /Track/,
    );
  });

  test("eine nicht gewertete Fahrt ebenso wenig", async () => {
    Cloud.einwilligungSetzen(true);
    Cloud.setEnabled(true);
    await assert.rejects(
      () => Cloud.publishTrip({ mode: "public", eligible: false }, {}, null),
      /nicht gewertet/,
    );
  });
});
