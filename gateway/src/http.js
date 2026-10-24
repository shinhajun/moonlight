// HTTP plumbing: JSON helpers, auth, routing table, static files (SPA fallback), release downloads.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, errors } from './util.js';

const MAX_BODY = 4 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.sh': 'text/x-shellscript; charset=utf-8', '.ps1': 'text/plain; charset=utf-8',
};

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return res.end();
  if (status === 204) {
    res.writeHead(204, headers);
    return res.end();
  }
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

export const errorBody = (err) => ({ error: { message: err.message, type: err.type, code: err.code }, ...(err.extra || {}) });

export function sendError(res, err, log) {
  if (!(err instanceof ApiError)) {
    log?.(`unhandled: ${err.stack || err}`);
    err = new ApiError(500, 'server_error', 'internal_error', 'Something went wrong on our side.');
  }
  send(res, err.status, errorBody(err), err.headers || {});
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'invalid_request_error', 'too_large', 'Request body is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(errors.badRequest('Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

export function cookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Path matching: '/api/models/:id*' captures the rest (model ids contain '/' and ':').
export function router(routes) {
  const compiled = routes.map(([method, pattern, handler]) => {
    const names = [];
    const re = pattern.replace(/:(\w+)(\*)?/g, (_, n, star) => {
      names.push(n);
      return star ? '(.+)' : '([^/]+)';
    });
    return { method, re: new RegExp(`^${re}$`), names, handler };
  });
  return (method, pathname) => {
    let allowed = false;
    for (const r of compiled) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method) {
        allowed = true;
        continue;
      }
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { handler: r.handler, params };
    }
    return allowed ? { notAllowed: true } : null;
  };
}

function streamFile(req, res, file, headers) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: { message: 'Not found.', type: 'invalid_request_error', code: 'not_found' } });
    res.writeHead(200, { 'content-length': st.size, ...headers });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const RELEASE = /^\/(?:(install\.(?:sh|ps1))|dl\/(moonlight-(?:darwin|linux|windows)-(?:arm64|x64)(?:\.exe)?))$/;

// /agent.mjs, /install.sh, /install.ps1, /dl/moonlight-<os>-<arch>[.exe]. Returns true if handled.
export function serveDownloads(config, req, res, pathname) {
  if (pathname === '/agent.mjs') {
    streamFile(req, res, config.agentFile, { 'content-type': MIME['.mjs'], 'cache-control': 'no-cache' });
    return true;
  }
  const m = RELEASE.exec(pathname);
  if (!m) {
    if (!pathname.startsWith('/dl/') && !pathname.startsWith('/install.')) return false;
    send(res, 404, { error: { message: 'No such download.', type: 'invalid_request_error', code: 'not_found' } });
    return true;
  }
  const name = m[1] || m[2];
  const type = m[1] ? MIME[path.extname(name)] : 'application/octet-stream';
  const extra = m[2] ? { 'content-disposition': `attachment; filename="${name}"` } : {};
  streamFile(req, res, path.join(config.releaseDir, name), { 'content-type': type, 'cache-control': 'no-cache', ...extra });
  return true;
}

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>Moonlight</title>
<body style="font:16px system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Moonlight</h1><p>Sell the models running on your own computer. The web app is being deployed; the API is live at <code>/v1</code>.</p>`;

// web/dist with an SPA fallback: unknown paths without a file extension get index.html.
export function serveStatic(config, req, res, pathname) {
  const root = path.resolve(config.webDist);
  let file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 400, { error: { message: 'Bad path.' } });
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    else if (err) file = path.join(root, 'index.html');
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) {
        if (!fs.existsSync(path.join(root, 'index.html'))) {
          res.writeHead(200, { 'content-type': MIME['.html'] });
          return res.end(PLACEHOLDER);
        }
        return send(res, 404, { error: { message: 'Not found.' } });
      }
      const ext = path.extname(file);
      const immutable = file.includes(`${path.sep}assets${path.sep}`);
      streamFile(req, res, file, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    });
  });
}
