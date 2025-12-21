/**
 * @file Tests for base schemas
 * @module @maplibre-yaml/core/tests/schemas/base
 */

import { describe, it, expect } from 'vitest';
import {
  LongitudeSchema,
  LatitudeSchema,
  LngLatSchema,
  LngLatBoundsSchema,
  ColorSchema,
  ExpressionSchema,
  NumberOrExpressionSchema,
  ColorOrExpressionSchema,
  ZoomLevelSchema,
} from '../../src/schemas/base.schema';

describe('LongitudeSchema', () => {
  describe('valid values', () => {
    it('accepts 0', () => {
      expect(LongitudeSchema.parse(0)).toBe(0);
    });

    it('accepts -180', () => {
      expect(LongitudeSchema.parse(-180)).toBe(-180);
    });

    it('accepts 180', () => {
      expect(LongitudeSchema.parse(180)).toBe(180);
    });

    it('accepts New York longitude', () => {
      expect(LongitudeSchema.parse(-74.006)).toBe(-74.006);
    });
  });

  describe('invalid values', () => {
    it('rejects -181', () => {
      expect(() => LongitudeSchema.parse(-181)).toThrow();
    });

    it('rejects 181', () => {
      expect(() => LongitudeSchema.parse(181)).toThrow();
    });

    it('rejects non-number', () => {
      expect(() => LongitudeSchema.parse('invalid')).toThrow();
    });
  });
});

describe('LatitudeSchema', () => {
  describe('valid values', () => {
    it('accepts 0', () => {
      expect(LatitudeSchema.parse(0)).toBe(0);
    });

    it('accepts -90', () => {
      expect(LatitudeSchema.parse(-90)).toBe(-90);
    });

    it('accepts 90', () => {
      expect(LatitudeSchema.parse(90)).toBe(90);
    });

    it('accepts New York latitude', () => {
      expect(LatitudeSchema.parse(40.7128)).toBe(40.7128);
    });
  });

  describe('invalid values', () => {
    it('rejects -91', () => {
      expect(() => LatitudeSchema.parse(-91)).toThrow();
    });

    it('rejects 91', () => {
      expect(() => LatitudeSchema.parse(91)).toThrow();
    });

    it('rejects non-number', () => {
      expect(() => LatitudeSchema.parse('invalid')).toThrow();
    });
  });
});

describe('LngLatSchema', () => {
  describe('valid coordinates', () => {
    it('accepts New York City coordinates', () => {
      const result = LngLatSchema.parse([-74.006, 40.7128]);
      expect(result).toEqual([-74.006, 40.7128]);
    });

    it('accepts origin coordinates', () => {
      const result = LngLatSchema.parse([0, 0]);
      expect(result).toEqual([0, 0]);
    });

    it('accepts boundary values', () => {
      const sw = LngLatSchema.parse([-180, -90]);
      const ne = LngLatSchema.parse([180, 90]);
      expect(sw).toEqual([-180, -90]);
      expect(ne).toEqual([180, 90]);
    });

    it('accepts Tokyo coordinates', () => {
      const result = LngLatSchema.parse([139.6917, 35.6895]);
      expect(result).toEqual([139.6917, 35.6895]);
    });
  });

  describe('invalid coordinates', () => {
    it('rejects longitude out of range', () => {
      expect(() => LngLatSchema.parse([-181, 0])).toThrow();
      expect(() => LngLatSchema.parse([181, 0])).toThrow();
    });

    it('rejects latitude out of range', () => {
      expect(() => LngLatSchema.parse([0, -91])).toThrow();
      expect(() => LngLatSchema.parse([0, 91])).toThrow();
    });

    it('rejects non-array', () => {
      expect(() => LngLatSchema.parse('invalid')).toThrow();
    });

    it('rejects wrong array length', () => {
      expect(() => LngLatSchema.parse([0])).toThrow();
      expect(() => LngLatSchema.parse([0, 0, 0])).toThrow();
    });

    it('rejects when first value exceeds longitude bounds', () => {
      // 200 is not a valid longitude
      expect(() => LngLatSchema.parse([200, 40])).toThrow();
    });
  });
});

describe('LngLatBoundsSchema', () => {
  describe('valid bounds', () => {
    it('accepts NYC bounding box', () => {
      const result = LngLatBoundsSchema.parse([-74.3, 40.5, -73.7, 40.9]);
      expect(result).toEqual([-74.3, 40.5, -73.7, 40.9]);
    });

    it('accepts world bounds', () => {
      const result = LngLatBoundsSchema.parse([-180, -90, 180, 90]);
      expect(result).toEqual([-180, -90, 180, 90]);
    });
  });

  describe('invalid bounds', () => {
    it('rejects out of range values', () => {
      expect(() => LngLatBoundsSchema.parse([-181, 0, 0, 0])).toThrow();
      expect(() => LngLatBoundsSchema.parse([0, -91, 0, 0])).toThrow();
    });

    it('rejects wrong array length', () => {
      expect(() => LngLatBoundsSchema.parse([0, 0, 0])).toThrow();
      expect(() => LngLatBoundsSchema.parse([0, 0, 0, 0, 0])).toThrow();
    });
  });
});

