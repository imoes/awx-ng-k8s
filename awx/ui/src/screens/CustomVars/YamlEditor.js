/* eslint-disable i18next/no-literal-string */
// awx-ng: Monaco-basierter YAML-Editor mit Ansible-Schema-Validierung.
// Verwendet lokales monaco-editor Package — kein CDN-Request nötig.
import React, { useEffect, useRef, useCallback } from 'react';
import Editor, { loader, useMonaco } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor';

// Lokal gebautes Monaco verwenden statt CDN (funktioniert ohne Internet)
loader.config({ monaco: monacoEditor });

let _monacoYamlConfigured = false;

function configureYamlOnce(monaco) {
  if (_monacoYamlConfigured) return;
  _monacoYamlConfigured = true;
  try {
    const { configureMonacoYaml } = require('monaco-yaml');
    configureMonacoYaml(monaco, {
      enableSchemaRequest: false,
      schemas: [],  // Kein externes Schema — nur Syntax-Validierung
    });
  } catch (e) {
    // monaco-yaml nicht verfügbar — läuft ohne Schema-Validation
  }
}

/**
 * YamlEditor
 *
 * Props:
 *   value        {string}   — Datei-Inhalt
 *   onChange     {fn}       — (newValue) => void
 *   path         {string}   — Dateipfad (für Sprach-Erkennung)
 *   lintErrors   {Array}    — [{line, col, message, severity}] vom Server
 *   readOnly     {boolean}
 *   height       {string}   — CSS-Höhe, default '100%'
 *   onSave       {fn}       — wird bei Ctrl+S aufgerufen
 */
export default function YamlEditor({
  value = '',
  onChange,
  path = 'file.yml',
  lintErrors = [],
  readOnly = false,
  height = '100%',
  onSave,
}) {
  const monaco = useMonaco();
  const editorRef = useRef(null);

  // Monaco einmalig konfigurieren sobald verfügbar
  useEffect(() => {
    if (monaco) configureYamlOnce(monaco);
  }, [monaco]);

  // Server-seitige Lint-Fehler als Monaco-Markers setzen
  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    const markers = lintErrors.map((e) => ({
      startLineNumber: e.line || 1,
      startColumn: e.col || 1,
      endLineNumber: e.line || 1,
      endColumn: (e.col || 1) + 20,
      message: e.message,
      severity:
        e.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
      source: e.source || 'awx-ng',
    }));

    monaco.editor.setModelMarkers(model, 'awx-ng-lint', markers);
  }, [monaco, lintErrors]);

  // Ctrl+S → onSave-Callback
  const handleEditorDidMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      if (onSave) {
        editor.addCommand(
          // eslint-disable-next-line no-bitwise
          (monaco?.KeyMod?.CtrlCmd | monaco?.KeyCode?.KeyS) ?? 0,
          onSave
        );
      }
    },
    [monaco, onSave]
  );

  // Sprache anhand Datei-Extension bestimmen
  const language = path.endsWith('.j2') || path.endsWith('.jinja2')
    ? 'handlebars'  // Jinja2 ≈ Handlebars für Syntax-Highlighting
    : path.endsWith('.yml') || path.endsWith('.yaml')
    ? 'yaml'
    : 'plaintext';

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      theme="vs"
      options={{
        readOnly,
        minimap: { enabled: true },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        fontSize: 13,
        tabSize: 2,
        insertSpaces: true,
        automaticLayout: true,
        folding: true,
        renderLineHighlight: 'line',
        suggestOnTriggerCharacters: true,
        quickSuggestions: { other: true, comments: false, strings: true },
        bracketPairColorization: { enabled: true },
      }}
      onChange={onChange}
      onMount={handleEditorDidMount}
    />
  );
}
