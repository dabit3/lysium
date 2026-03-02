# Lysium

An elegant and cross-platform control plane for agent-first software delivery.

## Features

- Run multiple agent sessions in parallel across repositories
- Launch agent-based requests from existing issues and PRs
- Mobile and desktop triage views optimized for fast issue and PR decisioning
- Swipe actions for close, merge, create PR, and skip-to-tail workflows
- Agent-powered Assess flows for issue necessity and PR merge decisions
- Automated PR review
- Activity panel showing all agent sessions and actions
- GitHub OAuth sync with scope controls (`user:`, `org:`, `repo:`)

![Lysium](banner.png)

---

## How credentials work

Lysium does not store Devin credentials in browser storage. Users enter their Devin API key, org ID, and GitHub scope in the app UI. Credentials are validated and stored server-side in signed `HttpOnly` cookies, and Devin API calls are proxied through the server.

---

## Requirements

- Node.js 18+
- A GitHub OAuth App
- A Devin API key (`cog_...`) and organization ID

---

## Running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Create your env file

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Description |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `http://localhost:8787/api/github/oauth/callback` |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | `http://localhost:5173/` |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | `http://localhost:5173` |
| `GITHUB_OAUTH_COOKIE_SECRET` | Any random string (`openssl rand -hex 32`) |

### 3. Create a GitHub OAuth App

1. Go to **GitHub Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set the callback URL to `http://localhost:8787/api/github/oauth/callback`
3. Copy the client ID and secret into `.env.local`

### 4. Start the app

```bash
npm run dev:all
```

This starts both the local API server (port 8787) and Vite (port 5173). Open `http://localhost:5173`, sign in with GitHub, then connect Devin from the startup auth panel (or Settings).

---

## GitHub scope behavior

- On first GitHub OAuth sign-in, scope defaults to `user:<your-login>`.
- You can set scope to `user:<username>`, `org:<org>`, or `repo:<owner/repo>`.
- If you enter a value without a prefix (for example `acme`), Lysium treats it as `org:acme`.
- OAuth is requested with `repo` scope, so private repositories in your selected scope can be included.

---

## Deploying to Vercel

### 1. Push to GitHub and import the repo in Vercel

Go to [vercel.com](https://vercel.com), create a new project, and import your repository.

### 2. Set environment variables in the Vercel dashboard

Go to your project → **Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `https://your-app.vercel.app/api/github/oauth/callback` |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | `https://your-app.vercel.app/` |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | `https://your-app.vercel.app` |
| `GITHUB_OAUTH_COOKIE_SECURE` | `true` |
| `GITHUB_OAUTH_COOKIE_SECRET` | Random 32+ char string (`openssl rand -hex 32`) |

### 3. Update your GitHub OAuth App

Set the callback URL in your GitHub OAuth App to:

```
https://your-app.vercel.app/api/github/oauth/callback
```

### 4. Deploy

Vercel deploys automatically on pushes to your main branch. Users connect GitHub and enter Devin credentials in the app UI after deploy.

---

## How it works

- Connect GitHub via OAuth to sync open issues and pull requests from your configured scope
- Swipe right on an issue to have Devin open a pull request
- Swipe left on an issue to close it on GitHub
- Swipe right on a pull request to merge it (or enroll auto-merge if checks are pending)
- Swipe left on a pull request to close it without merging
- Swipe down on issues or PRs to skip and move them to the tail
- Use **Assess** to have Devin evaluate issue necessity or PR merge decisions
- Use **Review** to open Devin review sessions for PRs when available
- Use the **Code** tab to start a Devin implementation request (including “Devin’s machine” mode)
- Use **Leave Comment** to post manual PR comments (with optional Devin mention tagging)
- Track everything in Activity, split into **Sessions** and **Actions**
