/**
 * Der native Aufnahme-Lebenszyklus.
 *
 * Hintergrund: `Info.plist` verspricht wortwoertlich "Die Aufzeichnung laeuft
 * nur zwischen Start und Stopp, nie im Hintergrund ohne dein Zutun." Auf dem
 * nativen Weg stimmte das nicht: `addWatcher()` loest asynchron auf, `stop()`
 * sah `watchId === null`, tat nichts und setzte danach `native = null` — womit
 * der Watcher nicht mehr erreichbar war. Mit `UIBackgroundModes: location`
 * heisst das Standortverfolgung bei gesperrtem Bildschirm, nachdem der Nutzer
 * Stopp gedrueckt hat.
 *
 * Diese Faelle pruefen den Vertrag: nach `stop()` darf kein noch ausstehender
 * `addWatcher()`-Aufruf einen aktiven Watcher hinterlassen.
 *
 * Start:  npm test
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.window = globalThis;
require(join(WURZEL, "web", "js", "segments.js"));
require(join(WURZEL, "web", "js", "geo.js"));
const { Geo } = globalThis;

/** Ein Plugin, dessen addWatcher() erst auf Zuruf aufloest. */
function pluginAttrappe() {
  const p = {
    angelegt: [],
    entfernt: [],
    offen: [],
    rueckrufe: [],
    addWatcher(optionen, rueckruf) {
      p.rueckrufe.push(rueckruf);
      return new Promise((ok) => p.offen.push(ok));
    },
    removeWatcher({ id }) {
      p.entfernt.push(id);
      return Promise.resolve();
    },
    /** Den n-ten ausstehenden addWatcher-Aufruf mit dieser Id aufloesen. */
    aufloesen(n, id) {
      p.angelegt.push(id);
      p.offen[n](id);
    },
  };
  return p;
}

let plugin;

beforeEach(() => {
  plugin = pluginAttrappe();
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { BackgroundGeolocation: plugin },
  };
});

afterEach(() => {
  delete globalThis.Capacitor;
});

/** Warten, bis alle bereits aufgeloesten Promises abgearbeitet sind. */
const ruhe = () => new Promise((ok) => setTimeout(ok, 0));

