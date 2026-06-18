import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TokenBucket,
  checkRateLimit,
  PUBLISH_TOOL_NAMES,
  withRetry,
  __resetRateLimiter,
} from "./rate-limiter.js";

// Every test starts with an empty tenant bucket map so state from prior
// tests (especially the "exhaust the bucket" ones) doesn't leak.
beforeEach(() => {
  __resetRateLimiter();
});

describe("TokenBucket", () => {
  it("allows consumption when tokens are available", () => {
    const bucket = new TokenBucket({ maxTokens: 10, refillRate: 0.01 });
    expect(bucket.tryConsume(1)).toBe(true);
  });

  it("rejects consumption when empty", () => {
    const bucket = new TokenBucket({ maxTokens: 2, refillRate: 0.0001 });
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
  });

  it("reports 0 wait when tokens available", () => {
    const bucket = new TokenBucket({ maxTokens: 10, refillRate: 0.01 });
    expect(bucket.msUntilAvailable(1)).toBe(0);
  });

  it("reports positive wait when empty", () => {
    const bucket = new TokenBucket({ maxTokens: 1, refillRate: 0.001 });
    bucket.tryConsume(1);
    expect(bucket.msUntilAvailable(1)).toBeGreaterThan(0);
  });

  it("handles multi-token costs", () => {
    const bucket = new TokenBucket({ maxTokens: 5, refillRate: 0.01 });
    expect(bucket.tryConsume(3)).toBe(true);
    expect(bucket.tryConsume(3)).toBe(false);
    expect(bucket.tryConsume(2)).toBe(true);
  });
});

describe("checkRateLimit", () => {
  it("allows reads under the limit", () => {
    const result = checkRateLimit("fb_get_comments");
    expect(result.allowed).toBe(true);
  });

  it("allows publish under the limit", () => {
    const result = checkRateLimit("fb_create_post");
    expect(result.allowed).toBe(true);
  });
});

describe("PUBLISH_TOOL_NAMES", () => {
  it("contains fb_create_post", () => {
    expect(PUBLISH_TOOL_NAMES.has("fb_create_post")).toBe(true);
  });

  it("does not contain SENSE tools", () => {
    expect(PUBLISH_TOOL_NAMES.has("fb_get_comments")).toBe(false);
    expect(PUBLISH_TOOL_NAMES.has("fb_get_page_insights")).toBe(false);
    expect(PUBLISH_TOOL_NAMES.has("fb_get_page_feed")).toBe(false);
    expect(PUBLISH_TOOL_NAMES.has("fb_get_post_insights")).toBe(false);
  });

  it("does not contain non-publish ACT tools", () => {
    expect(PUBLISH_TOOL_NAMES.has("fb_reply_comment")).toBe(false);
    expect(PUBLISH_TOOL_NAMES.has("fb_delete_post")).toBe(false);
  });
});

describe("checkRateLimit — per-tenant isolation", () => {
  it("two different tenants have independent buckets", () => {
    // Consume 10 tokens from tenant A
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit("fb_get_page_feed", "page_A");
      expect(r.allowed).toBe(true);
    }
    // Tenant B should still have a full bucket — unaffected by A
    const rB = checkRateLimit("fb_get_page_feed", "page_B");
    expect(rB.allowed).toBe(true);
  });

  it("exhausting one tenant's publish bucket doesn't affect another", () => {
    // fb_create_post has 25 tokens/day; burn all of them on tenant A
    for (let i = 0; i < 25; i++) {
      const r = checkRateLimit("fb_create_post", "tenant_exhaust");
      expect(r.allowed).toBe(true);
    }
    // 26th call from tenant A should be blocked
    const over = checkRateLimit("fb_create_post", "tenant_exhaust");
    expect(over.allowed).toBe(false);

    // But a fresh tenant should still be allowed
    const fresh = checkRateLimit("fb_create_post", "tenant_fresh");
    expect(fresh.allowed).toBe(true);
  });

  it("same tenantKey shares the same bucket across calls", () => {
    for (let i = 0; i < 25; i++) {
      checkRateLimit("fb_create_post", "same_key");
    }
    // 26th call on the same key must be blocked
    const r = checkRateLimit("fb_create_post", "same_key");
    expect(r.allowed).toBe(false);
  });

  it("undefined tenantKey uses the shared default bucket", () => {
    // Consuming with no tenantKey and with the same tenantKey omitted
    // should hit the same bucket
    for (let i = 0; i < 25; i++) {
      checkRateLimit("fb_create_post");
    }
    const r = checkRateLimit("fb_create_post");
    expect(r.allowed).toBe(false);

    // Meanwhile a named tenant should still have its own full bucket
    const named = checkRateLimit("fb_create_post", "still_fresh");
    expect(named.allowed).toBe(true);
  });

  it("reads from one tenant do not drain another tenant's global bucket", () => {
    // Burn 100 read calls on tenant A (half the global bucket)
    for (let i = 0; i < 100; i++) {
      checkRateLimit("fb_get_comments", "reader_A");
    }
    // Tenant B should still have its full 200-token bucket
    // (we can't directly inspect the bucket but we can verify 150 consecutive
    // calls succeed, which would fail if B shared A's depleted bucket)
    let allowedCount = 0;
    for (let i = 0; i < 150; i++) {
      const r = checkRateLimit("fb_get_comments", "reader_B");
      if (r.allowed) allowedCount++;
    }
    expect(allowedCount).toBe(150);
  });
});

describe("withRetry", () => {
  it("succeeds on first try without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws non-429 errors immediately", async () => {
    const err = new Error("not found");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toThrow("not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 status errors", { timeout: 10_000 }, async () => {
    const rate429 = Object.assign(new Error("rate limit"), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(rate429).mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on Graph API code 4 errors", { timeout: 10_000 }, async () => {
    const graphErr = Object.assign(new Error("too many calls"), { code: 4 });
    const fn = vi.fn().mockRejectedValueOnce(graphErr).mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it(
    "gives up after max retries on persistent 429s",
    { timeout: 30_000 },
    async () => {
      const rate429 = Object.assign(new Error("rate limit"), { status: 429 });
      const fn = vi.fn().mockRejectedValue(rate429);
      await expect(withRetry(fn)).rejects.toThrow("rate limit");
      expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
    },
  );
});
