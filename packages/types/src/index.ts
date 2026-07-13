// @atlitos/types public entry point. Every app and package imports from
// here, never from a deeper path, so the internal file layout can change
// without touching consumers.

export * from './enums';
export * from './errors';
export * from './transitions/index';
export * from './domain/index';

// Database row types (interim hand-authored, see db/rows.ts header) are
// exported under a `Db` namespace to keep them visually distinct from the
// camelCase domain types above; app code should reach for the domain types
// first and only touch `Db.*` inside packages/api's mapping layer.
export * as Db from './db/rows';
export type { Database, Json } from './db/database.types';
