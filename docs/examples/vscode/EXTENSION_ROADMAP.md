# VSCode Extension Roadmap

## Overview

The maplibre-yaml VSCode extension will provide real-time validation, autocomplete, and preview capabilities for YAML map configurations.

## Architecture

The extension will use `@maplibre-yaml/core` directly (not the CLI) for better performance and integration:

```
vscode-maplibre-yaml/
├── src/
│   ├── extension.ts        # Extension entry point
│   ├── diagnostics.ts      # Real-time validation
│   ├── completion.ts       # Autocomplete provider
│   └── preview.ts          # Webview map preview
├── package.json
└── tsconfig.json
```

## Implementation Phases

### Phase 1: Validation on Save (CLI Integration) ✅

**Status: Available Now**

Users can use VSCode Tasks with Problem Matcher (no extension needed):
- Copy `.vscode/tasks.json` from our examples
- Run "maplibre-yaml: Validate" task
- Errors appear in Problems panel

**Pros:**
- No extension installation required
- Works immediately
- Uses CLI output format

**Cons:**
- Manual task execution
- No real-time validation
- No autocomplete

### Phase 2: Extension MVP

**Goal:** Basic real-time validation

```typescript
// extension.ts
import * as vscode from 'vscode';
import { YAMLParser } from '@maplibre-yaml/core';

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection('maplibre-yaml');

  // Validate on save
  vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.fileName.endsWith('.yaml')) {
      validateDocument(doc, diagnostics);
    }
  });

  // Validate on open
  vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.fileName.endsWith('.yaml')) {
      validateDocument(doc, diagnostics);
    }
  });
}

function validateDocument(
  doc: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection
) {
  const result = YAMLParser.safeParseMapBlock(doc.getText());

  if (result.success) {
    diagnostics.delete(doc.uri);
    return;
  }

  const diags = result.errors.map(err => {
    const line = err.line ?? 0;
    const col = err.column ?? 0;
    const range = new vscode.Range(line, col, line, col + 10);

    return new vscode.Diagnostic(
      range,
      err.message,
      vscode.DiagnosticSeverity.Error
    );
  });

  diagnostics.set(doc.uri, diags);
}
```

**Features:**
- ✅ Real-time validation on save
- ✅ Errors underlined in editor
- ✅ Problems panel integration
- ✅ Direct use of core parser (fast)

**Timeline:** 2-3 weeks

### Phase 3: Language Server (LSP)

**Goal:** Advanced IDE features with better performance

**Architecture:**
```
vscode-maplibre-yaml/
├── client/              # VSCode extension
│   └── extension.ts
└── server/              # Language Server
    ├── server.ts
    ├── validation.ts
    ├── completion.ts
    └── hover.ts
```

**Features:**
- ✅ Real-time validation as you type
- ✅ Autocomplete for schema fields
- ✅ Hover documentation
- ✅ Go to definition for layer references
- ✅ Code actions (quick fixes)
- ✅ Rename refactoring

**Example Completion Provider:**
```typescript
connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  const position = params.position;

  // Parse partial document to determine context
  const context = getCompletionContext(document, position);

  if (context.inConfig) {
    return [
      { label: 'center', kind: CompletionItemKind.Property },
      { label: 'zoom', kind: CompletionItemKind.Property },
      { label: 'pitch', kind: CompletionItemKind.Property },
      // ...
    ];
  }

  if (context.inLayers) {
    return [
      { label: 'circle', kind: CompletionItemKind.Keyword },
      { label: 'fill', kind: CompletionItemKind.Keyword },
      { label: 'line', kind: CompletionItemKind.Keyword },
      // ...
    ];
  }
});
```

**Timeline:** 2-3 months

### Phase 4: Preview Webview

**Goal:** Inline map preview within VSCode

```typescript
// preview.ts
export class MapPreviewPanel {
  public static currentPanel: MapPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;

  public static createOrShow(extensionUri: vscode.Uri, config: string) {
    // Create or reveal webview panel
    const panel = vscode.window.createWebviewPanel(
      'maplibrePreview',
      'Map Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    // Set webview HTML with map
    panel.webview.html = getWebviewContent(config);

    return new MapPreviewPanel(panel, extensionUri);
  }

  private _update(config: string) {
    this._panel.webview.postMessage({
      type: 'updateConfig',
      config: JSON.parse(config)
    });
  }
}

// Activate preview command
context.subscriptions.push(
  vscode.commands.registerCommand('maplibre-yaml.preview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = editor.document.getText();
    MapPreviewPanel.createOrShow(context.extensionUri, config);
  })
);

// Live update on file change
vscode.workspace.onDidChangeTextDocument((event) => {
  if (MapPreviewPanel.currentPanel && event.document === activeDocument) {
    MapPreviewPanel.currentPanel.update(event.document.getText());
  }
});
```

**Features:**
- ✅ Split pane with YAML + map
- ✅ Live updates as you edit
- ✅ Layer visibility toggles
- ✅ Pan/zoom/pitch controls
- ✅ Debug panel showing parsed config

**Timeline:** 1-2 months

## Technical Decisions

### Why Direct Core Integration (Not CLI)?

**Advantages:**
- **Performance**: No process spawning, instant validation
- **Rich Integration**: Access to AST, can provide precise error locations
- **Type Safety**: Full TypeScript integration
- **Extensibility**: Easy to add new features (autocomplete, hover, etc.)

**CLI Still Used For:**
- CI/CD pipelines
- Build scripts
- Command-line workflows
- Batch validation

### File Detection Strategy

The extension will activate for files matching:
1. `*.map.yaml` - Explicit map configuration files
2. `configs/**/*.yaml` - Files in configs directory
3. Files with `type: map` in first 10 lines

### Configuration

Users can configure:
```json
{
  "maplibre-yaml.validation.enabled": true,
  "maplibre-yaml.validation.onType": false,  // Only on save
  "maplibre-yaml.preview.autoOpen": false,
  "maplibre-yaml.trace.server": "off"
}
```

## Success Metrics

- **Phase 2**: 100+ installations, <100ms validation time
- **Phase 3**: 500+ installations, autocomplete within 50ms
- **Phase 4**: 1000+ installations, preview renders within 500ms

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)

## Getting Started (Phase 2)

```bash
# Create extension
npx yo code

# Install dependencies
pnpm add @maplibre-yaml/core

# Implement basic validation
# Test with F5 (Extension Development Host)
# Publish to marketplace
```

---

**Note**: The CLI's VSCode output format and the documented extension architecture provide a clear path forward. Users can start with CLI integration (Phase 1) and seamlessly upgrade to the extension when available.
