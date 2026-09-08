#!/usr/bin/env bash
#
# Gegenprobe zu den zwei Zusagen des Vorschau-Servers:
#
#   1. Er hoert nur auf die eigene Maschine.
#   2. Er liefert nur Dateien aus web/ aus.
#
#   ./tests/sabotage-serve.sh
#
# Beide waren bis zum 09.09.2026 gebrochen, und es ist niemandem aufgefallen —
# weil nichts sie geprueft hat. Ein gruener Test beweist erst dann etwas, wenn
# gezeigt ist, dass er auch rot werden kann.
#
# Zwei Richtungen, je eine pro Zusage:
#
#   1. `listen(port)` ohne Host  -> die Bindungspruefung muss anschlagen
#   2. Die alte Pfadaufloesung zurueck -> der Nachbarordner muss wieder
#      durchkommen und genau der dafuer zustaendige Fall rot werden
#
# Zu 2 ein Befund, der beim Schreiben dieser Gegenprobe herauskam: den
# Trennzeichen-Test ALLEIN auszuhebeln reicht nicht, um den Nachbarordner
# wieder erreichbar zu machen. Die Anfrage wird vorher als POSIX-Pfad
# normalisiert und gegen ROOT aufgeloest, und dabei faellt ein fuehrendes
# `..` weg. Zwei unabhaengige Schichten also — und genau deshalb sabotiert
# dieser Fall den kompletten alten Weg (`path.join` plus praefixfreier
# Vergleich) statt einer einzelnen Zeile. Alles andere waere eine Sabotage,
# die nichts sabotiert.
#
# Ein blosser Exit-Code != 0 zaehlt NICHT. Verlangt wird jeweils ein benannter
# roter Fall.
#
# Sabotiert wird die Quelldatei und danach aus einer Sicherung wiederhergestellt.

set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/.." && pwd)"
cd "$WURZEL"

ZIEL="scripts/serve.js"
SICHERUNG="$(mktemp "${TMPDIR:-/tmp}/serve-original-XXXXXX.js")"
LOG="$(mktemp "${TMPDIR:-/tmp}/sabotage-serve-XXXXXX.log")"
cp "$ZIEL" "$SICHERUNG"
zurueck() { cp "$SICHERUNG" "$ZIEL"; rm -f "$SICHERUNG" "$LOG"; }
trap zurueck EXIT

UNGUELTIG=0

oeffnen() {
  python3 -c 'import sys,pathlib
ziel, zu, auf = sys.argv[1:4]
p = pathlib.Path(ziel); t = p.read_text()
if zu not in t:
    sys.exit("FEHLER: erwartete Zeile fehlt in %s:\n  %s\nWurde der Server geaendert?"
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

# ── 1. Ohne Host binden ──────────────────────────────────────────────
# Genau der alte Zustand: Node bindet dann auf alle Schnittstellen.
echo
echo "Sabotage 1: der Server bindet wieder ohne Host-Angabe."
echo "Die Bindungspruefung MUSS anschlagen."
echo
oeffnen "$ZIEL" \
  '  server.listen(port === undefined ? PORT : port, host === undefined ? HOST : host);' \
  '  server.listen(port === undefined ? PORT : port);  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 1: die Bindung" \
            "die tatsaechliche Adresse ist die Loopback-Adresse"
cp "$SICHERUNG" "$ZIEL"

# ── 2. Die alte Pfadaufloesung zurueck ───────────────────────────────
# Wortwoertlich der Stand von vor dem 09.09.2026: `path.join` auf den rohen
# Pfad, danach ein Praefixvergleich ohne Trennzeichen. `<repo>/webheimlich`
# faengt mit `<repo>/web` an und galt damit als "innerhalb".
echo
echo "Sabotage 2: die alte Pfadaufloesung ist zurueck."
echo "Der Nachbarordner MUSS wieder durchkommen."
echo
oeffnen "$ZIEL" \
  '  const datei = path.resolve(ROOT, "." + path.posix.normalize(p));' \
  '  const datei = path.join(ROOT, p);  // SABOTAGE' || exit 1
oeffnen "$ZIEL" \
  '  if (datei !== ROOT && !datei.startsWith(ROOT + path.sep)) return null;' \
  '  if (!datei.startsWith(ROOT)) return null;' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 2: die Pfadgrenze" \
            "bleibt zu — der eigentliche Befund"
cp "$SICHERUNG" "$ZIEL"

# Zurueck aufs Original und nachweisen, dass wieder alles gruen ist.
zurueck
trap - EXIT
LOG2="$(mktemp "${TMPDIR:-/tmp}/sabotage-serve-gruen-XXXXXX.log")"
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
