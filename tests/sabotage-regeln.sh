#!/usr/bin/env bash
#
# Gegenprobe zu den Firestore-Regeln.
#
#   ./tests/sabotage-regeln.sh
#
# Warum: Diese Regeln sind eine Datenschutz-Schranke, und bis zum 09.09.2026
# gab es dafuer keinen einzigen Test. Ein gruener Regeltest beweist erst dann
# etwas, wenn gezeigt ist, dass er auch rot werden kann — sonst koennte er
# genauso gut gegen eine leere Regeldatei laufen.
#
# Zwei Richtungen:
#   1. Die Frist-Schranke faellt weg -> die "zu lang"-Faelle muessen rot werden
#   2. Der Urheber-Uebergang faellt weg -> das Loesen muss rot werden
#
# Ein blosser Exit-Code != 0 zaehlt NICHT. Verlangt wird ein benannter Fall.

set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/.." && pwd)"
cd "$WURZEL"

ZIEL="firestore.rules"
SICHERUNG="$(mktemp "${TMPDIR:-/tmp}/rules-original-XXXXXX")"
LOG="$(mktemp "${TMPDIR:-/tmp}/sabotage-regeln-XXXXXX.log")"
cp "$ZIEL" "$SICHERUNG"
zurueck() { cp "$SICHERUNG" "$ZIEL"; rm -f "$SICHERUNG" "$LOG"; }
trap zurueck EXIT

UNGUELTIG=0

oeffnen() {
  python3 -c 'import sys,pathlib
ziel, zu, auf = sys.argv[1:4]
p = pathlib.Path(ziel); t = p.read_text()
if zu not in t:
    sys.exit("FEHLER: erwartete Zeile fehlt in %s:\n  %s" % (ziel, zu))
p.write_text(t.replace(zu, auf, 1))' "$1" "$2" "$3"
}

erwarte_rot() {
  local titel="$1" muster="$2"
  echo "── $titel ──"
  npm run test:regeln > "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "  GEGENPROBE FEHLGESCHLAGEN: Die Regeltests blieben gruen, obwohl die" >&2
    echo "  Schranke weg war." >&2
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

# ── 1. Die Frist-Schranke faellt weg ─────────────────────────────────
echo
echo "Sabotage 1: expiresAt darf beliebig weit in der Zukunft liegen."
echo "Der 'zu lang'-Fall MUSS rot werden."
echo
oeffnen "$ZIEL" \
  "        && request.resource.data.expiresAt < request.time + duration.value(181, 'd');" \
  "        && request.resource.data.expiresAt > request.time;  // SABOTAGE"
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 1: die Aufbewahrungsfrist" \
            "zu lang: abgelehnt"
cp "$SICHERUNG" "$ZIEL"

# ── 2. Der Urheber-Uebergang faellt weg ──────────────────────────────
echo
echo "Sabotage 2: der Urheber laesst sich nicht mehr loesen."
echo "Das Loesen MUSS rot werden."
echo
oeffnen "$ZIEL" \
  "&& request.resource.data.createdBy == 'geloescht')" \
  "&& false)  // SABOTAGE"
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 2: das Loesen des Urhebers" \
            "der Urheber darf den Bezug loesen"
cp "$SICHERUNG" "$ZIEL"

zurueck
trap - EXIT
LOG2="$(mktemp "${TMPDIR:-/tmp}/sabotage-regeln-gruen-XXXXXX.log")"
npm run test:regeln > "$LOG2" 2>&1
ENDE=$?
ANZAHL="$(grep -oE '^# tests [0-9]+' "$LOG2" | grep -oE '[0-9]+')"
rm -f "$LOG2"
if [ "$ENDE" -ne 0 ]; then
  echo "FEHLER: Nach der Wiederherstellung sind die Regeltests nicht gruen." >&2
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
echo " Original wiederhergestellt, ${ANZAHL} Regelfaelle gruen"
echo "════════════════════════════════════════════"
