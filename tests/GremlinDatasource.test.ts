import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GremlinDatasource } from '../src/GremlinDatasource.js';
import type { GremlinDatasourceConfig } from '../src/types.js';

// Mock @inferagraph/core
vi.mock('@inferagraph/core', () => {
  class Datasource {}
  return { Datasource };
});

// Mock gremlin module
const mockOpen = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockSubmit = vi.fn().mockResolvedValue({ _items: [] });

vi.mock('gremlin', () => {
  return {
    default: {
      driver: {
        Client: vi.fn().mockImplementation(() => ({
          open: mockOpen,
          close: mockClose,
          submit: mockSubmit,
        })),
        auth: {
          PlainTextSaslAuthenticator: vi.fn().mockImplementation(() => ({})),
        },
      },
    },
  };
});

const defaultConfig: GremlinDatasourceConfig = {
  endpoint: 'wss://localhost:8182/',
};

const cosmosConfig: GremlinDatasourceConfig = {
  endpoint: 'wss://my-cosmos.gremlin.cosmos.azure.com:443/',
  key: 'my-primary-key',
  database: 'mydb',
  container: 'mygraph',
};

function makeVertex(id: string, label: string, properties: Record<string, unknown> = {}) {
  return { id, label, properties };
}

function makeEdge(id: string, outV: string, inV: string, label: string, properties: Record<string, unknown> = {}) {
  return { id, outV: { id: outV }, inV: { id: inV }, label, properties };
}

