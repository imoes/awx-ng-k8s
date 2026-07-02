# Playbook Builder — Anleitung

Der Playbook Builder (**Resources → Playbook Builder**) ist ein visueller Editor, mit dem man
Ansible-Playbooks und Rollen per Drag & Drop zusammenstecken kann, ohne YAML von Hand zu
schreiben. Diese Anleitung erklärt die Grundbegriffe, den Workflow und die Grenzen des Tools.

## Grundbegriffe (Ansible ↔ Blockly)

| Ansible-Konzept | Im Builder |
|---|---|
| **Play** (`hosts:`, `tasks:`, `roles:`, …) | grüner **Play**-Block — genau einer pro Playbook-Datei |
| **Task** (ein Modul-Aufruf mit `name:`, `when:`, …) | jeder **Modul-Block** (z.B. `apt`, `copy`, `debug`) ist *gleichzeitig* der Task — kein separater Task-Wrapper nötig |
| **Role** (`roles: [...]`) | violetter **role_use**-Block, mit oder ohne eigene `vars:` |
| Nicht-erkannte/exotische Konstrukte | **raw task** (Rot) — hält das Original-YAML unverändert |

Ein Modul-Block ist also direkt ein Task-Baustein: man zieht ihn aus der **Modules**-Rubrik in
die `tasks:`-Liste eines Play-Blocks (oder — im Rollen-Modus — direkt aneinander, ohne Play).

## Schnellstart

1. **☰ (Datei-Menü, oben links) → New playbook** — legt einen leeren Play-Block an.
2. Play-Felder ausfüllen: `hosts:` (z.B. `all` oder `webservers`), optional `become` anhaken.
3. In der Navbar oben auf **Modules** klicken, ein Modul (z.B. `apt`) auf die Canvas ziehen und
   in den `tasks:`-Slot des Play-Blocks einklinken.
4. Pflichtfelder ausfüllen (mit `*` markiert). Der Block zeigt standardmäßig nur die
   Pflicht- und die gängigsten Parameter — alles andere über **„+ add parameter…"**.
5. Task-Einstellungen wie `when:`, `tags:`, `register:`, `loop:` kommen über das separate
   **„+ add task setting…"**-Dropdown dazu (bewusst getrennt vom Modul-eigenen Dropdown).
6. Rechts sieht man live die generierte YAML. Über **☰ → Save to / Lint & Save** wird geprüft
   (YAML-Syntax + ansible-lint) und ins Projekt geschrieben.

## Modul-Parameter: Typen & Eingabeformat

Jedes Modul-Feld kennt seinen Ansible-Datentyp (aus `ansible-doc`) und verhält sich entsprechend:

- **Text/Pfad** (`str`, `path`): normales Eingabefeld, akzeptiert auch mehrzeilige Werte
  (z.B. Shell-Skripte in `command`/`shell`, Dateiinhalt in `copy.content`) — Enter erzeugt
  einen Zeilenumbruch.
- **Auswahl** (`choices`): Dropdown statt Freitext (z.B. `state:` bei `file`, `service`, `apt`, …).
  Erste Option ist immer „(unset)" — bleibt sie stehen, wird der Parameter gar nicht erst
  mit ausgegeben.
- **Ja/Nein** (`bool`): Checkbox. Nicht angehakt = Parameter wird weggelassen (es gibt aktuell
  keine Möglichkeit, „explizit false" von „nicht gesetzt" zu unterscheiden).
- **Liste** `[list]` (z.B. `apt.name` für mehrere Pakete): entweder kurz durch Komma getrennt
  eintragen (`nginx, curl, git`) **oder** vollständige YAML-Listensyntax
  (`- nginx`⏎`- curl`⏎`- git`) — beides wird zu einer echten YAML-Liste.
- **Dict** `{dict}` (z.B. `set_stats.data`): als YAML-Mapping eintragen
  (`foo: bar`⏎`count: 3`).
