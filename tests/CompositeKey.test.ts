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

const neutralConfig: GremlinDatasourceConfig = {
  endpoint: 'wss://localhost:8182/',
};

const cosmosConfig: GremlinDatasourceConfig = {
  endpoint: 'wss://my-cosmos.gremlin.cosmos.azure.com:443/',
  key: 'my-primary-key',
  database: 'mydb',
  container: 'mygraph',
  // Bible Graph upserts vertices with partitionKey == id, so the
  // composite key is [id, id]. This is purely host-supplied — the
  // library does NOT bake in any partition scheme.
  getCompositeKey: (id: string) => [id, id] as [string, string],
};

describe('GremlinDatasource composite-key option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the bare id to g.V(...) when getCompositeKey is NOT configured (TinkerPop default)', async () => {
    const ds = new GremlinDatasource(neutralConfig);
    await ds.connect();
    mockSubmit.mockResolvedValueOnce({ _items: [] });

    await ds.getNode('alice');

    expect(mockSubmit).toHaveBeenCalledWith('g.V(id)', { id: 'alice' });
  });

  it('passes the composite key tuple to g.V(...) when getCompositeKey is configured (Cosmos)', async () => {
    const ds = new GremlinDatasource(cosmosConfig);
    await ds.connect();
    mockSubmit.mockResolvedValueOnce({ _items: [] });

    await ds.getNode('alice');

    expect(mockSubmit).toHaveBeenCalledWith('g.V(id)', { id: ['alice', 'alice'] });
  });

  it('maps every id through getCompositeKey for multi-id sites (getNeighbors edge fetch)', async () => {
    const ds = new GremlinDatasource(cosmosConfig);
    await ds.connect();

    // 1st submit: neighbors traversal (origin = 'alice')
    // 2nd submit: origin lookup
    // 3rd submit: edge fetch over all ids
    mockSubmit
      .mockResolvedValueOnce({
        _items: [{ id: 'bob', label: 'person', properties: {} }],
      })
      .mockResolvedValueOnce({
        _items: [{ id: 'alice', label: 'person', properties: {} }],
      })
      .mockResolvedValueOnce({ _items: [] });

    await ds.getNeighbors('alice', 1);

    // First call: g.V(nodeId)... with composite key for 'alice'
    expect(mockSubmit).toHaveBeenNthCalledWith(
      1,
      'g.V(nodeId).repeat(both().simplePath()).times(depth).dedup()',
      { nodeId: ['alice', 'alice'], depth: 1 },
    );

    // Third call: edge fetch — every id in the bound array becomes a tuple
    expect(mockSubmit).toHaveBeenNthCalledWith(
      3,
      'g.V(ids).bothE().dedup()',
      { ids: [['alice', 'alice'], ['bob', 'bob']] },
    );
  });
});
