import { setupConvexAuth } from '@convex-dev/auth/server';
import { setupUsernamePassword } from '@convex-dev/auth/methods/username-password/server';
import { setupGithub } from '@convex-dev/auth/methods/github/server';
import { components, internal } from './_generated/api';
const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;
export const { signUpWithUsernamePassword, signInWithUsernamePassword, changePassword } = setupUsernamePassword(auth, {
  component: components.authPassword, usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.accounts.createUser });
// Sign-in may return only to these Branch origins. Add more with BRANCH_ORIGINS (comma-separated).
const origins = ['https://branch-eta-pink.vercel.app', 'http://127.0.0.1:4387', 'http://localhost:4387', ...(process.env.BRANCH_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)];
export const { startSignInWithGithub, completeSignInWithGithub } = setupGithub(auth, {
  component: components.authGithub, allowedRedirectOrigins: origins,
}).attachUserCallbacks({ createUser: internal.accounts.createUserGithub });
