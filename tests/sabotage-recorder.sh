#!/usr/bin/env bash
#
# Gegenprobe zum nativen Aufnahme-Lebenszyklus:
#
#   Nach stop() darf kein noch ausstehender addWatcher() einen aktiven
#   Watcher hinterlassen.
#
#   ./tests/sabotage-recorder.sh
#
# Das ist kein Komfortthema. `Info.plist` verspricht, die Aufzeichnung laufe
# "nur zwischen Start und Stopp", und mit `UIBackgroundModes: location` heisst
# ein uebriggebliebener Watcher Standortverfolgung bei gesperrtem Bildschirm,
# nachdem der Nutzer Stopp gedrueckt hat.
#
# Zwei Richtungen:
#   1. Die Ueberholt-Pruefung im addWatcher-Rueckweg faellt weg
#      -> der Stopp-vor-Aufloesung-Fall muss rot werden
#   2. stop() macht den Lauf nicht mehr ungueltig
#      -> derselbe Fall muss rot werden, aus der anderen Richtung
#
# Ein blosser Exit-Code != 0 zaehlt NICHT. Verlangt wird ein benannter roter
# Fall.

set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/.." && pwd)"
cd "$WURZEL"

ZIEL="web/js/geo.js"
SICHERUNG="$(mktemp "${TMPDIR:-/tmp}/geo-original-XXXXXX.js")"
LOG="$(mktemp "${TMPDIR:-/tmp}/sabotage-recorder-XXXXXX.log")"
cp "$ZIEL" "$SICHERUNG"
zurueck() { cp "$SICHERUNG" "$ZIEL"; rm -f "$SICHERUNG" "$LOG"; }
trap zurueck EXIT

UNGUELTIG=0

oeffnen() {
  python3 -c 'import sys,pathlib
ziel, zu, auf = sys.argv[1:4]
p = pathlib.Path(ziel); t = p.read_text()
if zu not in t:
    sys.exit("FEHLER: erwartete Zeile fehlt in %s:\n  %s\nWurde der Recorder geaendert?"
             " Dann gehoert dieses Skript angepasst." % (ziel, zu))
p.write_text(t.replace(zu, auf, 1))' "$1" "$2" "$3"
}

erwarte_rot() {
  local titel="$1" muster="$2"
  echo "── $titel ──"
  npm test > "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "  GEGENPROBE FEHLGESCHLAGEN: Die Suite blieb gruen, obwohl die" >&2
    echo "  Abbruchpruefung ausgehebelt war." >&2
    tail -20 "$LOG" >&2
    UNGUELTIG=1
    return
  fi
  if ! grep -qF "not ok" "$LOG" || ! grep -qF "$muster" "$LOG"; then
    echo "  GEGENPROBE UNGUELTIG: rot, aber nicht wegen dieses Falls." >&2
    echo "  Erwartet: \"$muster\"" >&2
    grep "not ok" "$LOG" | head -8 | sed 's/^/    /' >&2
    UNGUELTIG=1
    return
  fi
  echo "  ok  rot geworden: $muster"
}

# ── 1. Der Rueckweg prueft nicht mehr, ob er ueberholt ist ───────────
echo
echo "Sabotage 1: der addWatcher-Rueckweg uebernimmt die Id ungeprueft."
echo "Der Stopp-vor-Aufloesung-Fall MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '        if (ueberholt()) {' \
  '        if (false) {  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 1: die Ueberholt-Pruefung" \
            "DER FALL: Stopp bevor addWatcher aufloest"
cp "$SICHERUNG" "$ZIEL"

# ── 2. stop() macht den Lauf nicht mehr ungueltig ────────────────────
# Aus der anderen Richtung: die Pruefung bleibt, aber sie kann nie zutreffen.
echo
echo "Sabotage 2: stop() erhoeht den Laufzaehler nicht mehr."
echo "Derselbe Fall MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '    this.lauf++;
    if (this.watchId !== null) {' \
  '    if (this.watchId !== null) {  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 2: die Ungueltigmachung beim Stopp" \
            "DER FALL: Stopp bevor addWatcher aufloest"
cp "$SICHERUNG" "$ZIEL"

zurueck
trap - EXIT
LOG2="$(mktemp "${TMPDIR:-/tmp}/sabotage-recorder-gruen-XXXXXX.log")"
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