describe('ColorSchema', () => {
  describe('hex colors', () => {
    it('accepts 3-digit hex', () => {
      expect(ColorSchema.parse('#f00')).toBe('#f00');
      expect(ColorSchema.parse('#abc')).toBe('#abc');
    });

    it('accepts 6-digit hex', () => {
      expect(ColorSchema.parse('#ff0000')).toBe('#ff0000');
      expect(ColorSchema.parse('#aabbcc')).toBe('#aabbcc');
    });

    it('accepts 8-digit hex with alpha', () => {
      expect(ColorSchema.parse('#ff000080')).toBe('#ff000080');
    });

    it('accepts uppercase and lowercase', () => {
      expect(ColorSchema.parse('#FF0000')).toBe('#FF0000');
      expect(ColorSchema.parse('#ff0000')).toBe('#ff0000');
      expect(ColorSchema.parse('#Ff0000')).toBe('#Ff0000');
    });

    it('rejects invalid hex', () => {
      expect(() => ColorSchema.parse('#gg0000')).toThrow();
      expect(() => ColorSchema.parse('#ff')).toThrow();
    });
  });

  describe('rgb/rgba colors', () => {
    it('accepts rgb()', () => {
      expect(ColorSchema.parse('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
      expect(ColorSchema.parse('rgb(0,0,0)')).toBe('rgb(0,0,0)');
    });

    it('accepts rgba()', () => {
      expect(ColorSchema.parse('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
      expect(ColorSchema.parse('rgba(0,0,0,1)')).toBe('rgba(0,0,0,1)');
    });
  });

  describe('hsl/hsla colors', () => {
    it('accepts hsl()', () => {
      expect(ColorSchema.parse('hsl(0, 100%, 50%)')).toBe('hsl(0, 100%, 50%)');
      expect(ColorSchema.parse('hsl(120,100%,50%)')).toBe('hsl(120,100%,50%)');
    });

    it('accepts hsla()', () => {
      expect(ColorSchema.parse('hsla(0, 100%, 50%, 0.5)')).toBe('hsla(0, 100%, 50%, 0.5)');
      expect(ColorSchema.parse('hsla(240,100%,50%,1)')).toBe('hsla(240,100%,50%,1)');
    });
  });

  describe('named colors', () => {
    it('accepts standard named colors', () => {
      expect(ColorSchema.parse('red')).toBe('red');
      expect(ColorSchema.parse('blue')).toBe('blue');
      expect(ColorSchema.parse('transparent')).toBe('transparent');
      expect(ColorSchema.parse('cornflowerblue')).toBe('cornflowerblue');
    });
  });
});

describe('ExpressionSchema', () => {
  describe('valid expressions', () => {
    it('accepts get expression', () => {
      const expr = ['get', 'name'];
      expect(ExpressionSchema.parse(expr)).toEqual(expr);
    });

    it('accepts interpolate expression', () => {
      const expr = ['interpolate', ['linear'], ['zoom'], 0, 5, 10, 15];
      expect(ExpressionSchema.parse(expr)).toEqual(expr);
    });

    it('accepts match expression', () => {
      const expr = ['match', ['get', 'type'], 'park', '#228B22', 'water', '#4169E1', '#808080'];
      expect(ExpressionSchema.parse(expr)).toEqual(expr);
    });

    it('accepts nested expressions', () => {
      const expr = ['case', ['>', ['get', 'value'], 10], 'red', 'blue'];
      expect(ExpressionSchema.parse(expr)).toEqual(expr);
    });
  });

  describe('invalid expressions', () => {
    it('rejects empty array', () => {
      expect(() => ExpressionSchema.parse([])).toThrow();
    });

    it('rejects array not starting with string', () => {
      expect(() => ExpressionSchema.parse([123, 'foo'])).toThrow();
    });

    it('rejects non-array', () => {
      expect(() => ExpressionSchema.parse('not-an-array')).toThrow();
      expect(() => ExpressionSchema.parse(123)).toThrow();
    });
  });
});

describe('NumberOrExpressionSchema', () => {
  it('accepts number', () => {
    expect(NumberOrExpressionSchema.parse(42)).toBe(42);
    expect(NumberOrExpressionSchema.parse(0)).toBe(0);
    expect(NumberOrExpressionSchema.parse(-10.5)).toBe(-10.5);
  });

  it('accepts expression', () => {
    const expr = ['get', 'radius'];
    expect(NumberOrExpressionSchema.parse(expr)).toEqual(expr);
  });

  it('rejects non-number and non-expression', () => {
    expect(() => NumberOrExpressionSchema.parse('not-valid')).toThrow();
  });
});

describe('ColorOrExpressionSchema', () => {
  it('accepts color string', () => {
    expect(ColorOrExpressionSchema.parse('#ff0000')).toBe('#ff0000');
    expect(ColorOrExpressionSchema.parse('blue')).toBe('blue');
  });

  it('accepts expression', () => {
    const expr = ['get', 'color'];
    expect(ColorOrExpressionSchema.parse(expr)).toEqual(expr);
  });

  it('rejects invalid values', () => {
    expect(() => ColorOrExpressionSchema.parse(123)).toThrow();
  });
});

describe('ZoomLevelSchema', () => {
  describe('valid zoom levels', () => {
    it('accepts 0', () => {
      expect(ZoomLevelSchema.parse(0)).toBe(0);
    });

    it('accepts 12', () => {
      expect(ZoomLevelSchema.parse(12)).toBe(12);
    });

    it('accepts 24', () => {
      expect(ZoomLevelSchema.parse(24)).toBe(24);
    });

    it('accepts decimal values', () => {
      expect(ZoomLevelSchema.parse(12.5)).toBe(12.5);
    });
  });

  describe('invalid zoom levels', () => {
    it('rejects negative values', () => {
      expect(() => ZoomLevelSchema.parse(-1)).toThrow();
    });

    it('rejects values > 24', () => {
      expect(() => ZoomLevelSchema.parse(25)).toThrow();
    });

    it('rejects non-number', () => {
      expect(() => ZoomLevelSchema.parse('12')).toThrow();
    });
  });
});