- **Zahl** (`int`, `float`): wird beim Speichern automatisch in eine echte Zahl umgewandelt
  (kein `"3"`, sondern `3`).

## Task-Einstellungen (immer über „+ add task setting…")

| Einstellung | Bedeutung |
|---|---|
| `when:` | Bedingung |
| `tags:` | Kommagetrennte Tag-Liste |
| `notify:` | Kommagetrennte Handler-Liste |
| `register:` | Variablenname für das Ergebnis |
| `loop:` | Schleife über eine Liste (Kurzform oder volle YAML-Liste) — ersetzt auch das ältere `with_items:` beim Import (siehe unten) |
| `delegate_to:` | Task auf einem anderen Host ausführen |
| `become:` / `ignore_errors:` | Checkboxen |

## Rollen verwenden

In der **Roles**-Rubrik erscheint automatisch jede im aktuell gewählten Projekt gefundene Rolle
als fertiger Block — einfach reinziehen (landet im separaten `roles:`-Slot des Play-Blocks,
nicht bei den Tasks). Im `vars (optional):`-Feld können projektspezifische Rollen-Variablen als
YAML-Mapping mitgegeben werden.

## Bestehende Playbooks/Rollen öffnen (Import)

**☰ → Open playbook…** bzw. **Open role…** listet alle Dateien des gewählten Projekts. Beim
Öffnen wird zuerst ein gespeichertes Layout (`<datei>.blockly.json`) geladen, falls vorhanden
— sonst wird die YAML direkt geparst:

- Erkannte `ansible.builtin.*`-Module (auch in der Kurzform `modul: key=value` und mit
  vollqualifiziertem Namen) werden zu typisierten Blöcken, inklusive Listen-/Dict-Parametern.
- Nicht erkannte Module (andere Collections, z.B. `community.general.*`) oder Konstrukte ohne
  eindeutiges Modul (`block:`/`rescue:`/`always:`) landen unverändert in einem **raw task**-Block
  — nichts geht verloren, es lässt sich nur (noch) nicht grafisch bearbeiten.
- `with_items:` wird als Alias für `loop:` erkannt; beim erneuten Speichern wird immer die
  moderne Schreibweise `loop:` erzeugt.
- Parameter-Aliase aus der Ansible-Dokumentation werden erkannt (z.B. `dest:`/`name:` statt
  `path:` bei `ansible.builtin.file`, `pkg:`/`package:` statt `name:` bei `apt`, `unit:` statt
  `name:` bei `systemd`) — der Block speichert intern immer den kanonischen Parameternamen.
- Play-Level-Schlüssel ohne eigenen Block (`vars:`, `environment:`, …) landen im `extra`-Feld
  des Play-Blocks als YAML — `roles:` bekommt dagegen eigene, typisierte Blöcke.

## Variablen-Palette

Rechts werden die Variablen angezeigt, die zum **aktuell offenen** Playbook/zur Rolle passen
(Rollen-Variablen der verwendeten Rollen + alle Ansible-Vault-Variablen), inklusive Wertvorschau.
Eine Variable auf ein Modul-Textfeld ziehen fügt `{{ variable }}` ein.

## Bekannte Grenzen

- Ein Play-Block/eine Canvas entspricht **einer** Playbook-Datei bzw. **einer** Rollen-`tasks/main.yml`
  — kein Multi-Play- oder Multi-Datei-Editing in einer Sitzung.
- Module außerhalb von `ansible.builtin` (Collections wie `community.general`) haben keinen
  eigenen Block-Typ — sie werden als `raw task` importiert/erzeugt (Original-YAML bleibt erhalten).
- `block:`/`rescue:`/`always:`-Strukturen haben (noch) keinen eigenen Block und werden als
  `raw task` dargestellt.
- Checkbox-Felder können „nicht gesetzt" nicht von „explizit false" unterscheiden.

## Technischer Hintergrund

Architektur, Dateien und Design-Entscheidungen: siehe `CODE_CARD.md` im Projekt-Root, Abschnitt
„Playbook Builder (Blockly)".
