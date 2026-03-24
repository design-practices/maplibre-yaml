/**
 * @file Tests for global config loader utility
 * @module @maplibre-yaml/astro/tests/utils/global-config
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadGlobalMapConfig } from "../../src/utils/global-config";

describe("loadGlobalMapConfig", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `global-config-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads and parses valid YAML with all fields", async () => {
    const yamlPath = join(testDir, "maps.yaml");
    await writeFile(
      yamlPath,
      `
defaultMapStyle: "https://example.com/style.json"
defaultZoom: 10
defaultCenter: [-74.006, 40.7128]
theme: dark
`,
    );

    const config = await loadGlobalMapConfig(yamlPath);

    expect(config.defaultMapStyle).toBe("https://example.com/style.json");
    expect(config.defaultZoom).toBe(10);
    expect(config.defaultCenter).toEqual([-74.006, 40.7128]);
    expect(config.theme).toBe("dark");
  });

  it("loads valid YAML with minimal fields", async () => {
    const yamlPath = join(testDir, "minimal.yaml");
    await writeFile(
      yamlPath,
      `
defaultMapStyle: "https://example.com/style.json"
`,
    );

    const config = await loadGlobalMapConfig(yamlPath);

    expect(config.defaultMapStyle).toBe("https://example.com/style.json");
    expect(config.theme).toBe("light"); // default
    expect(config.defaultZoom).toBeUndefined();
    expect(config.defaultCenter).toBeUndefined();
  });

  it("throws for invalid field values (zoom out of range)", async () => {
    const yamlPath = join(testDir, "bad-zoom.yaml");
    await writeFile(
      yamlPath,
      `
defaultMapStyle: "https://example.com/style.json"
defaultZoom: 30
`,
    );

    await expect(loadGlobalMapConfig(yamlPath)).rejects.toThrow();
  });

  it("throws for file not found", async () => {
    await expect(
      loadGlobalMapConfig(join(testDir, "nonexistent.yaml")),
    ).rejects.toThrow();
  });

  it("accepts empty config (all fields optional)", async () => {
    const yamlPath = join(testDir, "empty.yaml");
    await writeFile(yamlPath, "{}");

    const config = await loadGlobalMapConfig(yamlPath);

    expect(config.theme).toBe("light"); // default
    expect(config.defaultMapStyle).toBeUndefined();
  });
});
