# VSCode Integration Guide

This directory contains the example files for the docs page [Editor setup](https://docs.maplibre-yaml.org/guides/editor-setup/), which explains them.

## Quick Start (No Extension Required)

You can start using maplibre-yaml validation in VSCode immediately using the built-in Tasks feature:

1. Copy [`tasks.json`](./tasks.json) to your project's `.vscode/` directory
2. Copy [`settings.json`](./settings.json) to your project's `.vscode/` directory (or merge with existing)
3. Run **Terminal > Run Task > maplibre-yaml: Validate All Configs**
4. Errors will appear in the **Problems** panel with clickable file paths

## Files

### [`tasks.json`](./tasks.json)
VSCode task configurations for:
- **Validate Current File**: Validates the currently open YAML file
- **Validate All Configs**: Validates all YAML files matching `configs/**/*.yaml`
- **Watch and Validate**: Continuously validates files as they change

### [`settings.json`](./settings.json)
Recommended VSCode settings for:
- YAML schema association for autocomplete and validation
- File associations for map configuration files
- YAML formatter configuration

## Usage

### Validate Current File
1. Open a `.yaml` file
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "Run Task" and select **maplibre-yaml: Validate Current File**
4. Check the **Problems** panel for errors

### Validate All Files
Run the task: **maplibre-yaml: Validate All Configs**

### Watch Mode
Run the task: **maplibre-yaml: Watch and Validate**

This will continuously monitor your YAML files and show errors in real-time.

## Problem Matcher

The tasks use a custom Problem Matcher that parses validation output in the format:

```
file:line:column: severity: [path] message
```

Example:
```
/path/to/map.yaml:4:11: error: [config.center] center needs square brackets: center: [-74.006, 40.7128]
```

This format allows VSCode to:
- Display errors in the Problems panel
- Underline errors in the editor
- Provide quick navigation to error locations

## Requirements

- Node.js 20.9 or later. The tasks run `npx maplibre-yaml`, which uses `@maplibre-yaml/cli` from your project when it is installed and downloads it otherwise
- VSCode 1.60+ (for Problem Matcher support)
- Recommended: [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) for schema validation
