# Elysium

A mobile-first GitHub triage tool. Swipe through issues and pull requests, close or merge them directly, and delegate implementation work to [Devin](https://devin.ai). Built with React, TypeScript, and Vite.

---

## How credentials work

Elysium does not store credentials in the browser. Users enter their Devin API key, org ID, and GitHub scope once in the app's Settings panel. The credentials are validated against the Devin API and then stored in a signed `HttpOnly` cookie — they never touch `localStorage` or the browser's JS environment after that. All Devin API calls are proxied through the server.

---

## Requirements

- Node.js 18+
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

This starts both the local API server (port 8787) and Vite (port 5173) in one command. Open `http://localhost:5173` and enter your Devin API key in the Settings panel.

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
| `GITHUB_OAUTH_SCOPES` | `repo` |
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

Vercel deploys automatically on every push to your main branch. Users enter their Devin credentials in the app after deploying — no env vars needed for credentials.

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
