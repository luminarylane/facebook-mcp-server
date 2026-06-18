/**
 * Regression tests for the #1995 first-comment partial-success contract (#1931).
 *
 * Facebook is the highest-value first-comment platform (FB suppresses
 * link-in-body reach, so the link belongs in the first comment). If the post
 * publishes but the comment fails, fb_create_post must report a partial failure
 * carrying the live post id — never a clean success. postFirstComment is the
 * isolated step the handler delegates to.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { postFirstComment } from "./index.js";
import type { FacebookClient } from "./client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe("postFirstComment — partial-success contract", () => {
  it("returns the comment id when the comment posts", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValue({ id: "comment-1" });
    const client = { post } as unknown as FacebookClient;

    const result = await runWithTimers(
      postFirstComment(client, "post-1", "Link in the comments 👇"),
    );

    expect(result).toEqual({ id: "comment-1" });
    expect(post).toHaveBeenCalledWith("/post-1/comments", {
      message: "Link in the comments 👇",
    });
  });

  it("returns { error } (NOT a clean success) when the comment client throws", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockRejectedValue(new Error("graph boom"));
    const client = { post } as unknown as FacebookClient;

    const result = await runWithTimers(
      postFirstComment(client, "post-1", "hi"),
    );

    expect(result.error).toContain("graph boom");
    expect(result.id).toBeUndefined();
  });

  it("is a no-op (no API call) when firstComment is blank", async () => {
    const post = vi.fn();
    const client = { post } as unknown as FacebookClient;

    expect(await postFirstComment(client, "post-1", "  ")).toEqual({});
    expect(await postFirstComment(client, "post-1", undefined)).toEqual({});
    expect(post).not.toHaveBeenCalled();
  });

  it("caps the comment at Facebook's 2000-char limit", async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValue({ id: "c" });
    const client = { post } as unknown as FacebookClient;

    await runWithTimers(postFirstComment(client, "p", "y".repeat(4000)));

    const sent = post.mock.calls[0][1] as { message: string };
    expect(sent.message).toHaveLength(2000);
  });
});
