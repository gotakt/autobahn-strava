#!/usr/bin/env bash
#
# Gegenprobe zur Zusage "kein Tempo-Ranking auf oeffentlichen Strassen".
#
#   ./tests/sabotage-legalspeed.sh
#
# Warum: Eine gruene Testsuite beweist nichts, solange niemand gezeigt hat, dass
# sie auch rot werden kann. Diese Zusage traegt das ganze Produkt — und sie war
# bis zum 08.09.2026 gebrochen, ohne dass irgendetwas es gemerkt haette, weil es
# in diesem Repository keinen einzigen automatischen Test gab.
#
# Vier Richtungen. Zwei davon, weil es zwei Wege in die Rangliste gibt und der
# Fehler genau darin bestand, dass nur einer geprueft wurde; zwei kamen am
# 09.09.2026 dazu, nachdem die Gegenpruefung zwei weitere Luecken fand:
#
#   1. Der Filter im Praedikat wird ausgehebelt
#      -> der 118-km/h-Fall auf dem 100er-Abschnitt muss rot werden
#   2. Der Mischschritt laesst Online-Zeilen wieder vorbei
#      -> genau der Online-Fall muss rot werden
#   3. Der Legalitaetsnachweis wird nicht mehr verlangt
#      -> die kurze Ueberschreitung, die im 5-s-Mittel verschwindet, muss
#         wieder durchkommen und der dafuer zustaendige Fall rot werden
#   4. Die Deduplizierung greift wieder auf die falsche Id
#      -> die veroeffentlichte Fahrt steht doppelt und der Fall wird rot
#
# Ein blosser Exit-Code != 0 zaehlt NICHT. Ein Tippfehler oder ein kaputter
# Testlauf wuerden ebenfalls scheitern und diese Gegenprobe faelschlich bestehen
# lassen. Verlangt wird jeweils ein benannter roter Fall.
#
# Sabotiert wird eine Kopie im Temporaerverzeichnis, die dem Test per
# Umgebungsvariable untergeschoben wird; die Quelldatei bleibt unberuehrt.

set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/.." && pwd)"
cd "$WURZEL"

ZIEL="web/js/store.js"
SICHERUNG="$(mktemp "${TMPDIR:-/tmp}/store-original-XXXXXX.js")"
LOG="$(mktemp "${TMPDIR:-/tmp}/sabotage-legalspeed-XXXXXX.log")"
cp "$ZIEL" "$SICHERUNG"
zurueck() { cp "$SICHERUNG" "$ZIEL"; rm -f "$SICHERUNG" "$LOG"; }
trap zurueck EXIT

UNGUELTIG=0

# Woertlich ersetzen, nicht per Regex — und vorher pruefen, dass es die Zeile
# ueberhaupt noch gibt. Eine Sabotage, die nichts sabotiert, ist schlimmer als
# keine: sie gaebe Entwarnung, ohne etwas geprueft zu haben.
oeffnen() {
  python3 -c 'import sys,pathlib
ziel, zu, auf = sys.argv[1:4]
p = pathlib.Path(ziel); t = p.read_text()
if zu not in t:
    sys.exit("FEHLER: erwartete Zeile fehlt in %s:\n  %s\nWurde die Regel geaendert?"
             " Dann gehoert dieses Skript angepasst." % (ziel, zu))
p.write_text(t.replace(zu, auf, 1))' "$1" "$2" "$3"
}

erwarte_rot() {
  local titel="$1" muster="$2"
  echo "── $titel ──"
  npm test > "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "  GEGENPROBE FEHLGESCHLAGEN: Die Suite blieb gruen, obwohl die Regel" >&2
    echo "  ausgehebelt war. Sie prueft die Zusage also nicht." >&2
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

# ── 1. Das Praedikat laesst alles durch ──────────────────────────────
# Genau der Zustand von vor der Reparatur: auf einem Abschnitt ohne Limit
# wurde nicht gefiltert. Hier noch eine Stufe schaerfer — es wird gar nicht
# mehr gefiltert.
echo
echo "Sabotage 1: legalSpeedZulaessig() sagt zu jeder Zeile ja."
echo "Der 118-km/h-Fall auf dem 100er-Abschnitt MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '    if (!legalSpeedVerfuegbar(seg)) return false;' \
  '    return true;  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 1: der Legalitaetsfilter" \
            "eine Fahrt ueber dem Limit kommt nicht hinein"
cp "$SICHERUNG" "$ZIEL"

# ── 2. Der Mischschritt filtert nicht ────────────────────────────────
# Das war der eigentliche Befund: der Filter existierte, aber der Online-Weg
# lief daran vorbei. Wer ihn hier wieder herausnimmt, stellt genau den alten
# Fehler her — und muss dabei erwischt werden.
echo
echo "Sabotage 2: mischeRanglisten() haengt Online-Zeilen ungefiltert an."
echo "Der Online-Fall MUSS rot werden."
echo
oeffnen "$ZIEL" \
  '      const erlaubt = zeilen.filter((r) => legalSpeedZulaessig(r, seg));' \
  '      const erlaubt = zeilen.slice();  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 2: der Mischschritt" \
            "ein Ueber-Limit-Eintrag kommt beim Mischen NICHT zurueck"
cp "$SICHERUNG" "$ZIEL"

# ── 3. Der Legalitaetsnachweis wird nicht mehr verlangt ──────────────
# Genau der Zustand von vor dem 09.09.2026: entschieden wurde allein ueber
# das Fuenf-Sekunden-Mittel. Eine kurze Spitze auf 130 km/h verschwindet
# darin und die Fahrt galt als legal.
echo
echo "Sabotage 3: withinLimit wird nicht mehr geprueft."
echo "Die kurze Ueberschreitung MUSS wieder durchkommen und den Fall rot machen."
echo
oeffnen "$ZIEL" \
  '    return row.withinLimit === true;' \
  '    return true;  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 3: der Legalitaetsnachweis" \
            "kurze Ueberschreitung"
cp "$SICHERUNG" "$ZIEL"

# ── 4. Die Deduplizierung greift auf die falsche Id ──────────────────
# Der stille Dauerfehler: das Set wurde aus `publishedId` gebaut, also aus
# Online-Ids, und gegen die lokale Id der Ranglistenzeile gehalten. Die
# treffen sich nie — die eigene veroeffentlichte Fahrt stand doppelt da.
echo
echo "Sabotage 4: das Set enthaelt wieder die Online-Ids statt der lokalen."
echo "Die veroeffentlichte Fahrt MUSS doppelt auftauchen."
echo
oeffnen "$ZIEL" \
  '    return new Set(getTrips().filter((t) => t.publishedId).map((t) => t.id));' \
  '    return new Set(getTrips().map((t) => t.publishedId).filter(Boolean));  // SABOTAGE' || exit 1
grep -qF "SABOTAGE" "$ZIEL" || { echo "FEHLER: sabotierte Fassung nicht erzeugt." >&2; exit 1; }
erwarte_rot "Sabotage 4: die Deduplizierung" \
            "zaehlt nicht doppelt"
cp "$SICHERUNG" "$ZIEL"

# Zurueck aufs Original und nachweisen, dass wieder alles gruen ist — sonst
# koennte die Gegenprobe eine kaputte Fassung hinterlassen.
zurueck
trap - EXIT
LOG2="$(mktemp "${TMPDIR:-/tmp}/sabotage-gruen-XXXXXX.log")"
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
