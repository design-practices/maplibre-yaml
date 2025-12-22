/**
 * @file Tests for source schemas
 * @module @maplibre-yaml/core/tests/schemas/source
 */

import { describe, it, expect } from 'vitest';
import {
  StreamConfigSchema,
  LoadingConfigSchema,
  GeoJSONSourceSchema,
  VectorSourceSchema,
  RasterSourceSchema,
  ImageSourceSchema,
  VideoSourceSchema,
  LayerSourceSchema,
} from '../../src/schemas/source.schema';

describe('StreamConfigSchema', () => {
  describe('valid configurations', () => {
    it('accepts websocket configuration', () => {
      const config = {
        type: 'websocket' as const,
        url: 'wss://example.com/stream',
      };
      expect(StreamConfigSchema.parse(config)).toMatchObject(config);
    });

    it('accepts sse configuration', () => {
      const config = {
        type: 'sse' as const,
        url: 'https://example.com/events',
      };
      expect(StreamConfigSchema.parse(config)).toMatchObject(config);
    });

    it('applies default values', () => {
      const config = {
        type: 'websocket' as const,
        url: 'wss://example.com/stream',
      };
      const result = StreamConfigSchema.parse(config);
      expect(result.reconnect).toBe(true);
      expect(result.reconnectDelay).toBe(1000);
      expect(result.reconnectMaxAttempts).toBe(10);
      expect(result.reconnectMaxDelay).toBe(30000);
    });

    it('accepts custom reconnect settings', () => {
      const config = {
        type: 'websocket' as const,
        url: 'wss://example.com/stream',
        reconnectMaxAttempts: 5,
        reconnectDelay: 500,
        reconnectMaxDelay: 10000,
      };
      const result = StreamConfigSchema.parse(config);
      expect(result.reconnectMaxAttempts).toBe(5);
      expect(result.reconnectDelay).toBe(500);
      expect(result.reconnectMaxDelay).toBe(10000);
    });
  });

  describe('invalid configurations', () => {
    it('rejects invalid type', () => {
      expect(() =>
        StreamConfigSchema.parse({
          type: 'invalid',
          url: 'wss://example.com',
        })
      ).toThrow();
    });

    it('rejects invalid URL', () => {
      expect(() =>
        StreamConfigSchema.parse({
          type: 'websocket',
          url: 'not-a-url',
        })
      ).toThrow();
    });

    it('rejects negative reconnectDelay', () => {
      expect(() =>
        StreamConfigSchema.parse({
          type: 'websocket',
          url: 'wss://example.com',
          reconnectDelay: -1,
        })
      ).toThrow();
    });
  });
});

describe('LoadingConfigSchema', () => {
  it('accepts full configuration', () => {
    const config = {
      enabled: true,
      message: 'Loading data...',
      showErrorOverlay: false,
    };
    expect(LoadingConfigSchema.parse(config)).toMatchObject(config);
  });

  it('applies default values', () => {
    const result = LoadingConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.showErrorOverlay).toBe(true);
  });

  it('accepts optional message', () => {
    const config = {
      enabled: true,
      message: 'Custom loading message',
    };
    const result = LoadingConfigSchema.parse(config);
    expect(result.message).toBe('Custom loading message');
  });
});

