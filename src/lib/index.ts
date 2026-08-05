/**
 * Public surface for non-MCP consumers (e.g. the web app importing via
 * the `@facebook-mcp/lib` webpack alias).
 *
 * The MCP server's `index.ts` keeps registering its tool handlers using
 * these same modules — single source of truth for both callers.
 */
export * from "./insights.js";
export { FacebookClient, FacebookApiError, createClient } from "../client.js";
export type { Credentials, GraphApiError } from "../client.js";
