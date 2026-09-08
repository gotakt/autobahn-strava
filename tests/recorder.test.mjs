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
