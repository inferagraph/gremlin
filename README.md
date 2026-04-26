# @inferagraph/gremlin-datasource

Apache TinkerPop Gremlin datasource plugin for [@inferagraph/core](https://github.com/inferagraph/core).

## Installation

```bash
pnpm add @inferagraph/gremlin-datasource @inferagraph/core
```

## Configuration

```typescript
import { GremlinDatasource } from '@inferagraph/gremlin-datasource';

const datasource = new GremlinDatasource({
  endpoint: 'wss://your-gremlin-server:443/',
  key: 'your-auth-key',        // optional, for Cosmos DB
  database: 'your-database',   // optional, for Cosmos DB
  container: 'your-container', // optional, for Cosmos DB
  ssl: true,                   // optional
  poolSize: 4,                 // optional
});
```

## Usage

```typescript
// Connect to the Gremlin server
await datasource.connect();

// Fetch initial graph view
const graph = await datasource.getInitialView({ limit: 50 });

// Get a specific node
const node = await datasource.getNode('some-vertex-id');

// Get neighbors of a node
const neighbors = await datasource.getNeighbors('some-vertex-id', 2);

// Search for nodes
const results = await datasource.search('search term');

// Disconnect when done
await datasource.disconnect();
```

## License

MIT
