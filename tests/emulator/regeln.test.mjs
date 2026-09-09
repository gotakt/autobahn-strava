/**
 * Die Firestore-Regeln gegen den Emulator.
 *
 * Grund: Diese Regeln sind eine Datenschutz-Schranke. Bis zum 09.09.2026 gab
 * es dafuer keinen einzigen Test — der CI-Kopf sagte das selbst. Gruene
 * JavaScript-Tests beweisen ueber eine Regel nichts: sie laufen nie durch sie
 * hindurch.
 *
 * Schwerpunkt liegt auf den VERWEIGERUNGEN. Eine Regel, bei der nur der
 * Erfolgsfall geprueft wird, ist ungeprueft.
 *
 * Diese Datei liegt bewusst in `tests/emulator/` und nicht neben den
 * uebrigen Suiten: `npm test` matcht `tests/*.test.mjs`, und ohne
 * laufenden Emulator wirft `before()`. `node --test` meldet die Faelle
 * dann als `cancelled` bei `fail 0` — eine Zeile, die gruen aussieht,
 * obwohl 19 Pruefungen gar nicht stattgefunden haben. Getrennter Ordner,
 * getrennter Aufruf, kein Zweifel darueber, was gelaufen ist.
 *
 * Start:  npm run test:regeln
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp } from "firebase/firestore";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = 86400000;

let umgebung;

/** Ein gueltiger Eintrag. Einzelne Felder lassen sich ueberschreiben, um
 *  genau eine Sache kaputt zu machen — sonst wuesste man bei einer Ablehnung
 *  nicht, welche Bedingung gegriffen hat. */
function eintrag(uid, aenderung) {
  return {
    segmentId: "a2-hannover-braunschweig",
    uid,
    nickname: "TestOtter1",
    score: 90,
    avgKmh: 110,
    sustainedKmh: 125,
    hardBraking: 0,
    distanceM: 50000,
    durationSec: 1800,
    speedTrack: [100, 110, 120],
    area: "Hannover",
    roadType: "autobahn",
    withinLimit: true,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 180 * TAG),
    ...aenderung,
  };
}

before(async () => {
  umgebung = await initializeTestEnvironment({
    projectId: "autobahn-regeltest",
    firestore: { rules: readFileSync(join(WURZEL, "firestore.rules"), "utf8") },
  });
});

after(async () => umgebung?.cleanup());
beforeEach(async () => umgebung.clearFirestore());

const alsWer = (uid) => umgebung.authenticatedContext(uid).firestore();
const ohneAnmeldung = () => umgebung.unauthenticatedContext().firestore();

describe("entries: die Aufbewahrungsfrist ist eine Schranke, keine Bitte", () => {
  test("rund 180 Tage voraus wird angenommen", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "entries", "e1"), eintrag("uid-a")));
  });

  test("ohne expiresAt: abgelehnt", async () => {
    const db = alsWer("uid-a");
    const d = eintrag("uid-a");
    delete d.expiresAt;
    await assertFails(setDoc(doc(db, "entries", "e2"), d));
  });

  test("falscher Typ: abgelehnt", async () => {
    const db = alsWer("uid-a");
    await assertFails(
      setDoc(doc(db, "entries", "e3"), eintrag("uid-a", { expiresAt: "in 180 Tagen" })),
    );
  });

  test("zu kurz: abgelehnt", async () => {
    const db = alsWer("uid-a");
    await assertFails(
      setDoc(doc(db, "entries", "e4"), eintrag("uid-a", { expiresAt: new Date(Date.now() + 30 * TAG) })),
    );
  });

  test("zu lang: abgelehnt — niemand stellt sich eine laengere Frist aus", async () => {
    const db = alsWer("uid-a");
    await assertFails(
      setDoc(doc(db, "entries", "e5"), eintrag("uid-a", { expiresAt: new Date(Date.now() + 3650 * TAG) })),
    );
  });

  test("knapp ausserhalb der Toleranz: abgelehnt", async () => {
    const db = alsWer("uid-a");
    for (const tage of [178, 182]) {
      await assertFails(
        setDoc(doc(db, "entries", "e" + tage), eintrag("uid-a", { expiresAt: new Date(Date.now() + tage * TAG) })),
      );
    }
  });
});

