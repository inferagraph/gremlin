export interface GremlinDatasourceConfig {
  endpoint: string;
  key?: string;          // Auth key (e.g. Cosmos DB primary key)
  database?: string;
  container?: string;
  ssl?: boolean;
  poolSize?: number;
}
