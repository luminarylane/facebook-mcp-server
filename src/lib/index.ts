/**
 * Public surface for programmatic (non-MCP) consumers.
 *
 * Import from `facebook-mcp-server/lib` to use the insights functions and
 * Graph API client directly without spinning up the MCP server.
 */
export * from "./insights.js";
export { FacebookClient, FacebookApiError, createClient } from "../client.js";
export type { Credentials, GraphApiError } from "../client.js";
