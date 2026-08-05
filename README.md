# Facebook Pages MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the Facebook Graph API (Pages). Enables Claude Desktop and other MCP clients to read insights, create posts, manage comments, and more — all through the Facebook Pages API.

## Features

### SENSE Tools (Read)

| Tool                   | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `fb_get_page_insights` | Page-level metrics: impressions, reach, engagements, follower count |
| `fb_get_post_insights` | Post-level metrics: impressions, clicks, reactions                  |
| `fb_get_comments`      | Comments on a post with author info, likes, replies                 |
| `fb_get_page_feed`     | Your published posts with permalinks, shares, timestamps            |

### ACT Tools (Write)

| Tool               | Description                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| `fb_create_post`   | Create text, link, photo, or video posts. Supports first-comment for CTAs |
| `fb_reply_comment` | Reply to a comment on a post                                              |
| `fb_delete_post`   | Delete a post you published                                               |

## Quick Start

### Prerequisites

- Node.js 22.14+
- A Facebook Page Access Token ([how to get one](https://developers.facebook.com/docs/pages/access-tokens))
- Your Facebook Page ID

### Install

Published package: [@luminarylane/facebook-mcp-server on npm](https://www.npmjs.com/package/@luminarylane/facebook-mcp-server)

Run without a global install:

```bash
FACEBOOK_ACCESS_TOKEN=your-token FACEBOOK_PAGE_ID=your-page-id npx --yes @luminarylane/facebook-mcp-server
```

To run from source:

```bash
git clone https://github.com/luminarylane/facebook-mcp-server.git
cd facebook-mcp-server
npm install
npm run build
```

### Configure

```bash
cp .env.example .env
# Edit .env with your credentials:
#   FACEBOOK_ACCESS_TOKEN=your_long_lived_facebook_page_token_here
#   FACEBOOK_PAGE_ID=your_facebook_page_id_here
```

### Run

```bash
# Development
npm run dev

# Production
npm start
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "facebook": {
      "command": "npx",
      "args": ["--yes", "@luminarylane/facebook-mcp-server"],
      "env": {
        "FACEBOOK_ACCESS_TOKEN": "your_token_here",
        "FACEBOOK_PAGE_ID": "your_page_id_here"
      }
    }
  }
}
```

## Architecture

- **Transport**: stdio (standard MCP protocol)
- **API**: Facebook Graph API v21.0
- **Rate Limiting**: Built-in token-bucket rate limiter (200 calls/hour global, 25 publishes/day) with per-tenant isolation
- **Retry**: Automatic exponential backoff on 429s (up to 3 retries)
- **Security**: Input sanitization against prompt injection (zero-width chars, whitespace abuse, context flooding)
- **Error Handling**: Structured errors with actionable `action` hints for agents

## Development

```bash
# Run tests
npm test

# Development server (auto-reload)
npm run dev

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Testing

The test suite covers:

- **client.test.ts** — Graph API HTTP client, URL construction, error parsing
- **create-post.test.ts** — Post creation validation and endpoint routing
- **errors.test.ts** — Error mapping and agent-action hint strings
- **first-comment.test.ts** — First-comment partial-success contract
- **handlers.test.ts** — Full tool handler integration tests
- **rate-limiter.test.ts** — Token bucket, per-tenant isolation, retry logic
- **response.test.ts** — MCP response formatting
- **sanitize.test.ts** — Prompt injection protection
- **tools.test.ts** — safeHandler and credential resolution

```bash
npm test
```

## License

[MIT](LICENSE)
