/**
 * Tests fuer den lokalen Vorschau-Server.
 *
 * Zwei Zusagen, die bis zum 09.09.2026 nicht stimmten:
 *
 *   1. "local preview" — der Server band ohne Host-Angabe und war damit auf
 *      allen Schnittstellen erreichbar. Gemessen: Listener `*:8131`, aus dem
 *      LAN HTTP 200.
 *   2. Nur Dateien aus `web/` ausliefern — der Schutz war
 *      `startsWith(ROOT)` ohne Trennzeichen, und ein Nachbarordner mit
 *      demselben Praefix rutschte durch. Gemessen: `webheimlich/leak.txt`
 *      mit HTTP 200, roh und URL-kodiert.
 *
 * Start:  npm test
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import net from "node:net";

const require = createRequire(import.meta.url);
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const serve = require(join(WURZEL, "scripts", "serve.js"));

// Ein Nachbarordner mit demselben Praefix wie `web` — genau der Fall, den
// `startsWith(ROOT)` ohne Trennzeichen durchgelassen hat.
const NACHBAR = join(WURZEL, "webheimlich");

let server;
let basis;

before(async () => {
  mkdirSync(NACHBAR, { recursive: true });
  writeFileSync(join(NACHBAR, "leak.txt"), "GEHEIM");
  // Port 0 laesst das Betriebssystem einen freien waehlen — kein Test soll an
  // einer belegten Nummer scheitern.
  server = serve.starte(0, "127.0.0.1");
  await new Promise((ok) => server.once("listening", ok));
  basis = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(NACHBAR, { recursive: true, force: true });
});

/** Holt eine Adresse, ohne dass fetch den Pfad vorher glattbuegelt. */
function roh(pfad) {
  return new Promise((ok, fehler) => {
    const s = net.connect(server.address().port, "127.0.0.1", () => {
      s.write(`GET ${pfad} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let daten = "";
    s.on("data", (d) => (daten += d));
    s.on("end", () => {
      const status = Number((daten.match(/^HTTP\/1\.1 (\d+)/) || [])[1]);
      const rumpf = daten.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      ok({ status, rumpf });
    });
    s.on("error", fehler);
  });
}

describe("Der Server liefert aus, was er soll", () => {
  test("/ liefert die Startseite", async () => {
    const r = await fetch(basis + "/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /text\/html/);
    assert.match(await r.text(), /<html|<!doctype/i);
  });

  test("gewoehnliche Dateien kommen durch", async () => {
    for (const [pfad, typ] of [
      ["/js/app.js", /javascript/],
      ["/css/app.css", /text\/css/],
      ["/manifest.webmanifest", /manifest/],
    ]) {
      const r = await fetch(basis + pfad);
      assert.equal(r.status, 200, pfad);
      assert.match(r.headers.get("content-type") || "", typ, pfad);
    }
  });

  test("was es nicht gibt, gibt 404", async () => {
    const r = await fetch(basis + "/gibtsnicht.js");
    assert.equal(r.status, 404);
  });

  test("ein Verzeichnis ist keine Datei", async () => {
    const r = await fetch(basis + "/js/");
    assert.equal(r.status, 404);
  });
});

describe("Und nichts ausserhalb von web/", () => {
  // Roh gesendet, damit kein Client den Pfad vorher normalisiert und der Test
  // etwas anderes prueft als gemeint.
  const ausbrueche = [
    "/../package.json",
    "/../../etc/passwd",
    "/%2e%2e/package.json",
    "/%2e%2e%2f%2e%2e%2fpackage.json",
    "/..%2fpackage.json",
    "/js/../../package.json",
    "/....//package.json",
  ];

  for (const pfad of ausbrueche) {
    test(`kein Ausbruch: ${pfad}`, async () => {
      const r = await roh(pfad);
      assert.equal(r.status, 404, `${pfad} wurde ausgeliefert`);
      assert.ok(!r.rumpf.includes('"name": "autobahn-strava"'), "package.json ausgeliefert");
    });
  }

  test("Nachbarordner mit gleichem Praefix bleibt zu — der eigentliche Befund", async () => {
    for (const pfad of [
      "/../webheimlich/leak.txt",
      "/%2e%2e/webheimlich/leak.txt",
      "/..%2fwebheimlich%2fleak.txt",
    ]) {
      const r = await roh(pfad);
      assert.equal(r.status, 404, `${pfad} wurde ausgeliefert`);
      assert.ok(!r.rumpf.includes("GEHEIM"), `${pfad} hat den Inhalt preisgegeben`);
    }
  });

  test("kaputte Prozentfolgen werden abgewiesen, nicht repariert", async () => {
    assert.equal(serve.dateiFuer("/%zz"), null);
    assert.equal((await roh("/%zz")).status, 404);
  });

  test("dateiFuer bleibt fuer jeden Ausbruch innerhalb von web/ oder sagt nein", () => {
    for (const pfad of ausbrueche.concat(["/../webheimlich/leak.txt"])) {
      const d = serve.dateiFuer(pfad);
      if (d === null) continue;
      assert.ok(
        d === serve.ROOT || d.startsWith(serve.ROOT + sep),
        `${pfad} loest nach ${d} auf`,
      );
    }
  });
});

describe("Und er hoert nur auf die eigene Maschine", () => {
  test("die tatsaechliche Adresse ist die Loopback-Adresse", () => {
    // Gemessen an der Server-Instanz, nicht an `lsof` — das Ergebnis ist
    // dasselbe auf jedem Betriebssystem.
    const a = server.address();
    assert.equal(a.address, "127.0.0.1", `gebunden an ${a.address}`);
  });

  test("ohne HOST-Angabe ist der Standard die Loopback-Adresse", () => {
    // Der eigentliche Fehler war, dass gar kein Host angegeben wurde. Node
    // bindet dann auf alle Schnittstellen.
    assert.equal(serve.HOST, "127.0.0.1");
  });

  test("ueber die LAN-Adresse kommt niemand herein", async (t) => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i.address)[0];
    if (!lan) {
      // Auf einem CI-Laeufer ohne echte Schnittstelle gibt es nichts zu
      // messen. Uebersprungen statt geraten.
      t.skip("keine externe IPv4-Adresse auf dieser Maschine");
      return;
    }
    await assert.rejects(
      () =>
        new Promise((ok, fehler) => {
          const s = net.connect({ port: server.address().port, host: lan, timeout: 2000 });
          s.on("connect", () => { s.destroy(); ok(); });
          s.on("timeout", () => { s.destroy(); fehler(new Error("timeout")); });
          s.on("error", fehler);
        }),
      `der Server war unter ${lan} erreichbar`,
    );
  });
});
