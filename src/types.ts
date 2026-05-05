/**
 * Shape of a Gremlin vertex as it appears in `client.submit()` results
 * after the gremlin-javascript driver has parsed the response. The driver
 * normalizes property values into either a plain value, an array of
 * `{ value }` cells, or an object with a `value` field. This type is
 * intentionally permissive — implementations of `getType` should be
 * defensive about the shape they read.
 */
export interface GremlinVertex {
  id: unknown;
  label?: string;
  properties?: Record<string, unknown>;
}

export interface GremlinDatasourceConfig {
  endpoint: string;
  key?: string;          // Auth key (e.g. Cosmos DB primary key)
  database?: string;
  container?: string;
  ssl?: boolean;
  poolSize?: number;
  /**
   * Resolve a vertex id into the value(s) to pass to g.V(...).
   * Default: identity — passes the id alone (TinkerPop / unpartitioned).
   * For Cosmos DB partitioned containers, return [partitionValue, id].
   *
   * Example (Bible Graph — partitionKey == id):
   *   getCompositeKey: (id) => [id, id]
   *
   * Example (host with a separate partition value):
   *   getCompositeKey: (id) => [getTypeFor(id), id]
   */
  getCompositeKey?: (id: string) => string | [string, string];
  /**
   * Resolve the semantic type of a vertex. Default returns the Gremlin
   * label (TinkerPop convention: the label IS the type). Override when
   * your data stores the type in a property — e.g. when every vertex
   * shares a single label and the real type lives on a `type` property.
   *
   * Example (host stores type in a property):
   *   getType: (v) => v.properties?.type?.[0]?.value ?? v.label
   */
  getType?: (vertex: GremlinVertex) => string | undefined;
  /**
   * Name of the vertex property used for `search()` and as the node's
   * display name in `filter({ search })`. Default: `'name'`.
   *
   * Override when your data stores the searchable display name on a
   * different property (e.g. `'title'`, `'displayName'`).
   */
  nameProperty?: string;
}
