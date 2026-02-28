# Elysium

A mobile-first GitHub triage tool. Swipe through issues and pull requests, close or merge them directly, and delegate implementation work to [Devin](https://devin.ai). Built with React, TypeScript, and Vite.

---

## Requirements

- Node.js 18+
- A [Devin](https://app.devin.ai) service user API key (`cog_...`)
- A GitHub OAuth App (for GitHub feed sync)

---

## Setup

```bash
cp .env.example .env
```

Fill in `.env` with your values.

### Environment variables

**Frontend (required)**

| Variable | Description |
|---|---|
| `VITE_DEVIN_API_KEY` | Devin service user API key |
| `VITE_DEVIN_ORG_ID` | Devin organization ID |
| `VITE_GITHUB_SCOPE` | GitHub search scope, e.g. `org:your-org` |
| `VITE_GITHUB_OAUTH_START_URL` | OAuth start endpoint, e.g. `/api/github/oauth/start` |
| `VITE_GITHUB_OAUTH_TOKEN_URL` | OAuth token endpoint, e.g. `/api/github/oauth/token` |
| `VITE_GITHUB_OAUTH_DISCONNECT_URL` | OAuth disconnect endpoint (optional) |

**Backend OAuth server (required for GitHub sync)**

| Variable | Description |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | Callback URL registered in your GitHub OAuth App |
| `GITHUB_OAUTH_SERVER_PORT` | Port for the local OAuth server (default: `8787`) |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | Where to redirect after login (default: `http://localhost:5173/`) |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | CORS origin for the frontend (default: `http://localhost:5173`) |
| `GITHUB_OAUTH_SCOPES` | GitHub OAuth scopes (default: `repo`) |
| `GITHUB_OAUTH_COOKIE_SECURE` | Set to `true` in production (default: `false`) |

### GitHub OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps > New OAuth App
2. Set the callback URL to `http://localhost:8787/api/github/oauth/callback` for local development
3. Copy the client ID and secret into `.env`

---

## Running locally

Start the OAuth backend and the frontend in separate terminals:

```bash
npm run oauth:server
```

```bash
npm run dev
```

The app runs at `http://localhost:5173`.

---

## Build

```bash
npm run build
```

Output goes to `dist/`.

---

## How it works

- Connect GitHub via OAuth to sync issues and pull requests from your organization
- Swipe right on an issue to have Devin open a pull request
- Swipe left on an issue to close it on GitHub
- Swipe right on a pull request to merge it (or enroll auto-merge if checks are pending)
- Swipe left on a pull request to close it without merging
- Use the Assess button to have Devin analyze an issue or PR and return a recommendation
- Use the Code tab to submit a feature request to Devin for any repository in your feed
- All Devin sessions and GitHub actions are tracked in the Activity drawer
