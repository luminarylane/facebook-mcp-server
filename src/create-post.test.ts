/**
 * Unit tests for buildCreatePostRequest — the pure validation + routing
 * helper backing fb_create_post.
 *
 * Each test is a regression guard for a specific branch of the tool's
 * pre-flight logic. This closes the coverage gap identified in the Facebook
 * MCP test audit: the 4 most FB-specific code paths (attachment routing,
 * mutual-exclusion, caption length, empty-input) were previously only
 * covered by live manual testing.
 */

import { describe, it, expect } from "vitest";
import {
  buildCreatePostRequest,
  FB_MESSAGE_MAX_LENGTH,
} from "./create-post.js";

describe("buildCreatePostRequest — validation", () => {
  it("rejects empty input (no message, no attachment)", () => {
    const r = buildCreatePostRequest({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Invalid input");
      expect(r.message).toMatch(
        /at least a message, link, imageUrl, or videoUrl/,
      );
    }
  });

  it("rejects when two attachment types are provided (link + imageUrl)", () => {
    const r = buildCreatePostRequest({
      message: "x",
      link: "https://a.com",
      imageUrl: "https://example.com/x.jpg",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/Exactly one of link, imageUrl, or videoUrl/);
      expect(r.action).toMatch(/^FIX_INPUT:/);
    }
  });

  it("rejects when all three attachment types are provided", () => {
    const r = buildCreatePostRequest({
      link: "https://a.com",
      imageUrl: "https://example.com/x.jpg",
      videoUrl: "https://example.com/x.mp4",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.action).toMatch(/^FIX_INPUT:/);
    }
  });

  it("rejects message longer than Facebook's 63206 char limit", () => {
    const r = buildCreatePostRequest({ message: "x".repeat(63207) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/63207 chars, Facebook max is 63206/);
      expect(r.action).toMatch(/^CAPTION_TOO_LONG:/);
    }
  });

  it("accepts exactly 63206 chars (boundary condition)", () => {
    const r = buildCreatePostRequest({
      message: "x".repeat(FB_MESSAGE_MAX_LENGTH),
    });
    expect(r.ok).toBe(true);
  });
});

describe("buildCreatePostRequest — routing", () => {
  it("routes text-only post to /{pageId}/feed with message", () => {
    const r = buildCreatePostRequest({ message: "hello world" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe("text");
      expect(r.endpoint("548545275018321")).toBe("/548545275018321/feed");
      expect(r.body).toEqual({ message: "hello world" });
    }
  });

  it("routes link post to /feed with link field", () => {
    const r = buildCreatePostRequest({
      message: "check this out",
      link: "https://www.luminarylane.app",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe("link");
      expect(r.endpoint("548545275018321")).toBe("/548545275018321/feed");
      expect(r.body).toEqual({
        message: "check this out",
        link: "https://www.luminarylane.app",
      });
    }
  });

  it("routes link post WITHOUT message to /feed (message optional for link)", () => {
    const r = buildCreatePostRequest({ link: "https://www.luminarylane.app" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe("link");
      expect(r.body).toEqual({ link: "https://www.luminarylane.app" });
      expect(r.body.message).toBeUndefined();
    }
  });

  it("routes photo post to /{pageId}/photos with url (not link)", () => {
    const r = buildCreatePostRequest({
      message: "a cat",
      imageUrl: "https://example.com/cat.jpg",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe("photo");
      expect(r.endpoint("548545275018321")).toBe("/548545275018321/photos");
      expect(r.body).toEqual({
        message: "a cat",
        url: "https://example.com/cat.jpg",
      });
      // Ensure we did NOT accidentally set the `link` field
      expect(r.body.link).toBeUndefined();
    }
  });

  it("routes photo post without caption", () => {
    const r = buildCreatePostRequest({
      imageUrl: "https://example.com/cat.jpg",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe("photo");
      expect(r.body.message).toBeUndefined();
      expect(r.body.url).toBe("https://example.com/cat.jpg");
    }
  });

  it("routes video post to /{pageId}/videos with file_url", () => {
    const r = buildCreatePostRequest({
      message: "watch",
      videoUrl: "https://example.com/clip.mp4",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe("video");
      expect(r.endpoint("548545275018321")).toBe("/548545275018321/videos");
      expect(r.body).toEqual({
        message: "watch",
        file_url: "https://example.com/clip.mp4",
      });
    }
  });

  it("passes published=false through to body when provided", () => {
    const r = buildCreatePostRequest({
      message: "draft",
      published: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.published).toBe(false);
    }
  });

  it("does NOT set published when undefined (defaults to FB's true)", () => {
    const r = buildCreatePostRequest({ message: "live" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.published).toBeUndefined();
      expect("published" in r.body).toBe(false);
    }
  });

  it("does NOT set published when explicitly true (let FB default stand)", () => {
    const r = buildCreatePostRequest({
      message: "live",
      published: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.published).toBeUndefined();
    }
  });
});

describe("buildCreatePostRequest — endpoint is a pure function of pageId", () => {
  it("endpoint builder returns different paths for different page ids", () => {
    const r = buildCreatePostRequest({ message: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.endpoint("111")).toBe("/111/feed");
      expect(r.endpoint("222")).toBe("/222/feed");
    }
  });
});
