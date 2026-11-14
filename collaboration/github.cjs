/* GitHub helpers shared by the Convex backend and tests: app authentication
   (RS256 JWT from the GitHub App private key) and turning GitHub content into
   card text. No dependencies; uses Web Crypto. */
'use strict';

const API = 'https://api.github.com';
const MAX_TEXT = 100000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_COMMENTS = 50;
const MAX_PATCH = 4000;

// ---------- App authentication ----------

function derLength(length) {
  if (length < 0x80) return [length];
  const bytes = [];
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return [0x80 | bytes.length, ...bytes];
}
function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const encodeJSON = value => base64url(new TextEncoder().encode(JSON.stringify(value)));

// GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY") keys; Web Crypto imports PKCS#8.
function privateKeyDER(pem) {
  const text = String(pem || '').replace(/\\n/g, '\n').trim();
  const match = text.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/);
  if (!match) throw Error('GITHUB_PRIVATE_KEY is not a PEM private key');
  const der = decodeBase64(match[2].replace(/\s+/g, ''));
  if (!match[1]) return der;
  const version = [0x02, 0x01, 0x00];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...derLength(der.length)];
  const body = version.length + algorithm.length + octets.length + der.length;
  const out = new Uint8Array(1 + derLength(body).length + body);
  out.set([0x30, ...derLength(body), ...version, ...algorithm, ...octets]);
  out.set(der, out.length - der.length);
  return out;
}

/** @param {string|undefined} clientId @param {string|undefined} pem @returns {Promise<string>} */
async function appJWT(clientId, pem, now = Math.floor(Date.now() / 1000)) {
  if (!clientId) throw Error('GITHUB_CLIENT_ID is not set');
  const key = await crypto.subtle.importKey('pkcs8', privateKeyDER(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  // Backdate for clock drift; GitHub allows at most ten minutes.
  const unsigned = encodeJSON({ alg: 'RS256', typ: 'JWT' }) + '.' + encodeJSON({ iat: now - 60, exp: now + 540, iss: clientId });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + base64url(new Uint8Array(signature));
}

// ---------- API ----------

class GitHubError extends Error { constructor(message, status) { super(message); this.status = status; } }
/** @param {string} path @param {{ token?: string, method?: string, body?: any, accept?: string, auth?: string }} [options] @returns {Promise<any>} */
async function github(path, { token, method = 'GET', body, accept = 'application/vnd.github+json', auth = 'Bearer' } = {}) {
  let response;
  try {
    response = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { Accept: accept, 'User-Agent': 'Branch', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: auth + ' ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new GitHubError('GitHub is not responding. Try again.', 0); }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  const message = response.status === 404 ? 'Not found on GitHub. It may have moved, or Branch no longer has access.'
    : response.status === 401 ? 'GitHub rejected Branch’s credentials.'
    : response.status === 403 && /rate limit/i.test(data?.message || '') ? 'GitHub’s rate limit was reached. Try again in a few minutes.'
    : response.status === 403 ? 'Branch doesn’t have permission for this on GitHub.'
    : response.status === 422 ? 'GitHub couldn’t process that request.'
    : 'GitHub returned an error (' + response.status + ').';
  throw new GitHubError(message, response.status);
}

// ---------- Content to card text ----------

function limit(text, max = MAX_TEXT) {
  const value = String(text || '');
  return value.length > max ? { text: value.slice(0, max), truncated: true } : { text: value, truncated: false };
}
const LANGUAGES = { js: 'javascript', cjs: 'javascript', mjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', css: 'css', html: 'html', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'bash', sql: 'sql' };
const languageOf = path => LANGUAGES[(String(path).split('.').pop() || '').toLowerCase()] || '';

function fileCard(repo, file, ref) {
  if (file?.type !== 'file') throw Error('Choose a file, not a folder.');
  if (file.size > MAX_FILE_BYTES) throw Error('Files over 1 MB aren’t supported yet.');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(String(file.content || '').replace(/\s+/g, ''))); }
  catch { throw Error('This looks like a binary file. Only text files can be added.'); }
  if (content.includes('\u0000')) throw Error('This looks like a binary file. Only text files can be added.');
  const { text, truncated } = limit(content);
  return { title: file.path, text, github: { kind: 'file', repo, path: file.path, ref, sha: file.sha, url: file.html_url, language: languageOf(file.path), truncated } };
}

const who = user => (user?.login ? '@' + user.login : 'someone');
function commentsText(comments) {
  return (comments || []).slice(0, MAX_COMMENTS).map(c => who(c.user) + ' commented:\n' + (c.body || '').trim()).join('\n\n');
}
function issueCard(repo, issue, comments) {
  const sections = [(issue.body || '').trim() || '_No description._'];
  if (comments?.length) sections.push('### Comments\n\n' + commentsText(comments));
  const { text, truncated } = limit(sections.join('\n\n'));
  return { title: '#' + issue.number + ' ' + issue.title, text, github: { kind: 'issue', repo, number: issue.number, state: issue.state, author: issue.user?.login || '', labels: (issue.labels || []).map(l => typeof l === 'string' ? l : l.name).filter(Boolean).slice(0, 10), comments: issue.comments || 0, url: issue.html_url, truncated } };
}
function pullCard(repo, pull, files, comments) {
  const changes = (files || []).map(f => {
    const patch = f.patch ? (f.patch.length > MAX_PATCH ? f.patch.slice(0, MAX_PATCH) + '\n… patch truncated' : f.patch) : '';
    return '#### ' + f.filename + ' (' + f.status + ', +' + f.additions + ' −' + f.deletions + ')' + (patch ? '\n```diff\n' + patch + '\n```' : '');
  });
  const sections = [(pull.body || '').trim() || '_No description._'];
  if (changes.length) sections.push('### Changed files\n\n' + changes.join('\n\n'));
  if (comments?.length) sections.push('### Comments\n\n' + commentsText(comments));
  const { text, truncated } = limit(sections.join('\n\n'));
  const state = pull.merged_at ? 'merged' : pull.draft && pull.state === 'open' ? 'draft' : pull.state;
  return { title: '#' + pull.number + ' ' + pull.title, text, github: { kind: 'pull', repo, number: pull.number, state, author: pull.user?.login || '', base: pull.base?.ref || '', head: pull.head?.ref || '', additions: pull.additions || 0, deletions: pull.deletions || 0, changedFiles: pull.changed_files || (files || []).length, url: pull.html_url, truncated } };
}

module.exports = { API, MAX_TEXT, privateKeyDER, appJWT, github, GitHubError, fileCard, issueCard, pullCard, languageOf };
