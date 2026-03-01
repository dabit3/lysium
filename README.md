# Elysium

A mobile-first GitHub triage tool. Swipe through issues and pull requests, close or merge them directly, and delegate implementation work to [Devin](https://devin.ai). Built with React, TypeScript, and Vite.

---

## Requirements

- Node.js 18+
- A [Devin](https://app.devin.ai) service user API key (`cog_...`)
- A GitHub OAuth App

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
| `VITE_DEVIN_API_KEY` | Devin service user API key |
| `VITE_DEVIN_ORG_ID` | Devin organization ID |
| `VITE_GITHUB_SCOPE` | GitHub search scope, e.g. `org:your-org` |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `http://localhost:8787/api/github/oauth/callback` |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | `http://localhost:5173/` |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | `http://localhost:5173` |
| `GITHUB_OAUTH_COOKIE_SECRET` | Any random string (generate: `openssl rand -hex 32`) |

### 3. Create a GitHub OAuth App

1. Go to **GitHub Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set the callback URL to `http://localhost:8787/api/github/oauth/callback`
3. Copy the client ID and secret into `.env.local`

### 4. Start the app

```bash
npm run dev:all
```

This starts both the OAuth server (port 8787) and the Vite frontend (port 5173) in one command. The app runs at `http://localhost:5173`.

---

## Deploying to Vercel

### 1. Push to GitHub and import the repo in Vercel

Go to [vercel.com](https://vercel.com), create a new project, and import your repository. Vercel will auto-detect the Vite build settings.

### 2. Set environment variables in the Vercel dashboard

Go to your project → **Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `VITE_DEVIN_API_KEY` | Your Devin service user API key |
| `VITE_DEVIN_ORG_ID` | Your Devin organization ID |
| `VITE_GITHUB_SCOPE` | e.g. `org:your-org` |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `https://your-app.vercel.app/api/github/oauth/callback` |
| `GITHUB_OAUTH_SCOPES` | `repo` |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | `https://your-app.vercel.app/` |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | `https://your-app.vercel.app` |
| `GITHUB_OAUTH_COOKIE_SECURE` | `true` |
| `GITHUB_OAUTH_COOKIE_SECRET` | Random 32+ char string (`openssl rand -hex 32`) |

### 3. Update your GitHub OAuth App

In your GitHub OAuth App settings, set the callback URL to:

```
https://your-app.vercel.app/api/github/oauth/callback
```

### 4. Deploy

Vercel deploys automatically on every push to your main branch. The OAuth API is served as a serverless function — no separate server needed.

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