describe('GremlinDatasource', () => {
  let ds: GremlinDatasource;

  beforeEach(() => {
    vi.clearAllMocks();
    ds = new GremlinDatasource(defaultConfig);
  });

  describe('name', () => {
    it('should be "gremlin"', () => {
      expect(ds.name).toBe('gremlin');
    });
  });

  describe('isConnected', () => {
    it('should return false before connect', () => {
      expect(ds.isConnected()).toBe(false);
    });

    it('should return true after connect', async () => {
      await ds.connect();
      expect(ds.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      await ds.connect();
      await ds.disconnect();
      expect(ds.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should create client and call open', async () => {
      await ds.connect();
      expect(mockOpen).toHaveBeenCalledOnce();
      expect(ds.isConnected()).toBe(true);
    });

    it('should create authenticator for Cosmos DB config', async () => {
      const gremlin = await import('gremlin');
      const cosmosDs = new GremlinDatasource(cosmosConfig);
      await cosmosDs.connect();
      expect(gremlin.default.driver.auth.PlainTextSaslAuthenticator).toHaveBeenCalledWith(
        '/dbs/mydb/colls/mygraph',
        'my-primary-key',
      );
    });

    it('should not create authenticator when no key provided', async () => {
      const gremlin = await import('gremlin');
      vi.mocked(gremlin.default.driver.auth.PlainTextSaslAuthenticator).mockClear();
      const noKeyDs = new GremlinDatasource(defaultConfig);
      await noKeyDs.connect();
      expect(gremlin.default.driver.auth.PlainTextSaslAuthenticator).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should close client and set to null', async () => {
      await ds.connect();
      await ds.disconnect();
      expect(mockClose).toHaveBeenCalledOnce();
      expect(ds.isConnected()).toBe(false);
    });

    it('should be safe to call when not connected', async () => {
      await ds.disconnect();
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('ensureConnected', () => {
    it('should throw when not connected', async () => {
      await expect(ds.getNode('1')).rejects.toThrow(
        'GremlinDatasource is not connected. Call connect() first.',
      );
    });

    it('should not throw when connected', async () => {
      await ds.connect();
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await expect(ds.getNode('1')).resolves.not.toThrow();
    });
  });

  describe('getInitialView', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should query vertices with default limit of 100', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.getInitialView();
      expect(mockSubmit).toHaveBeenCalledWith('g.V().limit(100)');
    });

    it('should query vertices with custom limit', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.getInitialView({ limit: 50 });
      expect(mockSubmit).toHaveBeenCalledWith('g.V().limit(50)');
    });

    it('should return empty graph when no vertices found', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      const result = await ds.getInitialView();
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should transform vertices and fetch edges', async () => {
      const vertices = [
        makeVertex('v1', 'person', { name: [{ value: 'Alice' }] }),
        makeVertex('v2', 'person', { name: [{ value: 'Bob' }] }),
      ];
      const edges = [
        makeEdge('e1', 'v1', 'v2', 'knows'),
      ];

      mockSubmit
        .mockResolvedValueOnce({ _items: vertices })
        .mockResolvedValueOnce({ _items: edges });

      const result = await ds.getInitialView();
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].id).toBe('v1');
      expect(result.nodes[0].attributes.type).toBe('person');
      expect(result.nodes[0].attributes.name).toBe('Alice');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].sourceId).toBe('v1');
      expect(result.edges[0].targetId).toBe('v2');
    });
  });

  describe('getNode', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should return undefined when vertex not found', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      const result = await ds.getNode('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return transformed node', async () => {
      mockSubmit.mockResolvedValueOnce({
        _items: [makeVertex('v1', 'person', { name: [{ value: 'Alice' }], age: { value: 30 } })],
      });
      const result = await ds.getNode('v1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('v1');
      expect(result!.attributes.type).toBe('person');
      expect(result!.attributes.name).toBe('Alice');
      expect(result!.attributes.age).toBe(30);
    });
  });

  describe('getNeighbors', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should fetch origin node and neighbors with edges', async () => {
      const neighbors = [makeVertex('v2', 'person', { name: [{ value: 'Bob' }] })];
      const origin = [makeVertex('v1', 'person', { name: [{ value: 'Alice' }] })];
      const edges = [makeEdge('e1', 'v1', 'v2', 'knows')];

      mockSubmit
        .mockResolvedValueOnce({ _items: neighbors })
        .mockResolvedValueOnce({ _items: origin })
        .mockResolvedValueOnce({ _items: edges });

      const result = await ds.getNeighbors('v1', 1);
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it('should default depth to 1', async () => {
      mockSubmit
        .mockResolvedValueOnce({ _items: [] })
        .mockResolvedValueOnce({ _items: [] })
        .mockResolvedValueOnce({ _items: [] });

      await ds.getNeighbors('v1');
      expect(mockSubmit).toHaveBeenCalledWith(
        'g.V(nodeId).repeat(both().simplePath()).times(depth).dedup()',
        { nodeId: 'v1', depth: 1 },
      );
    });
  });

  describe('findPath', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should return empty graph when no path found', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      const result = await ds.findPath('v1', 'v99');
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should extract vertices from path and fetch edges', async () => {
      const pathResult = {
        _items: [{
          objects: [
            { id: 'v1', label: 'person' },
            { id: 'v2', label: 'person' },
          ],
        }],
      };
      const edges = [makeEdge('e1', 'v1', 'v2', 'knows')];

      mockSubmit
        .mockResolvedValueOnce(pathResult)
        .mockResolvedValueOnce({ _items: edges });

      const result = await ds.findPath('v1', 'v2');
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it('should skip edge-like objects in path', async () => {
      const pathResult = {
        _items: [{
          objects: [
            { id: 'v1', label: 'person' },
            { id: 'e1', label: 'knows', inV: 'v2' }, // edge-like, should be skipped
            { id: 'v2', label: 'person' },
          ],
        }],
      };

      mockSubmit
        .mockResolvedValueOnce(pathResult)
        .mockResolvedValueOnce({ _items: [] });

      const result = await ds.findPath('v1', 'v2');
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.every(n => !('inV' in n))).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should submit search query', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.search('alice');
      expect(mockSubmit).toHaveBeenCalledWith(
        `g.V().has('name', TextP.containing(query))`,
        { query: 'alice' },
      );
    });

    it('should return all results when no pagination', async () => {
      const vertices = [
        makeVertex('v1', 'person', { name: [{ value: 'Alice' }] }),
        makeVertex('v2', 'person', { name: [{ value: 'Alicia' }] }),
      ];
      mockSubmit.mockResolvedValueOnce({ _items: vertices });

      const result = await ds.search('ali');
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should apply pagination', async () => {
      const vertices = [
        makeVertex('v1', 'person'),
        makeVertex('v2', 'person'),
        makeVertex('v3', 'person'),
      ];
      mockSubmit.mockResolvedValueOnce({ _items: vertices });

      const result = await ds.search('test', { offset: 0, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('filter', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should build traversal with types filter', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.filter({ types: ['person', 'place'] });
      expect(mockSubmit).toHaveBeenCalledWith(
        `g.V().has('type', within(types))`,
        { types: ['person', 'place'] },
      );
    });

    it('should build traversal with search filter', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.filter({ search: 'alice' });
      expect(mockSubmit).toHaveBeenCalledWith(
        `g.V().has('name', TextP.containing(searchText))`,
        { searchText: 'alice' },
      );
    });

    it('should build traversal with attribute filters', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.filter({ attributes: { age: 30, city: 'NYC' } });
      expect(mockSubmit).toHaveBeenCalledWith(
        `g.V().has(attrKey0, attrVal0).has(attrKey1, attrVal1)`,
        { attrKey0: 'age', attrVal0: 30, attrKey1: 'city', attrVal1: 'NYC' },
      );
    });

    it('should combine multiple filters', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.filter({
        types: ['person'],
        search: 'alice',
        attributes: { age: 30 },
      });
      expect(mockSubmit).toHaveBeenCalledWith(
        `g.V().has('type', within(types)).has('name', TextP.containing(searchText)).has(attrKey0, attrVal0)`,
        { types: ['person'], searchText: 'alice', attrKey0: 'age', attrVal0: 30 },
      );
    });

    it('should build base traversal with empty filter', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      await ds.filter({});
      expect(mockSubmit).toHaveBeenCalledWith('g.V()', {});
    });

    it('should apply pagination to filter results', async () => {
      const vertices = [
        makeVertex('v1', 'person'),
        makeVertex('v2', 'person'),
        makeVertex('v3', 'person'),
      ];
      mockSubmit.mockResolvedValueOnce({ _items: vertices });

      const result = await ds.filter({}, { offset: 1, limit: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('v2');
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getContent', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should return undefined when no content vertex found', async () => {
      mockSubmit.mockResolvedValueOnce({ _items: [] });
      const result = await ds.getContent('v1');
      expect(result).toBeUndefined();
    });

    it('should return undefined when vertex has no content property value', async () => {
      mockSubmit.mockResolvedValueOnce({
        _items: [makeVertex('v1', 'doc', {})],
      });
      const result = await ds.getContent('v1');
      expect(result).toBeUndefined();
    });

    it('should extract content and contentType', async () => {
      mockSubmit.mockResolvedValueOnce({
        _items: [makeVertex('v1', 'doc', {
          content: [{ value: 'Hello world' }],
          contentType: [{ value: 'markdown' }],
        })],
      });
      const result = await ds.getContent('v1');
      expect(result).toEqual({
        nodeId: 'v1',
        content: 'Hello world',
        contentType: 'markdown',
      });
    });

    it('should default contentType to "text"', async () => {
      mockSubmit.mockResolvedValueOnce({
        _items: [makeVertex('v1', 'doc', {
          content: [{ value: 'Hello world' }],
        })],
      });
      const result = await ds.getContent('v1');
      expect(result!.contentType).toBe('text');
    });
  });

  describe('vertex transformation', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should handle multi-value properties', async () => {
      const vertex = makeVertex('v1', 'person', {
        tags: [{ value: 'tag1' }, { value: 'tag2' }],
      });
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.attributes.tags).toEqual(['tag1', 'tag2']);
    });

    it('should handle single-value array properties', async () => {
      const vertex = makeVertex('v1', 'person', {
        name: [{ value: 'Alice' }],
      });
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.attributes.name).toBe('Alice');
    });

    it('should handle object properties with value key', async () => {
      const vertex = makeVertex('v1', 'person', {
        age: { value: 30 },
      });
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.attributes.age).toBe(30);
    });

    it('should handle plain value properties', async () => {
      const vertex = makeVertex('v1', 'person', {
        score: 42,
      });
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.attributes.score).toBe(42);
    });

    it('should handle vertex without properties', async () => {
      const vertex = { id: 'v1', label: 'person' };
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.id).toBe('v1');
      expect(result!.attributes.type).toBe('person');
    });

    it('should handle array property items without value key', async () => {
      const vertex = makeVertex('v1', 'person', {
        tags: ['raw1', 'raw2'],
      });
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.attributes.tags).toEqual(['raw1', 'raw2']);
    });

    it('should unwrap single array item without value key', async () => {
      const vertex = makeVertex('v1', 'person', {
        name: ['Alice'],
      });
      mockSubmit.mockResolvedValueOnce({ _items: [vertex] });
      const result = await ds.getNode('v1');
      expect(result!.attributes.name).toBe('Alice');
    });
  });

  describe('edge transformation', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should transform edges with object outV/inV', async () => {
      const vertices = [makeVertex('v1', 'person'), makeVertex('v2', 'person')];
      const edges = [makeEdge('e1', 'v1', 'v2', 'knows', { weight: 0.5 })];

      mockSubmit
        .mockResolvedValueOnce({ _items: vertices })
        .mockResolvedValueOnce({ _items: edges });

      const result = await ds.getInitialView();
      expect(result.edges[0]).toEqual({
        id: 'e1',
        sourceId: 'v1',
        targetId: 'v2',
        attributes: { type: 'knows', weight: 0.5 },
      });
    });

    it('should transform edges with string outV/inV', async () => {
      const vertices = [makeVertex('v1', 'person'), makeVertex('v2', 'person')];
      const edges = [{ id: 'e1', outV: 'v1', inV: 'v2', label: 'knows', properties: {} }];

      mockSubmit
        .mockResolvedValueOnce({ _items: vertices })
        .mockResolvedValueOnce({ _items: edges });

      const result = await ds.getInitialView();
      expect(result.edges[0].sourceId).toBe('v1');
      expect(result.edges[0].targetId).toBe('v2');
    });

    it('should handle edges without label', async () => {
      const vertices = [makeVertex('v1', 'person'), makeVertex('v2', 'person')];
      const edges = [{ id: 'e1', outV: 'v1', inV: 'v2', properties: {} }];

      mockSubmit
        .mockResolvedValueOnce({ _items: vertices })
        .mockResolvedValueOnce({ _items: edges });

      const result = await ds.getInitialView();
      expect(result.edges[0].attributes.type).toBe('');
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should return all items when no pagination specified', async () => {
      const vertices = [
        makeVertex('v1', 'a'),
        makeVertex('v2', 'b'),
        makeVertex('v3', 'c'),
      ];
      mockSubmit.mockResolvedValueOnce({ _items: vertices });

      const result = await ds.search('test');
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should slice correctly with offset and limit', async () => {
      const vertices = [
        makeVertex('v1', 'a'),
        makeVertex('v2', 'b'),
        makeVertex('v3', 'c'),
        makeVertex('v4', 'd'),
        makeVertex('v5', 'e'),
      ];
      mockSubmit.mockResolvedValueOnce({ _items: vertices });

      const result = await ds.search('test', { offset: 1, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('v2');
      expect(result.items[1].id).toBe('v3');
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('should set hasMore to false when at end', async () => {
      const vertices = [
        makeVertex('v1', 'a'),
        makeVertex('v2', 'b'),
      ];
      mockSubmit.mockResolvedValueOnce({ _items: vertices });

      const result = await ds.search('test', { offset: 0, limit: 5 });
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('missing _items handling', () => {
    beforeEach(async () => {
      await ds.connect();
    });

    it('should handle result without _items', async () => {
      mockSubmit.mockResolvedValueOnce({});
      const result = await ds.getNode('v1');
      expect(result).toBeUndefined();
    });
  });
});