describe("entries: die uebrigen Schranken gelten weiter", () => {
  test("ohne Anmeldung: nichts", async () => {
    await assertFails(setDoc(doc(ohneAnmeldung(), "entries", "x"), eintrag("uid-a")));
  });

  test("nicht unter fremder Kennung schreiben", async () => {
    await assertFails(setDoc(doc(alsWer("uid-a"), "entries", "x"), eintrag("uid-b")));
  });

  test("unplausible Geschwindigkeit: abgelehnt", async () => {
    await assertFails(
      setDoc(doc(alsWer("uid-a"), "entries", "x"), eintrag("uid-a", { sustainedKmh: 500 })),
    );
  });

  test("withinLimit muss ein Boolescher Wert sein", async () => {
    await assertFails(
      setDoc(doc(alsWer("uid-a"), "entries", "x"), eintrag("uid-a", { withinLimit: "ja" })),
    );
  });

  test("unbekanntes Feld: abgelehnt", async () => {
    await assertFails(
      setDoc(doc(alsWer("uid-a"), "entries", "x"), eintrag("uid-a", { heimlich: "etwas" })),
    );
  });

  test("Eintraege sind unveraenderlich", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "entries", "e1"), eintrag("uid-a")));
    await assertFails(updateDoc(doc(db, "entries", "e1"), { score: 100 }));
  });

  test("jeder darf seine eigenen loeschen, fremde nicht", async () => {
    await assertSucceeds(setDoc(doc(alsWer("uid-a"), "entries", "e1"), eintrag("uid-a")));
    await assertFails(deleteDoc(doc(alsWer("uid-b"), "entries", "e1")));
    await assertSucceeds(deleteDoc(doc(alsWer("uid-a"), "entries", "e1")));
  });
});

describe("segments: der Urheber laesst sich loesen, die Strecke bleibt", () => {
  function strecke(uid) {
    return {
      name: "Hannover → Braunschweig",
      autobahn: "A2",
      roadType: "autobahn",
      limitKmh: null,
      from: { lat: 52.3897, lon: 9.8471 },
      to: { lat: 52.3167, lon: 10.5045 },
      createdBy: uid,
      createdAt: serverTimestamp(),
    };
  }

  test("der Urheber darf den Bezug loesen", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "segments", "s1"), strecke("uid-a")));
    await assertSucceeds(updateDoc(doc(db, "segments", "s1"), { createdBy: "geloescht" }));
    const danach = await getDoc(doc(alsWer("uid-a"), "segments", "s1"));
    assert.equal(danach.data().createdBy, "geloescht");
    assert.equal(danach.data().name, "Hannover → Braunschweig", "die Strecke ist mitverschwunden");
  });

  test("danach hat niemand mehr Rechte daran", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "segments", "s1"), strecke("uid-a")));
    await assertSucceeds(updateDoc(doc(db, "segments", "s1"), { createdBy: "geloescht" }));
    await assertFails(updateDoc(doc(db, "segments", "s1"), { name: "Neu" }));
    await assertFails(deleteDoc(doc(db, "segments", "s1")));
  });

  test("createdBy auf eine FREMDE Kennung umbiegen: abgelehnt", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "segments", "s1"), strecke("uid-a")));
    await assertFails(updateDoc(doc(db, "segments", "s1"), { createdBy: "uid-b" }));
  });

  test("eine fremde Strecke kann niemand loesen", async () => {
    await assertSucceeds(setDoc(doc(alsWer("uid-a"), "segments", "s1"), strecke("uid-a")));
    await assertFails(updateDoc(doc(alsWer("uid-b"), "segments", "s1"), { createdBy: "geloescht" }));
  });

  test("Umbenennen bleibt erlaubt", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "segments", "s1"), strecke("uid-a")));
    await assertSucceeds(updateDoc(doc(db, "segments", "s1"), { name: "Anders" }));
  });

  test("zwei Felder auf einmal: abgelehnt", async () => {
    const db = alsWer("uid-a");
    await assertSucceeds(setDoc(doc(db, "segments", "s1"), strecke("uid-a")));
    await assertFails(
      updateDoc(doc(db, "segments", "s1"), { name: "Anders", createdBy: "geloescht" }),
    );
  });
});
