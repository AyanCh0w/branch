# GitHub

Branch connects to GitHub through one GitHub App, for **repositories as context**: on a board, the GitHub button in the bottom dock opens a panel. Link repositories, then add a whole repository (optionally limited to some folders), or click or drag files, issues and pull requests onto the canvas. Each becomes a card with a blue nib you connect to chats, like any other context. A chat connected to a repository card can list, read and search that repository's files while it answers.

Sign in with GitHub isn't available yet. Connecting GitHub here only grants repository access to your existing Branch account.

Branch only reads. It can't push code, comment or change anything on GitHub.

## One-time setup: register the GitHub App

Whoever runs Branch does this once. It takes about five minutes.

### 1. Create the app

Open https://github.com/settings/apps/new. To have an organization own the app, use that organization's **Settings → Developer settings → GitHub Apps** instead.

| Field | Value |
| --- | --- |
| GitHub App name | `Branch` (must be unique on GitHub; if it's taken, try `Branch Canvas` or similar) |
| Homepage URL | `https://branch.eshteremberg.workers.dev` |
| Callback URL | Add both (use **Add Callback URL**):<br>`https://branch.eshteremberg.workers.dev/app`<br>`http://127.0.0.1:4387/app` |
| Expire user authorization tokens | Leave checked |
| Request user authorization (OAuth) during installation | Leave **unchecked** |
| Enable Device Flow | Leave unchecked |
| Setup URL | `https://branch.eshteremberg.workers.dev/app?github=installed` |
| Redirect on update | Check it |
| Webhook → Active | **Uncheck** it (Branch doesn't use webhooks yet) |

**Permissions**

- Repository permissions: **Contents** Read-only, **Issues** Read-only, **Pull requests** Read-only. **Metadata** turns on as Read-only automatically.

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

The values are server settings, never code. Branch turns GitHub on when all four are set: `GITHUB_CLIENT_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_SECRET` and `GITHUB_PRIVATE_KEY`.

- **Hosted site** (Cloudflare Worker): whoever deploys Branch adds them as encrypted Worker secrets, from the `branch` folder:

  ```sh
  npx wrangler secret put GITHUB_CLIENT_ID
  npx wrangler secret put GITHUB_APP_SLUG
  npx wrangler secret put GITHUB_CLIENT_SECRET
  npx wrangler secret put GITHUB_PRIVATE_KEY < ~/Downloads/<your-app>.private-key.pem
  ```

  Each command asks for the value. Paste it there, not into a chat or issue.
- **Local development**: add the same four lines to `.env.local`. That file only holds one-line values, so store the private key with its line breaks written as `\n`:

  ```sh
  printf 'GITHUB_PRIVATE_KEY=%s\n' "$(awk '{printf "%s\\n", $0}' ~/Downloads/<your-app>.private-key.pem)" >> .env.local
  ```

The database also needs the GitHub tables: apply `supabase/migrations/202611140003_github.sql` after the earlier migrations, as described in `supabase/README.md`.

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

## Code

- `backend/functions/github.ts`: configuration, connections, board links, and access checks.
- `backend/functions/githubActions.ts`: connect, browse, list, add, refresh, folder limits and the chat repository tools, all calling GitHub.
- `supabase/migrations/202611140003_github.sql`: the `github_connections` and `board_repos` tables, generated by `scripts/build-entity-migration.cjs`.
- `collaboration/github.cjs`: app JWT signing and turning GitHub content into card text.
- `accounts/app.jsx`: the GitHub panel and return-from-GitHub page.
- `app/app.js`: GitHub cards, the dock button and drag-and-drop.
- Tests: `backend/tests/github.test.ts`.
