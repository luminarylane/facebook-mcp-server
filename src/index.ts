#!/usr/bin/env node
/**
 * Standalone Facebook Pages MCP Server
 *
 * Dual-purpose SENSE + ACT server for the Facebook Graph API (Pages).
 * Unlike the Instagram MCP, Facebook publishes are synchronous — no container
 * creation, no status polling. One POST to /{page-id}/feed (or /photos, /videos)
 * returns the new post ID directly.
 *
 * Tools:
 *   SENSE: fb_get_page_insights, fb_get_post_insights, fb_get_comments,
 *          fb_get_page_feed
 *   ACT:   fb_create_post, fb_reply_comment, fb_delete_post
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { textResult, errorResult, senseResult } from "./response.js";
import {
  createClient,
  FacebookApiError,
  type FacebookClient,
} from "./client.js";
import { waitForRateLimit, withRetry } from "./rate-limiter.js";
import { sanitize } from "./sanitize.js";
import { extractApiDetail, suggestAction } from "./errors.js";
import { buildCreatePostRequest } from "./create-post.js";
import {
  fetchPageInsights,
  fetchPostInsights,
  fetchPageFeed,
} from "./lib/insights.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// --- Env-based defaults ---

const DEFAULT_ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
const DEFAULT_PAGE_ID = process.env.FACEBOOK_PAGE_ID;

// --- Credential resolution ---

const credentialFields = {
  accessToken: z
    .string()
    .optional()
    .describe(
      "Facebook Page access token. Falls back to FACEBOOK_ACCESS_TOKEN env var.",
    ),
  pageId: z
    .string()
    .optional()
    .describe(
      "Facebook Page ID (the numeric id of the page you admin). Falls back to FACEBOOK_PAGE_ID env var.",
    ),
};

interface CredentialArgs {
  accessToken?: string;
  pageId?: string;
}

export function resolveCredentials(
  args: CredentialArgs,
): { accessToken: string; pageId: string } | null {
  const accessToken = args.accessToken || DEFAULT_ACCESS_TOKEN;
  const pageId = args.pageId || DEFAULT_PAGE_ID;
  if (!accessToken || !pageId) return null;
  return { accessToken, pageId };
}

type ClientResult =
  | { ok: true; client: FacebookClient }
  | { ok: false; error: ReturnType<typeof errorResult> };

export async function getClient(
  args: CredentialArgs,
  toolName?: string,
): Promise<ClientResult> {
  const creds = resolveCredentials(args);
  if (!creds) {
    return {
      ok: false,
      error: errorResult(
        "Missing credentials",
        "Provide accessToken + pageId as arguments, or set FACEBOOK_ACCESS_TOKEN and FACEBOOK_PAGE_ID env vars.",
      ),
    };
  }

  // Pre-flight rate limit check (per-tenant, keyed by pageId)
  const limit = await waitForRateLimit(toolName, creds.pageId);
  if (!limit.allowed) {
    const retryAfterSeconds = Math.ceil(limit.retryAfterMs / 1000);
    return {
      ok: false,
      error: errorResult(
        "Rate limited",
        `Facebook API rate limit reached. Wait ${retryAfterSeconds}s then retry.`,
        {
          retryAfterSeconds,
          action:
            retryAfterSeconds <= 120
              ? `RETRY_AFTER_WAIT: Sleep ${retryAfterSeconds}s then retry this tool call.`
              : `DEFER: Rate limit cooldown is ${retryAfterSeconds}s. Switch to a different task.`,
        },
      ),
    };
  }

  try {
    const client = createClient(creds);
    return { ok: true, client };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      ok: false,
      error: errorResult(
        "Client error",
        `Failed to create Facebook client: ${msg}`,
      ),
    };
  }
}

// --- Error handling ---

export function safeHandler<T>(
  toolName: string,
  handler: (
    args: T,
  ) => Promise<ReturnType<typeof textResult | typeof senseResult>>,
): (
  args: T,
) => Promise<
  ReturnType<typeof textResult | typeof senseResult | typeof errorResult>
> {
  return async (args: T) => {
    try {
      return await handler(args);
    } catch (e) {
      try {
        const msg = e instanceof Error ? e.message : String(e);
        const detail = extractApiDetail(e);
        const statusCode = e instanceof FacebookApiError ? e.status : undefined;
        const action = suggestAction(toolName, statusCode, detail, msg);
        console.error(
          `[${toolName}] Error: ${msg}${detail ? ` — ${detail}` : ""}`,
        );
        return errorResult(
          "API error",
          `${toolName} failed: ${detail || msg}`,
          {
            ...(statusCode !== undefined && { statusCode }),
            ...(detail && detail !== msg && { rawError: msg }),
            ...(action && { action }),
          },
        );
      } catch (formatErr) {
        const fallback = e instanceof Error ? e.message : "Unknown error";
        const fmtMsg =
          formatErr instanceof Error ? formatErr.message : String(formatErr);
        console.error(
          `[${toolName}] Error (fallback): ${fallback} — error formatting also failed: ${fmtMsg}`,
        );
        return errorResult("API error", `${toolName} failed: ${fallback}`);
      }
    }
  };
}

// --- Server Setup ---

const server = new McpServer({
  name: "facebook-mcp-server",
  version,
});

// =====================
// SENSE Tools (read)
// =====================

server.registerTool(
  "fb_get_page_insights",
  {
    description:
      "Get Facebook Page insights: impressions, reach, post engagements, and follower count over a period.",
    inputSchema: {
      ...credentialFields,
      period: z
        .enum(["day", "week", "days_28"])
        .optional()
        .describe('Aggregation period (default: "day")'),
      since: z
        .string()
        .optional()
        .describe("Start date as Unix timestamp (e.g., '1700000000')"),
      until: z.string().optional().describe("End date as Unix timestamp"),
    },
  },
  safeHandler("fb_get_page_insights", async (args) => {
    const result = await getClient(args, "fb_get_page_insights");
    if (!result.ok) return result.error;
    const { client } = result;

    const data = await fetchPageInsights(client, {
      period: args.period,
      since: args.since,
      until: args.until,
    });

    return senseResult(data, "Facebook");
  }),
);

server.registerTool(
  "fb_get_post_insights",
  {
    description:
      "Get engagement metrics for a specific Facebook post: impressions, engaged users, clicks, and reactions.",
    inputSchema: {
      ...credentialFields,
      postId: z
        .string()
        .describe(
          "Facebook post ID (format: {page-id}_{post-id} or just post id)",
        ),
    },
  },
  safeHandler("fb_get_post_insights", async (args) => {
    if (!args.postId.trim())
      return errorResult("Invalid input", "postId cannot be empty");
    const result = await getClient(args, "fb_get_post_insights");
    if (!result.ok) return result.error;
    const { client } = result;

    const data = await fetchPostInsights(client, { postId: args.postId });
    return senseResult(data, "Facebook");
  }),
);

server.registerTool(
  "fb_get_comments",
  {
    description:
      "Get comments on a Facebook post. Returns comment text, author name, and timestamps. Content is sanitized for safe agent consumption.",
    inputSchema: {
      ...credentialFields,
      postId: z.string().describe("Facebook post ID"),
      limit: z
        .number()
        .optional()
        .describe("Number of comments (default: 25, max: 100)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
  },
  safeHandler("fb_get_comments", async (args) => {
    if (!args.postId.trim())
      return errorResult("Invalid input", "postId cannot be empty");
    const result = await getClient(args, "fb_get_comments");
    if (!result.ok) return result.error;
    const { client } = result;

    const params: Record<string, string> = {
      fields: "id,message,from{id,name},created_time,like_count,comment_count",
      limit: String(Math.min(args.limit || 25, 100)),
    };
    if (args.after) params.after = args.after;

    const response = await withRetry(() =>
      client.get<{
        data: Array<{
          id: string;
          message?: string;
          from?: { id: string; name: string };
          created_time: string;
          like_count?: number;
          comment_count?: number;
        }>;
        paging?: { cursors?: { after?: string } };
      }>(`/${args.postId}/comments`, params),
    );

    // Sanitize user-generated content
    const comments = (response.data || []).map((c) => ({
      id: c.id,
      message: sanitize(c.message || ""),
      author: c.from
        ? { id: c.from.id, name: sanitize(c.from.name) }
        : undefined,
      createdTime: c.created_time,
      likeCount: c.like_count ?? 0,
      replyCount: c.comment_count ?? 0,
    }));

    return senseResult(
      {
        postId: args.postId,
        comments,
        count: comments.length,
        nextCursor: response.paging?.cursors?.after,
      },
      "Facebook",
    );
  }),
);

server.registerTool(
  "fb_get_page_feed",
  {
    description:
      "Get the Facebook Page's own feed (posts you've published). Returns post id, message, type, timestamp, shares, and permalink.",
    inputSchema: {
      ...credentialFields,
      limit: z
        .number()
        .optional()
        .describe("Number of posts to fetch (default: 25, max: 100)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
  },
  safeHandler("fb_get_page_feed", async (args) => {
    const result = await getClient(args, "fb_get_page_feed");
    if (!result.ok) return result.error;
    const { client } = result;

    const data = await fetchPageFeed(client, {
      limit: args.limit,
      after: args.after,
    });
    return senseResult(data, "Facebook");
  }),
);

// =====================
// ACT Tools (write)
// =====================

/**
 * Optionally post a top-level comment on a just-created Facebook post (#1995).
 * Returns { id } on success, { error } on failure, {} if no firstComment given.
 * Mirrors the LinkedIn first-comment contract: 3-5s random delay, 2000 char cap.
 */
