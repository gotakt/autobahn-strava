// Tiny static server for local preview of the web/ folder.
// Usage: npm run serve  →  http://localhost:8123
//
// Zwei Dinge waren hier bis zum 09.09.2026 nicht so, wie der Kopf dieser Datei
// behauptet hat:
//
//   1. `listen(PORT)` ohne Host bindet in Node auf ALLE Schnittstellen.
//      Gemessen: Listener auf `*:8131`, aus dem LAN mit HTTP 200 erreichbar —
//      bei einer Datei, die sich "local preview" nennt.
//
//   2. Der Pfadschutz war `file.startsWith(ROOT)` ohne Trennzeichen. Damit
//      genuegte ein Nachbarordner mit demselben Praefix: `web/../webheimlich/`
//      loeste zu `<repo>/webheimlich/...` auf, fing mit `<repo>/web` an und
//      wurde ausgeliefert. Gemessen: HTTP 200, roh und URL-kodiert.
//
// Beides ist unten benannt und gepruft (tests/serve.test.mjs).
const http = require("http");
const fs = require("fs");
const path = require("path");

// `resolve` statt `join`: liefert immer einen absoluten, normalisierten Pfad.
const ROOT = path.resolve(__dirname, "..", "web");
const PORT = Number(process.env.PORT) || 8123;

// Standard ist ausschliesslich die Loopback-Adresse. Wer wirklich vom Handy im
// selben WLAN draufschauen will, muss es hinschreiben — und bekommt es gesagt.
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

/**
 * Welche Datei gehoert zu diesem Anfragepfad — oder keine?
 *
 * Gibt `null` zurueck, sobald irgendetwas nicht stimmt. Als eigene Funktion,
 * damit die Entscheidung pruefbar ist, ohne einen Server zu starten.
 */
function dateiFuer(url) {
  let p;
  try {
    // Kaputte Prozentfolgen wie `%zz` lassen decodeURIComponent werfen. Das
    // ist keine Datei, sondern Unsinn — und Unsinn wird abgewiesen, nicht
    // repariert.
    p = decodeURIComponent(String(url).split("?")[0].split("#")[0]);
  } catch (e) {
    return null;
  }

  // Ein Nullbyte kann in C-Bibliotheken eine Pfadangabe frueher enden lassen,
  // als sie hier aussieht.
  if (p.indexOf(String.fromCharCode(0)) !== -1) return null;

  // Rueckwaertsschraegstriche sind unter Windows Trennzeichen. Auf einem
  // POSIX-System waeren sie Teil des Dateinamens — hier trotzdem abgewiesen,
  // damit die Regel auf beiden Systemen dieselbe ist.
  if (p.indexOf("\\") !== -1) return null;

  if (p === "/" || p === "") p = "/index.html";

  const datei = path.resolve(ROOT, "." + path.posix.normalize(p));

  // Der eigentliche Punkt: ROOT SELBST oder etwas unterhalb — mit
  // Trennzeichen. Ohne das `+ path.sep` waere `<repo>/webheimlich` ein
  // gueltiger Treffer, weil es mit `<repo>/web` beginnt.
  if (datei !== ROOT && !datei.startsWith(ROOT + path.sep)) return null;

  return datei;
}

function bearbeite(req, res) {
  const datei = dateiFuer(req.url);
  if (!datei) {
    res.writeHead(404);
    return res.end("Not found");
  }
  let stat;
  try {
    stat = fs.statSync(datei);
  } catch (e) {
    res.writeHead(404);
    return res.end("Not found");
  }
  if (stat.isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(datei)] || "application/octet-stream",
  });
  fs.createReadStream(datei).pipe(res);
}

/** Server starten. Gibt die http.Server-Instanz zurueck, damit ein Test die
 *  tatsaechliche Adresse abfragen kann statt sie zu vermuten. */
function starte(port, host) {
  const server = http.createServer(bearbeite);
  server.listen(port === undefined ? PORT : port, host === undefined ? HOST : host);
  return server;
}

if (require.main === module) {
  const server = starte();
  server.on("listening", () => {
    const a = server.address();
    console.log(`Autobahn Strava preview → http://localhost:${a.port}`);
    if (a.address !== "127.0.0.1" && a.address !== "::1") {
      console.warn(
        `ACHTUNG: gebunden an ${a.address} — dieser Server ist damit aus dem ` +
          `Netz erreichbar. Ohne HOST= bindet er nur auf 127.0.0.1.`
      );
    }
  });
}

module.exports = { starte, dateiFuer, ROOT, PORT, HOST };
