import { GremlinDataSource } from './GremlinDataSource.js';
import type { GremlinDataSourceConfig } from './types.js';

/**
 * Factory function that returns a configured `GremlinDataSource`. This is
 * the recommended on-ramp — the package internalizes Gremlin SDK
 * construction (storage owns SDK setup), so callers only supply domain
 * config (endpoint, auth, partition resolver, etc.).
 *
 * Direct `new GremlinDataSource(config)` construction is the escape hatch
 * for subclasses or callers that want to bypass the factory.
 */
export function gremlinDataSource(
  config: GremlinDataSourceConfig,
): GremlinDataSource {
  return new GremlinDataSource(config);
}
