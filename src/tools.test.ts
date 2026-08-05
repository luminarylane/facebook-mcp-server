/**
 * Integration tests for tool-handler helpers.
 *
 * Tests the building blocks every tool uses:
 *   - safeHandler        — wraps every tool, formats errors
 *   - resolveCredentials — env-vs-args precedence
 *
 * Full per-tool happy/error path tests would require spinning up the whole
 * McpServer and sending JSON-RPC messages; instead we unit-test the shared
 * helpers each tool depends on, which covers the surface area that actually
 * breaks during Graph API changes.
 *
 * Note: Facebook publishes are synchronous (no container flow), so there is
 * no pollContainerStatus helper to test — that's an Instagram-only concern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { safeHandler, resolveCredentials } from "./index.js";
import { FacebookApiError } from "./client.js";

// Silence the console.error logging from safeHandler during tests
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveCredentials", () => {
  // resolveCredentials reads DEFAULT_* constants captured at import time.
  // We can't mutate them mid-test, but we can verify args-vs-env precedence
  // by controlling args. The env-only path is covered by the "args missing"
  // case returning whatever env happens to contain at import time.

  it("returns null when both args and env are missing", () => {
    // If env is set at import, this test is a no-op, so guard with a stub
    if (
      !process.env.FACEBOOK_ACCESS_TOKEN ||
      !process.env.FACEBOOK_PAGE_ID
    ) {
      expect(resolveCredentials({})).toBeNull();
    }
  });

  it("returns provided args when both are supplied", () => {
    const r = resolveCredentials({
      accessToken: "tok_from_args",
      pageId: "page_from_args",
    });
    expect(r).toEqual({
      accessToken: "tok_from_args",
      pageId: "page_from_args",
    });
  });

  it("args-provided values take precedence over env defaults", () => {
    // Even if env vars are set (from .env or shell), explicit args win
    const r = resolveCredentials({
      accessToken: "override_token",
      pageId: "override_account",
    });
    expect(r?.accessToken).toBe("override_token");
    expect(r?.pageId).toBe("override_account");
  });

  it("partial args fall through to env (or null if env missing)", () => {
    // Only pageId supplied, accessToken must come from env
    const r = resolveCredentials({ pageId: "page_only" });
    if (process.env.FACEBOOK_ACCESS_TOKEN) {
      expect(r?.pageId).toBe("page_only");
      expect(r?.accessToken).toBe(process.env.FACEBOOK_ACCESS_TOKEN);
    } else {
      expect(r).toBeNull();
    }
  });
});

describe("safeHandler", () => {
  it("passes through successful handler results", async () => {
    const handler = safeHandler("test_tool", async () => ({
      content: [{ type: "text" as const, text: "success" }],
    }));

    const result = await handler({});
    expect(result).toEqual({
      content: [{ type: "text", text: "success" }],
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
  });

  it("catches thrown Error and returns errorResult", async () => {
    const handler = safeHandler("test_tool", async () => {
      throw new Error("something broke");
    });

    const result = (await handler({})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);

    const body = JSON.parse(result.content[0].text);
    expect(body.error).toBe("API error");
    expect(body.message).toContain("test_tool failed");
    expect(body.message).toContain("something broke");
  });

  it("catches FacebookApiError with auth-failure detail and sets action=AUTH_FAILED", async () => {
    const handler = safeHandler("fb_get_page_insights", async () => {
      throw new FacebookApiError(400, {
        message: "Invalid OAuth access token - Cannot parse access token",
        type: "OAuthException",
        code: 190,
      });
    });

    const result = (await handler({})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    const body = JSON.parse(result.content[0].text);
    expect(body.statusCode).toBe(400);
    expect(body.action).toMatch(/^AUTH_FAILED:/);
  });

  it("catches metric-error (Bug #6 regression): does NOT set AUTH_FAILED", async () => {
    const handler = safeHandler("fb_get_page_insights", async () => {
      throw new FacebookApiError(400, {
        message:
          "(#100) metric[2] must be one of the following values: reach, follower_count",
        type: "OAuthException",
        code: 100,
      });
    });

    const result = (await handler({})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    const body = JSON.parse(result.content[0].text);
    expect(body.action).not.toMatch(/^AUTH_FAILED:/);
    expect(body.action).toMatch(/^INVALID_REQUEST:/);
  });

  it("catches media-type error (Bug #9 regression): maps subcode 2207052 to INVALID_MEDIA", async () => {
    const handler = safeHandler("fb_create_post", async () => {
      throw new FacebookApiError(400, {
        message: "Only photo or video can be accepted as media type.",
        type: "OAuthException",
        code: 100,
        error_subcode: 2207052,
      });
    });

    const result = (await handler({})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    const body = JSON.parse(result.content[0].text);
    expect(body.action).toMatch(/^INVALID_MEDIA:/);
  });

  it("catches non-Error throws (string) gracefully", async () => {
    const handler = safeHandler("test_tool", async () => {
      throw "string error";
    });

    const result = (await handler({})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.message).toContain("string error");
  });
});

describe("safeHandler — rate-limit error (429 long wait)", () => {
  it("maps 429 to RATE_LIMITED action string", async () => {
    const handler = safeHandler("fb_get_page_insights", async () => {
      throw new FacebookApiError(
        429,
        { message: "too fast", type: "OAuthException", code: 4 },
        300,
      );
    });

    const result = (await handler({})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    const body = JSON.parse(result.content[0].text);
    expect(body.statusCode).toBe(429);
    expect(body.action).toMatch(/^RATE_LIMITED:/);
  });
});
