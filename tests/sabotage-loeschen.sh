#!/usr/bin/env bash
#
# Gegenprobe zu den vier Zusagen der DSGVO-Scheibe:
#
#   ./tests/sabotage-loeschen.sh
#
#   1. Ohne Einwilligung geht nichts hinaus — der Schalter allein reicht nicht.
#   2. "Alles loeschen" und der Export gehen ueber ALLE Seiten, nicht nur ueber
#      die erste.
#   3. Bricht es ab, bleibt die Kennung stehen — sonst waere der Weg zu den
#      restlichen Daten weg.
#   4. Geloescht wird auch das anonyme Firebase-Konto, nicht nur die Spur
#      davon auf diesem Geraet.
#
# Dazu eine fuenfte Richtung, die keine eigene Zusage ist, sondern die Falle
# darunter: `signIn()` legt bei einem Refresh-Fehler eine NEUE Identitaet an.
# Wer sie zum Loeschen benutzt, loescht eine frisch erzeugte leere Kennung,
# laesst die echten Daten online stehen und hat obendrein eine zusaetzliche
# Kennung erzeugt. Genau deshalb gibt es `bestehendeSitzung()` — und genau
# deshalb muss auffallen, wenn jemand es wieder zurueckdreht.
#
# Ein blosser Exit-Code != 0 zaehlt NICHT. Verlangt wird jeweils ein benannter
# roter Fall.
#
# Sabotiert wird die Quelldatei und danach aus einer Sicherung wiederhergestellt.

set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/.." && pwd)"
cd "$WURZEL"

ZIEL="web/js/cloud.js"
SICHERUNG="$(mktemp "${TMPDIR:-/tmp}/cloud-original-XXXXXX.js")"
LOG="$(mktemp "${TMPDIR:-/tmp}/sabotage-loeschen-XXXXXX.log")"
cp "$ZIEL" "$SICHERUNG"
zurueck() { cp "$SICHERUNG" "$ZIEL"; rm -f "$SICHERUNG" "$LOG"; }
trap zurueck EXIT

UNGUELTIG=0

oeffnen() {
  python3 -c 'import sys,pathlib
ziel, zu, auf = sys.argv[1:4]
p = pathlib.Path(ziel); t = p.read_text()
if zu not in t:
    sys.exit("FEHLER: erwartete Zeile fehlt in %s:\n  %s\nWurde der Code geaendert?"
             " Dann gehoert dieses Skript angepasst." % (ziel, zu))
p.write_text(t.replace(zu, auf, 1))' "$1" "$2" "$3"
}

erwarte_rot() {
  local titel="$1" muster="$2"
  echo "── $titel ──"
  npm test > "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "  GEGENPROBE FEHLGESCHLAGEN: Die Suite blieb gruen, obwohl die Zusage" >&2
    echo "  ausgehebelt war. Sie prueft sie also nicht." >&2
    tail -20 "$LOG" >&2
    UNGUELTIG=1
    return
  fi
  if ! grep -qF "not ok" "$LOG" || ! grep -qF "$muster" "$LOG"; then
    echo "  GEGENPROBE UNGUELTIG: Der Lauf ist zwar fehlgeschlagen, aber nicht" >&2
    echo "  wegen dieses Falls. Erwartet: \"$muster\"" >&2
    echo "  Tatsaechlich rot:" >&2
    grep "not ok" "$LOG" | head -8 | sed 's/^/    /' >&2
    UNGUELTIG=1
    return
  fi
  echo "  ok  rot geworden: $muster"
}

# ── 1. Der Schalter entscheidet wieder allein ────────────────────────
echo
echo "Sabotage 1: isEnabled() fragt die Einwilligung nicht mehr."
echo "Der Widerruf MUSS wirkungslos werden und der Fall rot."
echo
oeffnen "$ZIEL" \
  '    return localStorage.getItem(KEY_ENABLED) === "1" && hatEingewilligt();' \
  '    return localStorage.getItem(KEY_ENABLED) === "1";  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 1: die Einwilligung" \
            "Schalter an, Einwilligung widerrufen"
cp "$SICHERUNG" "$ZIEL"

# ── 2. Der Export bleibt auf der ersten Seite ────────────────────────
echo
echo "Sabotage 2: alleMeineEintraege() setzt den Cursor nicht weiter."
echo "Der 700-Eintraege-Export MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '      nach = seite[seite.length - 1].name;' \
  '      return alle;  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 2: der Export ueber Seiten" \
            "Export holt 700 Eintraege ueber drei Seiten"
cp "$SICHERUNG" "$ZIEL"

