# Kosten-Tracker

Ein privater Kosten-Tracker für Einnahmen und Ausgaben, der direkt im Browser läuft.
Es gibt keinen Server und kein Konto, und deine Daten verlassen dein Gerät nicht.

**Live-Version:** https://maxwarlich.github.io/kostentracker/


## Funktionen

- **Einträge:** Einnahmen und Ausgaben mit Betrag, Datum, Kategorie und optionaler Notiz erfassen, bearbeiten und löschen
- **Kategorien:** eigene Kategorien anlegen, umbenennen und löschen, getrennt nach Einnahmen und Ausgaben
- **Monatsübersicht:** Monat wählen und Summe der Einnahmen, Summe der Ausgaben, Saldo und Summen pro Kategorie sehen
- **Diagramme:** Kreisdiagramm der Ausgaben nach Kategorie und Balkendiagramm Einnahmen vs. Ausgaben der letzten 6 Monate
- **Wiederkehrende Posten:** z. B. Miete, Handyvertrag oder Gehalt werden jeden Monat am eingestellten Tag automatisch eingetragen, ohne Duplikate. Posten lassen sich pausieren, bearbeiten und löschen.
- **Suche & Filter:** nach Text, Kategorie, Typ und Zeitraum filtern
- **Hell- und Dunkelmodus:** per Button umschaltbar, die Auswahl wird gespeichert
- **Responsiv:** funktioniert auf Handy, Tablet und PC
- **Deutsches Format:** 1.234,56 € und TT.MM.JJJJ
- **Datensicherung:** alle Daten als JSON-Datei exportieren und wieder importieren

## Wo werden meine Daten gespeichert?

Im `localStorage` deines Browsers. Das bedeutet:

- Die Daten bleiben **nur auf diesem Gerät und in diesem Browser**.
- Wenn du die Browserdaten bzw. den Verlauf inklusive „Websitedaten“ löschst, sind auch die Einträge weg.
  Nutze deshalb regelmäßig **Kategorien → Daten exportieren**.
- Um die Daten auf ein anderes Gerät zu bringen, exportierst du sie dort und importierst sie auf dem neuen Gerät.
- Die Website auf GitHub Pages ist öffentlich, **deine Daten aber nicht**: Jeder Besucher sieht nur seine eigenen, leeren Daten.

## Lokal ausprobieren

Doppelklicke auf `index.html`, dann öffnet sich die App im Browser.

Alternativ startest du im Terminal im Projektordner einen kleinen lokalen Server:

```bash
python3 -m http.server 8000
```

Danach öffnest du http://localhost:8000 im Browser.

## Technik

- HTML, CSS und Vanilla JavaScript, ohne Framework und ohne Build-Schritt
- [Chart.js](https://www.chartjs.org/) 4 über das jsDelivr-CDN für die Diagramme
- Dateien:
  - `index.html`: Aufbau der Seite und Dialoge
  - `style.css`: Design, Hell-/Dunkelmodus und Handy-Ansicht
  - `app.js`: gesamte Logik (Speichern, Berechnungen, Diagramme, wiederkehrende Posten)
