// docs/src/utils/yaml-format.ts

/**
 * Format YAML for display with optional line numbers and highlighting.
 */
export function formatYAML(
  yaml: string,
  highlight: number[] = [],
  lineNumbers: boolean = true
): string {
  const lines = yaml.trim().split("\n");

  return lines
    .map((line, index) => {
      const lineNum = index + 1;
      const isHighlighted = highlight.includes(lineNum);
      const classes = ["line"];
      if (isHighlighted) classes.push("highlighted");

      // Basic YAML syntax highlighting
      let formatted = escapeHtml(line);
      formatted = highlightYAMLSyntax(formatted);

      return `<span class="${classes.join(
        " "
      )}" data-line="${lineNum}">${formatted}</span>`;
    })
    .join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightYAMLSyntax(line: string): string {
  // Comments
  if (line.trim().startsWith("#")) {
    return `<span class="yaml-comment">${line}</span>`;
  }

  // Key-value pairs
  const keyMatch = line.match(/^(\s*)([a-zA-Z_-]+)(:)/);
  if (keyMatch) {
    const [, indent, key, colon] = keyMatch;
    const rest = line.slice(keyMatch[0].length);
    return `${indent}<span class="yaml-key">${key}</span><span class="yaml-colon">${colon}</span>${highlightValue(
      rest
    )}`;
  }

  // List items
  const listMatch = line.match(/^(\s*)(-)(\s*)/);
  if (listMatch) {
    const [, indent, dash, space] = listMatch;
    const rest = line.slice(listMatch[0].length);
    return `${indent}<span class="yaml-dash">${dash}</span>${space}${highlightValue(
      rest
    )}`;
  }

  return line;
}

function highlightValue(value: string): string {
  const trimmed = value.trim();

  // Strings in quotes
  if (/^["'].*["']$/.test(trimmed)) {
    return `<span class="yaml-string">${value}</span>`;
  }

  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return `<span class="yaml-number">${value}</span>`;
  }

  // Booleans
  if (/^(true|false)$/i.test(trimmed)) {
    return `<span class="yaml-boolean">${value}</span>`;
  }

  // URLs
  if (/^https?:\/\//.test(trimmed.replace(/^["']|["']$/g, ""))) {
    return `<span class="yaml-string">${value}</span>`;
  }

  return value;
}
