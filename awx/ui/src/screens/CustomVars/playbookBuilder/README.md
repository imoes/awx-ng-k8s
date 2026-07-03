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
- **Dict** `{dict}` (z.B. `set_stats.data`, `uri.headers`): entweder als YAML-Mapping ins Textfeld
  (`foo: bar`⏎`count: 3`) **oder** — komfortabler — mit einem **dict-Block** (Rubrik **Data**), der
  in den `… (dict block):`-Steckplatz des Parameters kommt (siehe „Dicts als Blöcke bauen" unten).
- **Zahl** (`int`, `float`): wird beim Speichern automatisch in eine echte Zahl umgewandelt
  (kein `"3"`, sondern `3`).

## Task-Einstellungen (immer über „+ add task setting…")

| Einstellung | Bedeutung |
|---|---|
| `when:` | Bedingung — **kein Textfeld**, sondern ein Steckplatz für einen **Condition-Block** (siehe unten) |
| `tags:` | Kommagetrennte Tag-Liste |
| `notify:` | Kommagetrennte Handler-Liste |
| `register:` | Variablenname für das Ergebnis |
| `loop:` | Schleife über eine Liste (Kurzform oder volle YAML-Liste) — ersetzt auch das ältere `with_items:` beim Import (siehe unten) |
| `delegate_to:` | Task auf einem anderen Host ausführen |
| `become:` / `ignore_errors:` | Checkboxen |

## Bedingungen (`when:`) visuell bauen

Statt Jinja-Text zu tippen, klinkt man einen **Condition-Block** aus der Rubrik **Conditions** in
den `when:`-Steckplatz eines Task-Moduls ein:

| Block | Zweck |
|---|---|
| `var` | Variable/Fact-Referenz, z.B. `foo`, `motd_contents.stdout`, `ansible_facts['distribution']` — ohne `{{ }}` |
| `value` | Literal — Zahlen/`true`/`false` unquoted, alles andere wird automatisch gequotet (z.B. `Debian`) |
| `compare` | zwei Werte vergleichen: `==`/`!=`/`>`/`<`/`>=`/`<=`/`in`/`not in` |
| `check … is [x] not …` | Jinja-„is"-Test: `defined`/`undefined`/`none`/`true`/`false`/`changed`/`failed`/`success`/`skipped` (Häkchen = „is not …") |
| `not` | negiert eine Bedingung |
| `and`/`or` | verknüpft zwei Bedingungen (mehrere Blöcke verschachteln für mehr als zwei) |
| raw condition | Fallback — hält einen nicht in Blöcke zerlegbaren Ausdruck als Text (z.B. mit Filtern wie `\| int`) |

Ein bloßer `var`-Block reicht auch direkt im `when:`-Slot (`when: irgendein_flag`, wie in Ansible
üblich). Beim Öffnen bestehender Playbooks/Rollen wird jedes `when:` automatisch in diese Blöcke
zerlegt — was die eingebaute Grammatik nicht abdeckt (Filter, Funktionsaufrufe, Jinja-Templating),
landet unverändert im **raw condition**-Block.

## Rollen verwenden

In der **Roles**-Rubrik erscheint automatisch jede im aktuell gewählten Projekt gefundene Rolle
als fertiger Block — einfach reinziehen (landet im separaten `roles:`-Slot des Play-Blocks,
nicht bei den Tasks). Im `vars (optional):`-Feld können projektspezifische Rollen-Variablen als
YAML-Mapping mitgegeben werden.

## Eigene Rolle anlegen (Tasks/Handlers/Defaults/Vars)

**☰ → New role** legt eine neue Rolle mit **4 Reitern** an: **Tasks | Handlers | Defaults | Vars**
— entspricht den 4 realen Dateien `roles/<name>/{tasks,handlers,defaults,vars}/main.yml`. Alle 4
werden in **derselben** Canvas bearbeitet; beim Reiter-Wechsel wird der aktuelle Inhalt gemerkt
(nicht verworfen). Man muss sich um nichts kümmern:

- **Tasks**/**Handlers**: normale Modul-Blöcke wie sonst auch. Ein Handler wird über den
  `notify:`-Task-Einstellung eines Tasks per Namen angesprochen (`task name:`-Feld des
  Handler-Blocks = der Name, den `notify:` erwartet).
- **Defaults**/**Vars**: `var`-Blöcke wie im Play (siehe „Variablen anlegen" unten) — landen in
  `defaults/main.yml` bzw. `vars/main.yml`.
- **☰ → Lint & Save** schreibt **alle 4 Dateien auf einmal** — auch Reiter, die man nie angeklickt
  hat, werden als leere Datei angelegt. Die Verzeichnisse entstehen dabei automatisch; man muss sie
  nicht selbst anlegen.
- **☰ → Open role…** lädt eine bestehende Rolle wieder komplett (alle 4 Dateien auf einmal, nicht
  nacheinander) — Reiter wechseln ist danach sofort, ohne weiteres Nachladen.

## Bestehende Playbooks/Rollen öffnen (Import)

**☰ → Open playbook…** bzw. **Open role…** listet alle Dateien/Rollen des gewählten Projekts. Beim
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
- Play-Level-Schlüssel ohne eigenen Block (`environment:`, …) landen im `extra`-Feld des
  Play-Blocks als YAML — `roles:` und `vars:` bekommen dagegen eigene, typisierte Blöcke.

## Variablen anlegen

Drei Wege, eine Variable anzulegen:

1. **Direkt im rechten Panel**: oben im Variablen-Panel „New variable name…" + optional einen Wert
   eintragen, **+ Add variable** klicken — landet sofort im `vars:`-Slot des Play-Blocks (bzw. im
   aktiven Defaults-/Vars-Reiter einer Rolle) und erscheint direkt darunter in der Liste, getaggt
   „this document".
2. Ein `var`-Block aus der Rubrik **Play** ziehen.
3. Eine Variable aus der Palette per Drag&Drop auf die **leere Canvas** ziehen (siehe unten).

Alle drei Wege erzeugen denselben `var`-Block. Er klinkt sich in den `vars`-Slot des Play-Blocks
ein (neben `roles`/`tasks`/`handlers`) bzw. in die Rollen-Sektion, mehrere Blöcke lassen sich
verketten.

Der Wert wird beim Speichern typgerecht interpretiert:

- **Text**: einfach eintragen, z.B. `nginx` → `app_name: nginx`.
- **Zahl**: `8080` → `app_port: 8080` (echte YAML-Zahl, nicht `"8080"`).
- **Liste**: eine Zeile pro Eintrag mit `- `, z.B. `- nginx`⏎`- curl`.
- **Mapping**: YAML-Mapping-Syntax, z.B. `key: value`⏎`count: 3`.

Beim Öffnen einer bestehenden Datei wird ein vorhandenes `vars:`-Mapping automatisch in einzelne
`var`-Blöcke zerlegt — das gilt für Play-`vars:` genauso wie für die Defaults/Vars-Reiter einer
Rolle (siehe „Eigene Rolle anlegen" oben).

## Dicts als Blöcke bauen

Statt ein Mapping als YAML-Text zu tippen, gibt es einen **dict-Block** (Rubrik **Data**):

1. `dict`-Block auf die Canvas ziehen.
2. `entry`-Blöcke (ebenfalls Rubrik **Data**) hineinziehen — je einen pro Key. Jeder Eintrag ist
   `[key] : [wert]`.
3. Den Wert eines Eintrags entweder ins Textfeld tippen (Skalar: Text/Zahl/`true`/`false`, wird
   typgerecht umgesetzt) **oder** rechts über den `or`-Steckplatz einen Block einstecken:
   - einen **`var`-Block** (Rubrik **Conditions**) für eine Variablen-Referenz → wird als
     `{{ variable }}` ausgegeben (laut Ansible-Doku sind Variablen als Dict-Werte erlaubt),
   - oder einen **weiteren `dict`-Block** für ein verschachteltes Mapping.

Den fertigen `dict`-Block steckt man in den `or`-Slot eines `var`-Blocks (Variable = Dict) oder in
den `… (dict block):`-Slot eines dict-typisierten Modul-Parameters (`uri.headers`, `set_stats.data`,
…). Ist ein Block eingesteckt, gewinnt er gegenüber dem Textfeld. Beim Öffnen bestehender Dateien
werden vorhandene Mappings automatisch in dict-Blöcke zerlegt.

*(Hinweis: Listen haben aktuell keinen eigenen Block — sie werden weiterhin als YAML-Text im Feld
eingegeben.)*

## Variablen-Palette

Rechts werden die Variablen angezeigt, die zum **aktuell offenen** Playbook/zur Rolle passen
(Rollen-Variablen der verwendeten Rollen + alle Ansible-Vault-Variablen), inklusive Wertvorschau
— durchsuchbar über das Filterfeld. Zusätzlich stehen immer die **gängigsten `ansible_facts`**
zur Verfügung (Distribution, OS-Familie, IP-Adresse, RAM, …), unabhängig vom Projekt.

- Auf ein **Modul-Textfeld** ziehen fügt `{{ variable }}` ein.
- Auf die **leere Canvas** ziehen erzeugt stattdessen einen `var`-Block (Conditions-Rubrik),
  vorausgefüllt mit dem Variablennamen — direkt bereit zum Einklinken in eine Bedingung
  (`compare`, `check … is …`, oder auch direkt in den `when:`-Slot).

## Bekannte Grenzen

- Ein Play-Block/eine Canvas entspricht **einer** Playbook-Datei — kein Multi-Play-Editing in
  einer Sitzung (Rollen sind die Ausnahme: Tasks/Handlers/Defaults/Vars teilen sich eine Canvas
  über Reiter, siehe „Eigene Rolle anlegen").
- Module außerhalb von `ansible.builtin` (Collections wie `community.general`) haben keinen
  eigenen Block-Typ — sie werden als `raw task` importiert/erzeugt (Original-YAML bleibt erhalten).
- `block:`/`rescue:`/`always:`-Strukturen haben (noch) keinen eigenen Block und werden als
  `raw task` dargestellt.
- Checkbox-Felder können „nicht gesetzt" nicht von „explizit false" unterscheiden.
- Beim Rollen-Speichern wird nur die **aktive** Sektion gelintet, nicht alle 4 auf einmal.
- `templates/`, `files/`, `meta/` (Rollen-Metadaten, Jinja-Templates, statische Dateien) werden
  vom Builder (noch) nicht verwaltet — nur tasks/handlers/defaults/vars.

## Technischer Hintergrund

Architektur, Dateien und Design-Entscheidungen: siehe `CODE_CARD.md` im Projekt-Root, Abschnitt
„Playbook Builder (Blockly)".
