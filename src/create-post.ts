/**
 * Pure helpers for fb_create_post — validation + request shaping.
 *
 * Extracted from index.ts so the attachment-routing logic can be unit-tested
 * without spinning up the MCP server or mocking HTTP. Every branch here has
 * a test in create-post.test.ts.
 */

export interface CreatePostArgs {
  message?: string;
  link?: string;
  imageUrl?: string;
  videoUrl?: string;
  published?: boolean;
}

export interface CreatePostValidationError {
  ok: false;
  error: string;
  message: string;
  action?: string;
}

export interface CreatePostRequest {
  ok: true;
  endpoint: (pageId: string) => string;
  body: Record<string, unknown>;
  type: "text" | "link" | "photo" | "video";
}

export type CreatePostResult = CreatePostValidationError | CreatePostRequest;

// Facebook Page post hard cap per Meta docs.
export const FB_MESSAGE_MAX_LENGTH = 63206;

/**
 * Validate fb_create_post arguments and return either a structured error
 * or the request recipe (endpoint + body + content type) the tool should
 * send to the Graph API.
 *
 * This function is pure — it has no side effects, does no IO, and does not
 * depend on env vars or a client instance. The caller is responsible for
 * substituting the real page id into `endpoint(pageId)` and actually
 * dispatching the request.
 */
export function buildCreatePostRequest(args: CreatePostArgs): CreatePostResult {
  const hasLink = !!args.link;
  const hasImage = !!args.imageUrl;
  const hasVideo = !!args.videoUrl;
  const attachmentCount = [hasLink, hasImage, hasVideo].filter(Boolean).length;

  // Rule 1: at most one attachment type
  if (attachmentCount > 1) {
    return {
      ok: false,
      error: "Invalid input",
      message:
        "Exactly one of link, imageUrl, or videoUrl may be provided (or none for text-only).",
      action:
        "FIX_INPUT: Pick a single attachment type per post. For multi-photo posts, fall back to calling fb_create_post once per photo.",
    };
  }

  // Rule 2: must have SOMETHING
  if (!args.message && attachmentCount === 0) {
    return {
      ok: false,
      error: "Invalid input",
      message:
        "A post must have at least a message, link, imageUrl, or videoUrl.",
    };
  }

  // Rule 3: message length
  if (args.message && args.message.length > FB_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: "Invalid input",
      message: `Message is ${args.message.length} chars, Facebook max is ${FB_MESSAGE_MAX_LENGTH}.`,
      action: "CAPTION_TOO_LONG: Shorten the message and retry.",
    };
  }

  // Build the request body
  const body: Record<string, unknown> = {};
  if (args.message) body.message = args.message;
  if (args.published === false) body.published = false;

  // Route to the correct endpoint based on attachment type
  if (hasImage) {
    body.url = args.imageUrl;
    return {
      ok: true,
      endpoint: (pageId: string) => `/${pageId}/photos`,
      body,
      type: "photo",
    };
  }

  if (hasVideo) {
    body.file_url = args.videoUrl;
    return {
      ok: true,
      endpoint: (pageId: string) => `/${pageId}/videos`,
      body,
      type: "video",
    };
  }

  // Text-only OR link attachment — both go through /feed
  if (hasLink) body.link = args.link;
  return {
    ok: true,
    endpoint: (pageId: string) => `/${pageId}/feed`,
    body,
    type: hasLink ? "link" : "text",
  };
}