describe('GeoJSONSourceSchema', () => {
  describe('URL source', () => {
    it('accepts basic URL source', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
      };
      const result = GeoJSONSourceSchema.parse(source);
      expect(result.type).toBe('geojson');
      expect(result.url).toBe('https://example.com/data.geojson');
      expect(result.fetchStrategy).toBe('runtime');
    });

    it('accepts custom fetch strategy', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
        fetchStrategy: 'build' as const,
      };
      const result = GeoJSONSourceSchema.parse(source);
      expect(result.fetchStrategy).toBe('build');
    });
  });

  describe('inline data source', () => {
    it('accepts inline GeoJSON', () => {
      const source = {
        type: 'geojson' as const,
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
              properties: { name: 'NYC' },
            },
          ],
        },
      };
      expect(GeoJSONSourceSchema.parse(source)).toMatchObject(source);
    });
  });

  describe('streaming source', () => {
    it('accepts WebSocket streaming', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
        stream: {
          type: 'websocket' as const,
          url: 'wss://example.com/stream',
        },
        updateStrategy: 'merge' as const,
        updateKey: 'id',
      };
      expect(GeoJSONSourceSchema.parse(source)).toMatchObject(source);
    });

    it('accepts SSE streaming', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
        stream: {
          type: 'sse' as const,
          url: 'https://example.com/events',
        },
      };
      expect(GeoJSONSourceSchema.parse(source)).toMatchObject(source);
    });
  });

  describe('polling source', () => {
    it('accepts refresh interval', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
        refreshInterval: 15000,
      };
      expect(GeoJSONSourceSchema.parse(source)).toMatchObject(source);
    });

    it('rejects refresh interval < 1000ms', () => {
      expect(() =>
        GeoJSONSourceSchema.parse({
          type: 'geojson',
          url: 'https://example.com/data.geojson',
          refreshInterval: 500,
        })
      ).toThrow();
    });
  });

  describe('clustering', () => {
    it('accepts cluster configuration', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/points.geojson',
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      };
      expect(GeoJSONSourceSchema.parse(source)).toMatchObject(source);
    });
  });

  describe('validation', () => {
    it('rejects source without url, data, or prefetchedData', () => {
      expect(() =>
        GeoJSONSourceSchema.parse({
          type: 'geojson',
        })
      ).toThrow(/requires at least one of: url, data, or prefetchedData/);
    });

    it('applies default values', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
      };
      const result = GeoJSONSourceSchema.parse(source);
      expect(result.fetchStrategy).toBe('runtime');
      expect(result.clusterRadius).toBe(50);
    });
  });

  describe('loading configuration', () => {
    it('accepts loading config', () => {
      const source = {
        type: 'geojson' as const,
        url: 'https://example.com/data.geojson',
        loading: {
          enabled: true,
          message: 'Loading data...',
        },
      };
      expect(GeoJSONSourceSchema.parse(source)).toMatchObject(source);
    });
  });
});

