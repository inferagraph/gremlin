import { Datasource } from '@inferagraph/core';
import type {
  DataAdapterConfig, GraphData, NodeId, NodeData,
  ContentData, PaginationOptions, PaginatedResult, DataFilter,
} from '@inferagraph/core';
import gremlin from 'gremlin';
import type { GremlinDatasourceConfig } from './types.js';

const { driver } = gremlin;

export class GremlinDatasource extends Datasource {
  readonly name = 'gremlin';
  private client: InstanceType<typeof driver.Client> | null = null;
  private config: GremlinDatasourceConfig;

  constructor(config: GremlinDatasourceConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    const authenticator = this.config.key
      ? new driver.auth.PlainTextSaslAuthenticator(
          `/dbs/${this.config.database}/colls/${this.config.container}`,
          this.config.key,
        )
      : undefined;

    this.client = new driver.Client(this.config.endpoint, {
      authenticator,
      traversalsource: 'g',
      rejectUnauthorized: true,
      mimeType: 'application/vnd.gremlin-v2.0+json',
    });

    await this.client.open();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  async getInitialView(config?: DataAdapterConfig): Promise<GraphData> {
    this.ensureConnected();
    const limit = (config?.limit as number) ?? 100;

    // Get vertices
    const vertexResult = await this.client!.submit(`g.V().limit(${limit})`);
    const nodes = this.transformVertices(vertexResult._items || []);

    // Get edges between those vertices
    const nodeIds = nodes.map(n => n.id);
    if (nodeIds.length === 0) return { nodes: [], edges: [] };

    const edgeResult = await this.client!.submit(
      `g.V(ids).bothE().where(otherV().hasId(within(ids)))`,
      { ids: nodeIds },
    );
    const edges = this.transformEdges(edgeResult._items || []);

    return { nodes, edges };
  }

  async getNode(id: NodeId): Promise<NodeData | undefined> {
    this.ensureConnected();
    const result = await this.client!.submit('g.V(id)', { id });
    const items = result._items || [];
    if (items.length === 0) return undefined;
    return this.transformVertices(items)[0];
  }

  async getNeighbors(nodeId: NodeId, depth: number = 1): Promise<GraphData> {
    this.ensureConnected();

    // Get neighbors up to depth
    const vertexResult = await this.client!.submit(
      `g.V(nodeId).repeat(both().simplePath()).times(depth).dedup()`,
      { nodeId, depth },
    );
    const neighborNodes = this.transformVertices(vertexResult._items || []);

    // Also get the origin node
    const originResult = await this.client!.submit('g.V(nodeId)', { nodeId });
    const originNodes = this.transformVertices(originResult._items || []);

    const allNodes = [...originNodes, ...neighborNodes];
    const allNodeIds = allNodes.map(n => n.id);

    // Get edges between all involved nodes
    const edgeResult = await this.client!.submit(
      `g.V(ids).bothE().where(otherV().hasId(within(ids)))`,
      { ids: allNodeIds },
    );
    const edges = this.transformEdges(edgeResult._items || []);

    return { nodes: allNodes, edges };
  }

  async findPath(fromId: NodeId, toId: NodeId): Promise<GraphData> {
    this.ensureConnected();

    const result = await this.client!.submit(
      `g.V(fromId).repeat(both().simplePath()).until(hasId(toId)).limit(1).path()`,
      { fromId, toId },
    );

    const items = result._items || [];
    if (items.length === 0) return { nodes: [], edges: [] };

    // Extract path objects
    const pathObjects = items[0]?.objects || [];
    const nodes: NodeData[] = [];

    for (const obj of pathObjects) {
      if (obj.id && obj.label && !obj.inV) {
        nodes.push(this.transformVertex(obj));
      }
    }

    // Get edges between path nodes
    const nodeIds = nodes.map(n => n.id);
    const edgeResult = await this.client!.submit(
      `g.V(ids).bothE().where(otherV().hasId(within(ids)))`,
      { ids: nodeIds },
    );
    const pathEdges = this.transformEdges(edgeResult._items || []);

    return { nodes, edges: pathEdges };
  }

  async search(query: string, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> {
    this.ensureConnected();

    const result = await this.client!.submit(
      `g.V().has('name', TextP.containing(query))`,
      { query },
    );

    const allItems = this.transformVertices(result._items || []);
    return this.paginate(allItems, pagination);
  }

  async filter(filter: DataFilter, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> {
    this.ensureConnected();

    // Build Gremlin traversal dynamically
    let traversal = 'g.V()';
    const bindings: Record<string, unknown> = {};

    if (filter.types?.length) {
      traversal += `.has('type', within(types))`;
      bindings.types = filter.types;
    }
    if (filter.search) {
      traversal += `.has('name', TextP.containing(searchText))`;
      bindings.searchText = filter.search;
    }
    if (filter.attributes) {
      let i = 0;
      for (const [key, value] of Object.entries(filter.attributes)) {
        traversal += `.has(attrKey${i}, attrVal${i})`;
        bindings[`attrKey${i}`] = key;
        bindings[`attrVal${i}`] = value;
        i++;
      }
    }

    const result = await this.client!.submit(traversal, bindings);
    const allItems = this.transformVertices(result._items || []);
    return this.paginate(allItems, pagination);
  }

  async getContent(nodeId: NodeId): Promise<ContentData | undefined> {
    this.ensureConnected();

    const result = await this.client!.submit(
      `g.V(nodeId).has('content')`,
      { nodeId },
    );

    const items = result._items || [];
    if (items.length === 0) return undefined;

    const vertex = items[0];
    const content = this.getProperty(vertex, 'content');
    if (!content) return undefined;

    return {
      nodeId,
      content: String(content),
      contentType: (this.getProperty(vertex, 'contentType') as string) ?? 'text',
    };
  }

  // --- Private Helpers ---

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error('GremlinDatasource is not connected. Call connect() first.');
    }
  }

  private transformVertices(items: unknown[]): NodeData[] {
    return items.map(item => this.transformVertex(item));
  }

  private transformVertex(vertex: unknown): NodeData {
    const v = vertex as Record<string, unknown>;
    const id = String(v.id);
    const attributes: Record<string, unknown> = {};

    if (v.label) attributes.type = v.label;

    // Gremlin properties can be nested objects
    const properties = v.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const [key, val] of Object.entries(properties)) {
        if (Array.isArray(val)) {
          // Multi-value property
          attributes[key] = val.length === 1
            ? (val[0] as Record<string, unknown>)?.value ?? val[0]
            : val.map((item: unknown) => (item as Record<string, unknown>)?.value ?? item);
        } else if (typeof val === 'object' && val !== null && 'value' in (val as Record<string, unknown>)) {
          attributes[key] = (val as Record<string, unknown>).value;
        } else {
          attributes[key] = val;
        }
      }
    }