describe("Der native Watcher ueberlebt kein Stopp", () => {
  test("die Aufnahme laeuft ueberhaupt nativ", () => {
    assert.equal(Geo.Recorder.backgroundCapable(), true);
  });

  test("DER FALL: Stopp bevor addWatcher aufloest", async () => {
    const rec = new Geo.Recorder(() => {});
    rec.start();
    rec.stop();                      // der Nutzer tippt Stopp
    plugin.aufloesen(0, "watcher-1"); // erst danach loest das Plugin auf
    await ruhe();

    assert.deepEqual(
      plugin.entfernt,
      ["watcher-1"],
      "der Watcher wurde nicht genau einmal entfernt — er laeuft nach Stopp weiter",
    );
    assert.equal(rec.watchId, null, "ein gestoppter Recorder haelt noch eine Watcher-Id");
  });

  test("der gewoehnliche Weg entfernt weiterhin sauber", async () => {
    const rec = new Geo.Recorder(() => {});
    rec.start();
    plugin.aufloesen(0, "watcher-1");
    await ruhe();
    assert.equal(rec.watchId, "watcher-1");
    rec.stop();
    await ruhe();
    assert.deepEqual(plugin.entfernt, ["watcher-1"]);
    assert.equal(rec.watchId, null);
  });

  test("start → stop → start: der alte, verspaetete Start stoert den neuen nicht", async () => {
    const alt = new Geo.Recorder(() => {});
    alt.start();
    alt.stop();

    const neu = new Geo.Recorder(() => {});
    neu.start();
    plugin.aufloesen(1, "watcher-2");   // der neue loest zuerst auf
    await ruhe();
    assert.equal(neu.watchId, "watcher-2");

    plugin.aufloesen(0, "watcher-1");   // der alte kommt verspaetet
    await ruhe();

    assert.equal(neu.watchId, "watcher-2", "der alte Start hat den neuen Watcher ersetzt");
    assert.ok(!plugin.entfernt.includes("watcher-2"), "der alte Start hat den neuen Watcher entfernt");
    assert.deepEqual(plugin.entfernt, ["watcher-1"], "der alte Watcher blieb aktiv");
  });

  test("zweimal Start ohne Stopp laesst keinen Watcher zurueck", async () => {
    const rec = new Geo.Recorder(() => {});
    rec.start();
    rec.start();                       // z. B. Doppeltipp
    plugin.aufloesen(1, "watcher-2");
    plugin.aufloesen(0, "watcher-1");
    await ruhe();
    assert.equal(rec.watchId, "watcher-2");
    assert.deepEqual(plugin.entfernt, ["watcher-1"], "der erste Watcher blieb aktiv");
  });

  test("nach dem Stopp kommen keine Messwerte mehr an", async () => {
    const gesehen = [];
    const rec = new Geo.Recorder((e) => e.sample && gesehen.push(e.sample));
    rec.start();
    rec.stop();
    plugin.aufloesen(0, "watcher-1");
    await ruhe();
    // Das Plugin meldet noch eine Position, bevor removeWatcher greift.
    plugin.rueckrufe[0]({ time: Date.now(), latitude: 52.4, longitude: 9.7, accuracy: 5, speed: 30 });
    assert.deepEqual(gesehen, [], "eine Position kam nach dem Stopp noch in die Aufnahme");
    assert.deepEqual(rec.samples, [], "eine Position landete nach dem Stopp in den Samples");
  });

  test("und schon gar nicht in einer neuen Aufnahme", async () => {
    const alt = new Geo.Recorder(() => {});
    alt.start();
    alt.stop();
    plugin.aufloesen(0, "watcher-1");
    await ruhe();

    const gesehen = [];
    const neu = new Geo.Recorder((e) => e.sample && gesehen.push(e.sample));
    neu.start();
    plugin.aufloesen(1, "watcher-2");
    await ruhe();
    // Der Rueckruf des ALTEN Laufs meldet noch etwas.
    plugin.rueckrufe[0]({ time: Date.now(), latitude: 52.4, longitude: 9.7, accuracy: 5, speed: 30 });
    assert.deepEqual(neu.samples, [], "eine alte Position landete in der neuen Aufnahme");
    assert.deepEqual(gesehen, []);
  });
});

/**
 * Die zweite Gestalt, die `addWatcher()` haben kann — und die, die auf dem
 * echten Geraet tatsaechlich auftritt.
 *
 * Gemessen am 11.09.2026 auf einem iPhone 17 Pro (iOS 26.6.1), beim allerersten
 * Start der Aufnahme auf echter Hardware:
 *
 *     TypeError: plugin.addWatcher(...).then is not a function
 *     (... '....then' is undefined)
 *
 * Ursache, Schicht fuer Schicht:
 *
 *   1. `index.html` laedt keine Capacitor-Laufzeit — dieses Repository hat
 *      bewusst keinen Build-Schritt.
 *   2. `window.Capacitor` kommt deshalb nur aus der nativ injizierten
 *      `native-bridge.js` samt dem Legacy-Shim unter `Capacitor.Plugins.*`.
 *   3. Dort wird eine Callback-Methode auf `cap.nativeCallback` verdrahtet, und
 *      die gibt `cap.toNative(...)` zurueck — die `callbackId`, ein STRING.
 *      Ein Promise gibt es nur beim Weg ueber `registerPlugin()` aus
 *      `@capacitor/core`.
 *   4. `addWatcher` ist im Plugin als `CAPPluginReturnCallback` deklariert,
 *      `removeWatcher` als `CAPPluginReturnPromise`. Nur der erste ist
 *      betroffen.
 *
 * Beide Wege meinen dieselbe Id: die Swift-Seite sucht den Watcher ueber
 * `call.getString("id")` und vergleicht sie mit `callbackId`. Der Code muss
 * also nicht wissen, welcher Weg gerade aktiv ist — nur beide Formen annehmen.
 *
 * Die bisherige Attrappe lieferte immer ein Promise. Sie hat damit die ANNAHME
 * des Autors kodiert statt des Verhaltens der Plattform, und deshalb war die
 * Testreihe gruen, waehrend die Aufnahme auf dem Geraet ueberhaupt nicht
 * startete. Auch die Gegenprobe war gruen — sie prueft nur, ob die Suite den
 * Vertrag verteidigt, nicht ob es der richtige Vertrag ist.
 */