describe('VectorSourceSchema', () => {
  describe('valid sources', () => {
    it('accepts TileJSON URL', () => {
      const source = {
        type: 'vector' as const,
        url: 'https://api.maptiler.com/tiles.json',
      };
      expect(VectorSourceSchema.parse(source)).toMatchObject(source);
    });

    it('accepts tiles array', () => {
      const source = {
        type: 'vector' as const,
        tiles: ['https://tile.example.com/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14,
      };
      expect(VectorSourceSchema.parse(source)).toMatchObject(source);
    });

    it('accepts both URL and tiles', () => {
      const source = {
        type: 'vector' as const,
        url: 'https://api.maptiler.com/tiles.json',
        tiles: ['https://tile.example.com/{z}/{x}/{y}.pbf'],
      };
      expect(VectorSourceSchema.parse(source)).toMatchObject(source);
    });

    it('accepts attribution and bounds', () => {
      const source = {
        type: 'vector' as const,
        url: 'https://api.maptiler.com/tiles.json',
        attribution: '© MapTiler',
        bounds: [-180, -90, 180, 90],
      };
      expect(VectorSourceSchema.parse(source)).toMatchObject(source);
    });
  });

  describe('invalid sources', () => {
    it('rejects source without url or tiles', () => {
      expect(() =>
        VectorSourceSchema.parse({
          type: 'vector',
        })
      ).toThrow();
    });

    it('rejects invalid zoom levels', () => {
      expect(() =>
        VectorSourceSchema.parse({
          type: 'vector',
          url: 'https://example.com',
          minzoom: -1,
        })
      ).toThrow();

      expect(() =>
        VectorSourceSchema.parse({
          type: 'vector',
          url: 'https://example.com',
          maxzoom: 25,
        })
      ).toThrow();
    });
  });
});

describe('RasterSourceSchema', () => {
  describe('valid sources', () => {
    it('accepts TileJSON URL', () => {
      const source = {
        type: 'raster' as const,
        url: 'https://api.maptiler.com/tiles.json',
      };
      expect(RasterSourceSchema.parse(source)).toMatchObject(source);
    });

    it('accepts tiles array', () => {
      const source = {
        type: 'raster' as const,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
      };
      expect(RasterSourceSchema.parse(source)).toMatchObject(source);
    });

    it('applies default tile size', () => {
      const source = {
        type: 'raster' as const,
        url: 'https://example.com/tiles.json',
      };
      const result = RasterSourceSchema.parse(source);
      expect(result.tileSize).toBe(512);
    });
  });

  describe('invalid sources', () => {
    it('rejects source without url or tiles', () => {
      expect(() =>
        RasterSourceSchema.parse({
          type: 'raster',
        })
      ).toThrow();
    });

    it('rejects invalid tile size', () => {
      expect(() =>
        RasterSourceSchema.parse({
          type: 'raster',
          url: 'https://example.com',
          tileSize: 0,
        })
      ).toThrow();
    });
  });
});

describe('ImageSourceSchema', () => {
  describe('valid sources', () => {
    it('accepts complete image source', () => {
      const source = {
        type: 'image' as const,
        url: 'https://example.com/overlay.png',
        coordinates: [
          [-80.425, 46.437],
          [-71.516, 46.437],
          [-71.516, 37.936],
          [-80.425, 37.936],
        ] as [[number, number], [number, number], [number, number], [number, number]],
      };
      expect(ImageSourceSchema.parse(source)).toMatchObject(source);
    });
  });

  describe('invalid sources', () => {
    it('rejects missing URL', () => {
      expect(() =>
        ImageSourceSchema.parse({
          type: 'image',
          coordinates: [
            [-80, 46],
            [-71, 46],
            [-71, 37],
            [-80, 37],
          ],
        })
      ).toThrow();
    });

    it('rejects missing coordinates', () => {
      expect(() =>
        ImageSourceSchema.parse({
          type: 'image',
          url: 'https://example.com/image.png',
        })
      ).toThrow();
    });

    it('rejects wrong number of coordinates', () => {
      expect(() =>
        ImageSourceSchema.parse({
          type: 'image',
          url: 'https://example.com/image.png',
          coordinates: [
            [-80, 46],
            [-71, 46],
          ],
        })
      ).toThrow();
    });

    it('rejects coordinates out of bounds', () => {
      expect(() =>
        ImageSourceSchema.parse({
          type: 'image',
          url: 'https://example.com/image.png',
          coordinates: [
            [-200, 46], // invalid longitude
            [-71, 46],
            [-71, 37],
            [-80, 37],
          ],
        })
      ).toThrow();
    });
  });
});

describe('VideoSourceSchema', () => {
  describe('valid sources', () => {
    it('accepts complete video source', () => {
      const source = {
        type: 'video' as const,
        urls: ['https://example.com/video.mp4', 'https://example.com/video.webm'],
        coordinates: [
          [-122.516, 37.562],
          [-122.515, 37.564],
          [-122.513, 37.563],
          [-122.514, 37.562],
        ] as [[number, number], [number, number], [number, number], [number, number]],
      };
      expect(VideoSourceSchema.parse(source)).toMatchObject(source);
    });

    it('accepts single URL', () => {
      const source = {
        type: 'video' as const,
        urls: ['https://example.com/video.mp4'],
        coordinates: [
          [-122.516, 37.562],
          [-122.515, 37.564],
          [-122.513, 37.563],
          [-122.514, 37.562],
        ] as [[number, number], [number, number], [number, number], [number, number]],
      };
      expect(VideoSourceSchema.parse(source)).toMatchObject(source);
    });
  });

  describe('invalid sources', () => {
    it('rejects empty urls array', () => {
      expect(() =>
        VideoSourceSchema.parse({
          type: 'video',
          urls: [],
          coordinates: [
            [-122, 37],
            [-122, 37],
            [-122, 37],
            [-122, 37],
          ],
        })
      ).toThrow();
    });

    it('rejects missing coordinates', () => {
      expect(() =>
        VideoSourceSchema.parse({
          type: 'video',
          urls: ['https://example.com/video.mp4'],
        })
      ).toThrow();
    });
  });
});

describe('LayerSourceSchema', () => {
  it('accepts geojson source', () => {
    const source = {
      type: 'geojson' as const,
      url: 'https://example.com/data.geojson',
    };
    const result = LayerSourceSchema.parse(source);
    expect(result.type).toBe('geojson');
  });

  it('accepts vector source', () => {
    const source = {
      type: 'vector' as const,
      url: 'https://example.com/tiles.json',
    };
    const result = LayerSourceSchema.parse(source);
    expect(result.type).toBe('vector');
  });

  it('accepts raster source', () => {
    const source = {
      type: 'raster' as const,
      url: 'https://example.com/tiles.json',
    };
    const result = LayerSourceSchema.parse(source);
    expect(result.type).toBe('raster');
  });

  it('accepts image source', () => {
    const source = {
      type: 'image' as const,
      url: 'https://example.com/image.png',
      coordinates: [
        [-80, 46],
        [-71, 46],
        [-71, 37],
        [-80, 37],
      ] as [[number, number], [number, number], [number, number], [number, number]],
    };
    const result = LayerSourceSchema.parse(source);
    expect(result.type).toBe('image');
  });

  it('accepts video source', () => {
    const source = {
      type: 'video' as const,
      urls: ['https://example.com/video.mp4'],
      coordinates: [
        [-122, 37],
        [-122, 37],
        [-122, 37],
        [-122, 37],
      ] as [[number, number], [number, number], [number, number], [number, number]],
    };
    const result = LayerSourceSchema.parse(source);
    expect(result.type).toBe('video');
  });

  it('rejects invalid source type', () => {
    expect(() =>
      LayerSourceSchema.parse({
        type: 'invalid',
        url: 'https://example.com',
      })
    ).toThrow();
  });
});