    return { id, attributes };
  }

  private transformEdges(items: unknown[]): Array<{ id: string; sourceId: string; targetId: string; attributes: Record<string, unknown> }> {
    return items.map((edge: unknown) => {
      const e = edge as Record<string, unknown>;
      const outV = e.outV as Record<string, unknown> | string | undefined;
      const inV = e.inV as Record<string, unknown> | string | undefined;
      return {
        id: String(e.id),
        sourceId: String(typeof outV === 'object' && outV !== null ? outV.id : outV),
        targetId: String(typeof inV === 'object' && inV !== null ? inV.id : inV),
        attributes: {
          type: (e.label as string) ?? '',
          ...((e.properties as Record<string, unknown>) || {}),
        },
      };
    });
  }

  private getProperty(vertex: unknown, key: string): unknown {
    const v = vertex as Record<string, unknown>;
    const properties = v.properties as Record<string, unknown> | undefined;
    if (properties?.[key]) {
      const prop = properties[key];
      if (Array.isArray(prop)) return (prop[0] as Record<string, unknown>)?.value ?? prop[0];
      if (typeof prop === 'object' && prop !== null && 'value' in (prop as Record<string, unknown>)) return (prop as Record<string, unknown>).value;
      return prop;
    }
    return undefined;
  }

  private paginate(items: NodeData[], pagination?: PaginationOptions): PaginatedResult<NodeData> {
    const total = items.length;
    if (!pagination) return { items, total, hasMore: false };
    const { offset, limit } = pagination;
    const sliced = items.slice(offset, offset + limit);
    return { items: sliced, total, hasMore: offset + limit < total };
  }
}
