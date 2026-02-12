# Comments Worker (Cloudflare + R2)

This Worker provides a small comments API backed by Cloudflare R2.

## Endpoints

- `GET /health`
- `POST /users` → `{ username, token }` (creates `thesis/{username}/data.json` if missing)
- `GET /users/:username` → `{ username, exists }`
- `GET /threads/:threadId/comments`
- `POST /threads/:threadId/comments` (auth)
- `DELETE /threads/:threadId/comments/:commentId` (auth)

## R2 layout

- User data is stored at: `thesis/{username}/data.json`

## Setup

1. Install deps in repo root:

   - `npm i -D wrangler`

2. Create an R2 bucket named `mg-thesis` (or change `wrangler.toml`).

3. Set the secret used to sign tokens:

   - `npx wrangler secret put AUTH_SECRET`

4. Configure CORS allowlist in `wrangler.toml` (no secrets), e.g.:

   - `CORS_ORIGINS = "http://localhost:5173,https://osanv.github.io"`

## Run locally

- `npx wrangler dev`

## Deploy

- `npx wrangler deploy`