export async function postFirstComment(
  client: FacebookClient,
  postId: string,
  firstComment: string | undefined,
): Promise<{ id?: string; error?: string }> {
  const trimmed = firstComment?.trim();
  if (!trimmed) return {};
  const commentText = trimmed.slice(0, 2000);
  try {
    const delayMs = 3000 + Math.random() * 2000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const commentResponse = await withRetry(() =>
      client.post<{ id: string }>(`/${postId}/comments`, {
        message: commentText,
      }),
    );
    return { id: commentResponse.id };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[fb_create_post] First comment failed: ${errMsg}`);
    return { error: errMsg };
  }
}

server.registerTool(
  "fb_create_post",
  {
    description:
      "Create a Facebook Page post. Supports text, link, photo, or video. Photos and videos must have publicly accessible HTTPS URLs. Returns the new post ID. Unlike Instagram, publishing is synchronous — no container flow.",
    inputSchema: {
      ...credentialFields,
      message: z
        .string()
        .optional()
        .describe(
          "Post text. Required for text-only posts, optional for photo/video/link.",
        ),
      link: z
        .string()
        .optional()
        .describe(
          "URL to share as a link preview. Mutually exclusive with imageUrl/videoUrl.",
        ),
      imageUrl: z
        .string()
        .optional()
        .describe(
          "Publicly accessible image URL for a photo post. Mutually exclusive with link/videoUrl.",
        ),
      videoUrl: z
        .string()
        .optional()
        .describe(
          "Publicly accessible video URL for a video post. Mutually exclusive with link/imageUrl.",
        ),
      published: z
        .boolean()
        .optional()
        .describe(
          "Whether to publish immediately (default: true). Set false to create an unpublished draft.",
        ),
      firstComment: z
        .string()
        .optional()
        .describe(
          "Optional follow-up comment posted ~a few seconds after the post for engagement (max 2000 chars). " +
            "Facebook suppresses link-in-body reach so first-comment is the canonical place for a link/CTA. " +
            "The comment is posted by the authenticated Page. Omit or leave blank to skip.",
        ),
    },
  },
  safeHandler("fb_create_post", async (args) => {
    const validation = buildCreatePostRequest(args);
    if (!validation.ok) {
      return errorResult(validation.error, validation.message, {
        ...(validation.action && { action: validation.action }),
      });
    }

    const result = await getClient(args, "fb_create_post");
    if (!result.ok) return result.error;
    const { client } = result;

    const endpoint = validation.endpoint(client.pageId);
    const response = await withRetry(() =>
      client.post<{ id: string; post_id?: string }>(endpoint, validation.body),
    );

    // Photos/videos return { id, post_id } where post_id is the feed-level id
    const postId = response.post_id || response.id;

    // First comment (if provided). Partial-success: post is already live, so a
    // comment failure must surface explicitly — never a clean success (#1931).
    const fc = await postFirstComment(client, postId, args.firstComment);
    if (fc.error) {
      return errorResult(
        "Partial failure",
        `Post created (${postId}) but first comment failed: ${fc.error}. Use fb_reply_comment to retry.`,
        { id: postId, mediaId: response.id, type: validation.type },
      );
    }

    return textResult({
      id: postId,
      mediaId: response.id,
      type: validation.type,
      ...(fc.id && { firstCommentId: fc.id }),
      message: fc.id
        ? "Post created with first comment"
        : "Post created successfully",
    });
  }),
);

server.registerTool(
  "fb_reply_comment",
  {
    description: "Reply to a comment on a Facebook post.",
    inputSchema: {
      ...credentialFields,
      commentId: z.string().describe("ID of the comment to reply to"),
      message: z.string().describe("Reply text"),
    },
  },
  safeHandler("fb_reply_comment", async (args) => {
    if (!args.commentId.trim())
      return errorResult("Invalid input", "commentId cannot be empty");
    if (!args.message.trim())
      return errorResult("Invalid input", "message cannot be empty");

    const result = await getClient(args, "fb_reply_comment");
    if (!result.ok) return result.error;
    const { client } = result;

    const response = await withRetry(() =>
      client.post<{ id: string }>(`/${args.commentId}/comments`, {
        message: args.message,
      }),
    );

    return textResult({
      id: response.id,
      parentCommentId: args.commentId,
      message: "Reply posted successfully",
    });
  }),
);

server.registerTool(
  "fb_delete_post",
  {
    description:
      "Delete a Facebook Page post you published. The post ID must belong to the authenticated Page.",
    inputSchema: {
      ...credentialFields,
      postId: z.string().describe("ID of the post to delete"),
    },
  },
  safeHandler("fb_delete_post", async (args) => {
    if (!args.postId.trim())
      return errorResult("Invalid input", "postId cannot be empty");

    const result = await getClient(args, "fb_delete_post");
    if (!result.ok) return result.error;
    const { client } = result;

    await withRetry(() => client.delete(`/${args.postId}`));

    return textResult({
      postId: args.postId,
      message: "Post deleted successfully",
    });
  }),
);

// --- Start ---

export { server };

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Facebook MCP Server running on stdio");
}

// Only start the stdio transport when invoked directly, not when imported
// by test files. Compares import.meta.url to the script entrypoint.
const isDirectRun =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
