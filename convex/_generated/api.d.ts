/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as agentCanvas from "../agentCanvas.js";
import type * as auth from "../auth.js";
import type * as boards from "../boards.js";
import type * as chat from "../chat.js";
import type * as chatgpt from "../chatgpt.js";
import type * as chatgptActions from "../chatgptActions.js";
import type * as chatgptHttp from "../chatgptHttp.js";
import type * as chatgptOAuth from "../chatgptOAuth.js";
import type * as chatgptSync from "../chatgptSync.js";
import type * as coding from "../coding.js";
import type * as collaboration from "../collaboration.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as files from "../files.js";
import type * as github from "../github.js";
import type * as githubActions from "../githubActions.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as library from "../library.js";
import type * as maintenance from "../maintenance.js";
import type * as people from "../people.js";
import type * as sharing from "../sharing.js";
import type * as teams from "../teams.js";
import type * as visualPlan from "../visualPlan.js";
import type * as workspaceKeyActions from "../workspaceKeyActions.js";
import type * as workspaceKeys from "../workspaceKeys.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounts: typeof accounts;
  agentCanvas: typeof agentCanvas;
  auth: typeof auth;
  boards: typeof boards;
  chat: typeof chat;
  chatgpt: typeof chatgpt;
  chatgptActions: typeof chatgptActions;
  chatgptHttp: typeof chatgptHttp;
  chatgptOAuth: typeof chatgptOAuth;
  chatgptSync: typeof chatgptSync;
  coding: typeof coding;
  collaboration: typeof collaboration;
  crons: typeof crons;
  documents: typeof documents;
  files: typeof files;
  github: typeof github;
  githubActions: typeof githubActions;
  http: typeof http;
  invitations: typeof invitations;
  library: typeof library;
  maintenance: typeof maintenance;
  people: typeof people;
  sharing: typeof sharing;
  teams: typeof teams;
  visualPlan: typeof visualPlan;
  workspaceKeyActions: typeof workspaceKeyActions;
  workspaceKeys: typeof workspaceKeys;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  authUsername: import("@convex-dev/auth/components/username/_generated/component.js").ComponentApi<"authUsername">;
  authGithub: import("@convex-dev/auth/components/github/_generated/component.js").ComponentApi<"authGithub">;
};
