/**
 * The `astro` template asks for the Node.js that Astro 7 needs (ml-nog).
 *
 * @remarks
 * Astro 7.4.2 declares `engines.node >=22.23.4` (7.4.0 said 22.22.0). The
 * template's `astro: ^7.4.0` installs 7.4.2 or later, so a scaffold that
 * still asked for 22.22 let `npm install` start on a Node that Astro then
 * refuses. The astro package README states the same floor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'pathe';

const ASTRO_7_NODE = '22.23.4';

describe('astro template Node.js floor', () => {
  it('package.json engines match Astro 7.4.2', () => {
    const template = readFileSync(join(process.cwd(), 'templates/astro/package.json.template'), 'utf-8');
    const pkg = JSON.parse(template.replace(/\{\{\w+\}\}/g, 'x'));
    expect(pkg.engines.node).toBe(`>=${ASTRO_7_NODE}`);
  });

  it('the @maplibre-yaml/astro README says the same', () => {
    const readme = readFileSync(join(process.cwd(), '../astro/README.md'), 'utf-8');
    expect(readme).toContain(`Astro 7 needs Node ${ASTRO_7_NODE}+`);
    expect(readme).not.toMatch(/22\.22/);
  });
});
