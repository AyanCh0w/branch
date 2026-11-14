import { defineApp } from 'convex/server';
import { v } from 'convex/values';
import auth from '@convex-dev/auth/convex.config.js';
import authPassword from '@convex-dev/auth/components/password/convex.config.js';
import authUsername from '@convex-dev/auth/components/username/convex.config.js';
import authGithub from '@convex-dev/auth/components/github/convex.config.js';
// The GitHub App's OAuth credentials serve both sign-in and repository access.
// Both must be set on the deployment before it deploys (see docs/github.md).
const app = defineApp({ env: { GITHUB_CLIENT_ID: v.string(), GITHUB_CLIENT_SECRET: v.string() } });
app.use(auth); app.use(authPassword); app.use(authUsername);
app.use(authGithub, { httpPrefix: '/oauth/github', env: { CLIENT_ID: app.env.GITHUB_CLIENT_ID, CLIENT_SECRET: app.env.GITHUB_CLIENT_SECRET } });
export default app;
