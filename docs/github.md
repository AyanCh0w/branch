# GitHub

Branch connects to GitHub through one GitHub App. It does two things:

- **Sign in with GitHub**: a "Continue with GitHub" button on the sign-in screen.
- **Repositories as context**: on a board, the GitHub button in the bottom dock opens a panel. Link repositories, then click or drag files, issues and pull requests onto the canvas. Each becomes a card with a blue nib you connect to chats, like any other context.

Branch only reads. It can't push code, comment or change anything on GitHub.

## One-time setup: register the GitHub App

Whoever runs Branch does this once. It takes about five minutes.

### 1. Create the app

Open https://github.com/settings/apps/new. To have an organization own the app, use that organization's **Settings → Developer settings → GitHub Apps** instead.

| Field | Value |
| --- | --- |
| GitHub App name | `Branch` (must be unique on GitHub; if it's taken, try `Branch Canvas` or similar) |
| Homepage URL | `https://branch-eta-pink.vercel.app` |
| Callback URL | Add all four (use **Add Callback URL**):<br>`https://expert-mallard-315.convex.site/oauth/github/callback`<br>`https://branch-eta-pink.vercel.app/app`<br>`http://127.0.0.1:3211/oauth/github/callback`<br>`http://127.0.0.1:4387/app` |
| Expire user authorization tokens | Leave checked |
| Request user authorization (OAuth) during installation | Leave **unchecked** |
| Enable Device Flow | Leave unchecked |
| Setup URL | `https://branch-eta-pink.vercel.app/app?github=installed` |
| Redirect on update | Check it |
| Webhook → Active | **Uncheck** it (Branch doesn't use webhooks yet) |

**Permissions**

- Repository permissions: **Contents** Read-only, **Issues** Read-only, **Pull requests** Read-only. **Metadata** turns on as Read-only automatically.
- Account permissions: **Email addresses** Read-only (used by sign-in).

**Where can this GitHub App be installed?** Choose **Any account** so teammates can add their own and their organizations' repositories. Choose **Only on this account** if it's just for you.

Click **Create GitHub App**.

### 2. Collect the credentials

On the app's settings page:

1. **Client ID**: shown near the top (starts with `Iv`).
2. **App slug**: the last part of the **Public link**, e.g. `branch` in `https://github.com/apps/branch`.
3. **Client secret**: click **Generate a new client secret** and copy it now. GitHub won't show it again.
4. **Private key**: scroll to **Private keys** and click **Generate a private key**. A `.pem` file downloads.

Keep the secret and the `.pem` file private. Never commit them or paste them into a chat or issue.

### 3. Give them to Branch

The values live in the Convex deployment's environment, not in the code. In a terminal, in the `branch` folder:

```sh
npx convex env set GITHUB_CLIENT_ID <client id>
npx convex env set GITHUB_APP_SLUG <app slug>
npx convex env set GITHUB_CLIENT_SECRET <client secret>
npx convex env set GITHUB_PRIVATE_KEY -- "$(cat ~/Downloads/<your-app>.private-key.pem)"
```

Run them once against each deployment you use:

- **Local development**: run them as they are. They target the local backend in `.env.local`.
- **Hosted site** (`expert-mallard-315`): the Convex project owner runs them against that deployment, for example with `--prod` if it's the production deployment. **Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` there before deploying this code.** The deployment refuses the new configuration without them.

Nothing needs restarting. The GitHub button in the dock and "Continue with GitHub" on the sign-in screen switch on as soon as all four values are set.

### 4. Try it

1. Open a board and click the **GitHub** button in the bottom dock.
2. Click **Connect GitHub** and approve on GitHub.
3. Back in Branch, click **Choose repositories**, install the app on one or more repositories, and return.
4. **Add** a repository to the board, then browse **Files**, **Issues** or **Pull requests**. Click an item, or drag it onto the canvas.
5. Connect the new card's blue nib to a chat and ask about it.

GitHub allows only one Setup URL, and it points at the hosted site. When you test locally, installing the app returns you to the hosted site. Come back to `http://127.0.0.1:4387`, open the GitHub panel and click **Refresh**.

## How it works

- **Connecting**: Branch sends you through GitHub's authorization and receives a one-time user token. It uses the token to list the installations and repositories *you* can see, stores that list, and immediately revokes the token. No personal GitHub token is kept.
- **Reading**: to fetch content, the server creates a short-lived installation token (one hour) scoped to the single repository and to read-only permissions. It is never stored or sent to browsers.
- **Linking**: you can only link repositories from your verified list. Once linked, everyone who can **edit** the board can read that repository's files, issues and pull requests through Branch. Viewers see the cards on the board but can't browse.
- **Cards**: the server fetches and writes GitHub card content. People can move, resize and retitle a card, but can't change its content. **Refresh** fetches it again, and if anything changed the card gets a new revision. Chats that already captured it show the reference as stale until you refresh it there, as with other context cards.
- **Revoking**: removing a repository from a board, disconnecting GitHub in Branch, or losing access on GitHub (picked up the next time you connect or refresh) stops future reads. Existing cards keep their last snapshot. To cut Branch off completely, uninstall the app on GitHub.

## Limits

- Text files up to 1 MB. Binary files aren't supported. Card content is capped at 100,000 characters and marked as truncated beyond that.
- Issues and pull requests include up to 50 comments. Pull requests include up to 100 changed files, with each diff capped at 4,000 characters.
- The panel lists open issues and pull requests. Search to find closed ones.
- Up to 10 repositories per board, and up to 500 repositories per connected person.
- Cards are snapshots. They don't update when GitHub changes until someone clicks **Refresh**.
- GitHub sign-in creates its own Branch account. It doesn't merge with an existing username and password account. GitHub-only accounts have no Branch username yet, so others can't add them by username. Use an invite link instead.

## Code

- `convex/github.ts`: configuration, connections, board links, and access checks.
- `convex/githubActions.ts`: connect, browse, list, add and refresh, all calling GitHub.
- `collaboration/github.cjs`: app JWT signing and turning GitHub content into card text.
- `convex/auth.ts` and `convex/accounts.ts`: GitHub sign-in.
- `accounts/app.jsx`: the GitHub panel, return-from-GitHub page and sign-in button.
- `app/app.js`: GitHub cards, the dock button and drag-and-drop.
- Tests: `collaboration/github.test.ts`.