function pluginAttrappeLegacy() {
  const p = {
    angelegt: [],
    entfernt: [],
    rueckrufe: [],
    naechsteId: 1,
    /** Genau wie `cap.nativeCallback`: die Id kommt SOFORT und als String. */
    addWatcher(optionen, rueckruf) {
      const id = String(p.naechsteId++);
      p.rueckrufe.push(rueckruf);
      p.angelegt.push(id);
      return id;
    },
    removeWatcher({ id }) {
      p.entfernt.push(id);
      return Promise.resolve();
    },
  };
  return p;
}

describe("Die Bridge liefert die Watcher-Id auch ohne Promise", () => {
  let legacy;

  beforeEach(() => {
    legacy = pluginAttrappeLegacy();
    globalThis.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { BackgroundGeolocation: legacy },
    };
  });

  test("DER FALL: Start wirft nicht, wenn addWatcher direkt eine Id liefert", () => {
    const rec = new Geo.Recorder(() => {});
    assert.doesNotThrow(() => rec.start(), "genau der Fehler vom echten Geraet");
    assert.equal(legacy.angelegt.length, 1, "es wurde gar kein Watcher angelegt");
  });

  test("die Id wird uebernommen — sonst laesst sich nichts mehr entfernen", async () => {
    const rec = new Geo.Recorder(() => {});
    rec.start();
    await ruhe();
    assert.equal(rec.watchId, legacy.angelegt[0], "watchId ist nicht die Id des Watchers");
  });

  test("Stopp entfernt den Watcher wirklich", async () => {
    const rec = new Geo.Recorder(() => {});
    rec.start();
    await ruhe();
    rec.stop();
    assert.deepEqual(legacy.entfernt, legacy.angelegt,
      "nach Stopp lief der Watcher weiter — Standortverfolgung ohne Stopp-Knopf");
  });

  test("Positionen landen in der Aufnahme", async () => {
    const gesehen = [];
    const rec = new Geo.Recorder((e) => e.sample && gesehen.push(e.sample));
    rec.start();
    await ruhe();
    legacy.rueckrufe[0]({ time: 1000, latitude: 52.4, longitude: 9.7, accuracy: 5, speed: 30 });
    assert.equal(gesehen.length, 1, "die Position kam nicht an");
    assert.equal(rec.samples.length, 1);
  });

  test("nach Stopp kommt nichts mehr an", async () => {
    const gesehen = [];
    const rec = new Geo.Recorder((e) => e.sample && gesehen.push(e.sample));
    rec.start();
    await ruhe();
    rec.stop();
    legacy.rueckrufe[0]({ time: 1000, latitude: 52.4, longitude: 9.7, accuracy: 5, speed: 30 });
    assert.deepEqual(gesehen, [], "ein Rueckruf nach dem Stopp landete in der Aufnahme");
  });

  test("ein Fehler aus dem Rueckruf wird gemeldet statt verschluckt", async () => {
    const fehler = [];
    const rec = new Geo.Recorder((e) => e.error && fehler.push(e.error));
    rec.start();
    await ruhe();
    legacy.rueckrufe[0](null, { message: "Standort verweigert" });
    assert.deepEqual(fehler, ["Standort verweigert"]);
  });
});