# ── 3. Loeschen laeuft nur einen Durchgang ───────────────────────────
# Genau der Zustand, den man von Hand nie bemerkt: mit zwanzig Fahrten sieht
# alles richtig aus, ab 301 bleibt der Rest online stehen.
echo
echo "Sabotage 3a: der Eintragslauf macht nur einen Durchgang."
echo "Die 700 Eintraege MUESSEN nicht leer werden."
echo
python3 -c 'import pathlib
p = pathlib.Path("web/js/cloud.js"); z = p.read_text().splitlines(True)
i = next(n for n,l in enumerate(z) if l.rstrip() == "        const seite = await seiteMeinerEintraege(s.uid, null);")
assert z[i-1].rstrip() == "      for (;;) {", z[i-1]
z[i-1] = "      for (let _s = 0; _s < 1; _s++) {  // SABOTAGE\n"
p.write_text("".join(z))' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 3a: Loeschen ueber Seiten" \
            "Alles loeschen raeumt 700 Eintraege leer"
cp "$SICHERUNG" "$ZIEL"

echo
echo "Sabotage 3b: der Streckenlauf macht nur einen Durchgang."
echo "Die Strecken jenseits der ersten Seite MUESSEN verknuepft bleiben."
echo
python3 -c 'import pathlib
p = pathlib.Path("web/js/cloud.js"); z = p.read_text().splitlines(True)
i = next(n for n,l in enumerate(z) if l.rstrip() == "        const seite = await meineSegmente(s.uid);")
assert z[i-1].rstrip() == "      for (;;) {", z[i-1]
z[i-1] = "      for (let _s = 0; _s < 1; _s++) {  // SABOTAGE\n"
p.write_text("".join(z))' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 3b: Strecken ueber Seiten" \
            "eigene Strecken werden auch jenseits der ersten Seite geloest"
cp "$SICHERUNG" "$ZIEL"

# ── 4. Bei einem Abbruch faellt die Kennung doch ─────────────────────
echo
echo "Sabotage 4: der Fehlerfall raeumt die Kennung mit weg."
echo "Der Abbruchfall MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '      const fehler = new Error(e.message || String(e));' \
  '      localStorage.removeItem(KEY_SESSION);  // SABOTAGE
      const fehler = new Error(e.message || String(e));' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 4: die Kennung beim Abbruch" \
            "laesst die Sitzung stehen"
cp "$SICHERUNG" "$ZIEL"

# ── 5. Das Konto bleibt stehen ───────────────────────────────────────
echo
echo "Sabotage 5: das anonyme Firebase-Konto wird nicht mehr geloescht."
echo "Der Kontofall MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '      await kontoLoeschen(s.idToken);' \
  '      /* SABOTAGE: Konto bleibt stehen */' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 5: das Konto" \
            "das anonyme Firebase-Konto wird mit dem eigenen Token geloescht"
cp "$SICHERUNG" "$ZIEL"

# ── 6. Loeschen legt sich wieder selbst eine Kennung an ──────────────
echo
echo "Sabotage 6: deleteAllMine() nimmt wieder signIn() statt bestehendeSitzung()."
echo "Das Loeschen wuerde eine frische leere Kennung anlegen — MUSS auffallen."
echo
oeffnen "$ZIEL" \
  '    const s = await bestehendeSitzung();' \
  '    const s = await signIn();  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 6: keine neue Kennung zum Loeschen" \
            "ohne Sitzung sagt Loeschen nein"
cp "$SICHERUNG" "$ZIEL"

# Zurueck aufs Original und nachweisen, dass wieder alles gruen ist.
zurueck
trap - EXIT
LOG2="$(mktemp "${TMPDIR:-/tmp}/sabotage-loeschen-gruen-XXXXXX.log")"
npm test > "$LOG2" 2>&1
ENDE=$?
ANZAHL="$(grep -oE '^# tests [0-9]+' "$LOG2" | grep -oE '[0-9]+')"
rm -f "$LOG2"
if [ "$ENDE" -ne 0 ]; then
  echo "FEHLER: Nach der Wiederherstellung sind die Tests nicht gruen." >&2
  exit 1
fi

echo
if [ "$UNGUELTIG" -ne 0 ]; then
  echo "════════════════════════════════════════════"
  echo " GEGENPROBE UNGUELTIG"
  echo "════════════════════════════════════════════"
  exit 1
fi
echo "════════════════════════════════════════════"
echo " GEGENPROBE BESTANDEN"
echo " Original wiederhergestellt, ${ANZAHL} Tests gruen"
echo "════════════════════════════════════════════"
