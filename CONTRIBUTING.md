# Contributing to Facebook MCP Server

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites
- Node.js 18+
- Git

### Installation
```bash
git clone https://github.com/luminarylane/facebook-mcp-server.git
cd facebook-mcp-server
npm install
```

### Environment Setup
```bash
cp .env.example .env
# Add your Facebook Page credentials to .env
```

## Development Workflow

### 1. Create a Branch
```bash
git checkout -b feature/your-description
```

### 2. Make Changes
Follow the existing code style and conventions.

### 3. Test
```bash
npm test
```

### 4. Build
```bash
npm run build
```

### 5. Push and Create PR
```bash
git push origin your-branch-name
gh pr create --title "Description" --body "Details..."
```

## Code Style

- TypeScript strict mode
- Prettier for formatting
- Vitest for testing
- No external SDK dependencies — raw `fetch` against the Graph API

## Testing

```bash
# Run all tests
npm test

# Type check
npx tsc --noEmit
```

### Writing Tests
- Place tests alongside source files as `*.test.ts`
- Use `vi.stubGlobal("fetch", ...)` to stub network calls
- Every tool handler should have happy-path and error-path coverage

## Project Structure

```
facebook-mcp-server/
├── src/
│   ├── index.ts          # MCP server + tool registration
│   ├── client.ts         # Graph API HTTP client
│   ├── create-post.ts    # Post creation validation
│   ├── errors.ts         # Error mapping + agent action hints
│   ├── rate-limiter.ts   # Token-bucket rate limiter
│   ├── response.ts       # MCP response helpers
│   ├── sanitize.ts       # Prompt injection protection
│   ├── lib/
│   │   ├── index.ts      # Public API surface
│   │   └── insights.ts   # SENSE/insights functions
│   └── *.test.ts         # Tests alongside source
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Pull Request Process

1. Ensure tests pass: `npm test`
2. Ensure types check: `npx tsc --noEmit`
3. Write a clear PR description
4. Link to related issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
