/**
 * Pure SENSE/insights functions for the Facebook Graph API.
 *
 * Extracted from `index.ts` so they can be reused by:
 *   1. The MCP server's tool handlers (`server.registerTool("fb_get_*")` —
 *      they wrap these in MCP-protocol shape via `senseResult`).
 *   2. The web app's `platform-insights.ts` orchestrator — imported via
 *      webpack alias `@facebook-mcp/lib/insights` from compiled `dist/`.
 *
 * Single source of truth: any change to the URL paths, metric names, or
 * response shape happens here and propagates to both callers automatically.
 */
import type { FacebookClient } from "../client.js";
import { withRetry } from "../rate-limiter.js";
import { sanitize } from "../sanitize.js";

// ---------------------------------------------------------------------------
// fb_get_page_insights
// ---------------------------------------------------------------------------

export interface PageInsightsArgs {
  /** "day" | "week" | "days_28". Default: "day". */
  period?: string;
  /** Unix timestamp (string), inclusive. */
  since?: string;
  /** Unix timestamp (string), inclusive. */
  until?: string;
}

export interface PageInsightsResult {
  /** Period echoed back from the request. */
  period: string;
  /** Raw Graph API insights array — one element per metric. */
  insights: unknown[];
}

const PAGE_INSIGHTS_METRICS =
  "page_impressions_unique,page_post_engagements,page_views_total,page_follows";

export async function fetchPageInsights(
  client: FacebookClient,
  args: PageInsightsArgs = {},
): Promise<PageInsightsResult> {
  const params: Record<string, string> = {
    metric: PAGE_INSIGHTS_METRICS,
    period: args.period || "day",
  };
  if (args.since) params.since = args.since;
  if (args.until) params.until = args.until;

  const response = await withRetry(() =>
    client.get<{ data: unknown[] }>(`/${client.pageId}/insights`, params),
  );

  return { insights: response.data, period: params.period };
}

// ---------------------------------------------------------------------------
// fb_get_post_insights
// ---------------------------------------------------------------------------

export interface PostInsightsArgs {
  /** Facebook post ID, e.g. `{page-id}_{post-id}` or just post id. */
  postId: string;
}

export interface PostInsightsResult {
  postId: string;
  insights: unknown[];
}

const POST_INSIGHTS_METRICS =
  "post_impressions_unique,post_clicks,post_reactions_by_type_total";

export async function fetchPostInsights(
  client: FacebookClient,
  args: PostInsightsArgs,
): Promise<PostInsightsResult> {
  if (!args.postId.trim()) throw new Error("postId cannot be empty");
  const response = await withRetry(() =>
    client.get<{ data: unknown[] }>(`/${args.postId}/insights`, {
      metric: POST_INSIGHTS_METRICS,
    }),
  );
  return { postId: args.postId, insights: response.data };
}

// ---------------------------------------------------------------------------
// fb_get_page_feed
// ---------------------------------------------------------------------------

export interface PageFeedArgs {
  /** Default 25, max 100. */
  limit?: number;
  /** Pagination cursor. */
  after?: string;
}

export interface FeedPost {
  id: string;
  message: string;
  createdTime: string;
  permalinkUrl?: string;
  shareCount: number;
  statusType?: string;
  story?: string;
}

export interface PageFeedResult {
  posts: FeedPost[];
  count: number;
  nextCursor?: string;
}

export async function fetchPageFeed(
  client: FacebookClient,
  args: PageFeedArgs = {},
): Promise<PageFeedResult> {
  const params: Record<string, string> = {
    fields: "id,message,created_time,permalink_url,shares,status_type,story",
    limit: String(Math.min(args.limit || 25, 100)),
  };
  if (args.after) params.after = args.after;

  const response = await withRetry(() =>
    client.get<{
      data: Array<{
        id: string;
        message?: string;
        created_time: string;
        permalink_url?: string;
        shares?: { count: number };
        status_type?: string;
        story?: string;
      }>;
      paging?: { cursors?: { after?: string } };
    }>(`/${client.pageId}/feed`, params),
  );

  const posts: FeedPost[] = (response.data || []).map((p) => ({
    id: p.id,
    message: sanitize(p.message || ""),
    createdTime: p.created_time,
    permalinkUrl: p.permalink_url,
    shareCount: p.shares?.count ?? 0,
    statusType: p.status_type,
    story: p.story ? sanitize(p.story) : undefined,
  }));

  return {
    posts,
    count: posts.length,
    nextCursor: response.paging?.cursors?.after,
  };
}
