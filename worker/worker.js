const ALLOWED_ORIGINS = new Set([
  'https://consorcioweb.github.io',
  'http://localhost:5511',
  'http://127.0.0.1:5511'
]);

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 100000;
const MAX_URL_LENGTH = 2048;
const MAX_DESCRIPTION_LENGTH = 160;
const TOKEN_SUBJECT = 'cartelera';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin'));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return await login(request, env, cors);
      }

      if (url.pathname === '/api/urls') {
        if (request.method === 'GET') return await listUrls(request, env, cors);
        if (request.method === 'POST') return await createUrl(request, env, cors);
        return json({ error: 'Método no permitido' }, 405, cors);
      }

      const itemMatch = url.pathname.match(/^\/api\/urls\/([^/]+)$/);
      if (itemMatch) {
        const id = decodeURIComponent(itemMatch[1]);
        if (request.method === 'PUT') return await updateUrl(request, env, cors, id);
        if (request.method === 'DELETE') return await deleteUrl(request, env, cors, id);
        return json({ error: 'Método no permitido' }, 405, cors);
      }

      if (url.pathname === '/' || url.pathname === '/api') {
        return json({ ok: true, service: 'cartelera-api' }, 200, cors);
      }

      return json({ error: 'Ruta no encontrada' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'Error interno del servidor' }, 500, cors);
    }
  }
};

function corsHeaders(origin) {
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function login(request, env, cors) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Solicitud inválida' }, 400, cors);

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return json({ error: 'Usuario y clave son obligatorios' }, 400, cors);
  }

  const [userOk, passOk] = await Promise.all([
    constantTimeEqual(username, env.AUTH_USERNAME || ''),
    verifyPassword(password, env)
  ]);

  if (!userOk || !passOk) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return json({ error: 'Usuario o clave incorrectos' }, 401, cors);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: TOKEN_SUBJECT, iat: now, exp: now + SESSION_TTL_SECONDS };
  const payloadPart = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64urlEncode(await hmac(env.AUTH_SECRET, payloadPart));

  return json(
    {
      token: `${payloadPart}.${signature}`,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
    },
    200,
    cors
  );
}

async function listUrls(request, env, cors) {
  const unauthorized = await requireSession(request, env, cors);
  if (unauthorized) return unauthorized;

  const { results } = await env.DB.prepare(
    'SELECT id, url, description, status, created_at, updated_at FROM urls ORDER BY created_at DESC, id DESC'
  ).all();

  return json({ items: results || [] }, 200, cors);
}

async function createUrl(request, env, cors) {
  const unauthorized = await requireSession(request, env, cors);
  if (unauthorized) return unauthorized;

  const body = await readJson(request);
  if (!body) return json({ error: 'Solicitud inválida' }, 400, cors);

  const url = normalizeUrl(body.url);
  if (!url) return json({ error: 'Ingresa una URL válida' }, 400, cors);

  const description = normalizeDescription(body.description);
  const status = normalizeStatus(body.status);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO urls (id, url, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, url, description, status, now, now)
    .run();

  return json({ item: { id, url, description, status, created_at: now, updated_at: now } }, 201, cors);
}

async function updateUrl(request, env, cors, id) {
  const unauthorized = await requireSession(request, env, cors);
  if (unauthorized) return unauthorized;

  const body = await readJson(request);
  if (!body) return json({ error: 'Solicitud inválida' }, 400, cors);

  const url = normalizeUrl(body.url);
  if (!url) return json({ error: 'Ingresa una URL válida' }, 400, cors);

  const existing = await env.DB.prepare('SELECT created_at FROM urls WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'URL no encontrada' }, 404, cors);

  const description = normalizeDescription(body.description);
  const status = normalizeStatus(body.status);
  const now = new Date().toISOString();

  await env.DB.prepare(
    'UPDATE urls SET url = ?, description = ?, status = ?, updated_at = ? WHERE id = ?'
  )
    .bind(url, description, status, now, id)
    .run();

  return json(
    { item: { id, url, description, status, created_at: existing.created_at, updated_at: now } },
    200,
    cors
  );
}

async function deleteUrl(request, env, cors, id) {
  const unauthorized = await requireSession(request, env, cors);
  if (unauthorized) return unauthorized;

  const result = await env.DB.prepare('DELETE FROM urls WHERE id = ?').bind(id).run();
  if (!result.meta || result.meta.changes === 0) {
    return json({ error: 'URL no encontrada' }, 404, cors);
  }

  return json({ ok: true }, 200, cors);
}

async function requireSession(request, env, cors) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(header);
  if (!match) return json({ error: 'Sesión no válida o expirada' }, 401, cors);

  const parts = match[1].split('.');
  if (parts.length !== 2) return json({ error: 'Sesión no válida o expirada' }, 401, cors);

  const [payloadPart, signaturePart] = parts;
  if (!env.AUTH_SECRET) return json({ error: 'Autenticación no configurada' }, 500, cors);

  const expected = base64urlEncode(await hmac(env.AUTH_SECRET, payloadPart));
  if (!safeEqual(expected, signaturePart)) {
    return json({ error: 'Sesión no válida o expirada' }, 401, cors);
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadPart)));
  } catch {
    return json({ error: 'Sesión no válida o expirada' }, 401, cors);
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.sub !== TOKEN_SUBJECT || typeof payload.exp !== 'number' || payload.exp < now) {
    return json({ error: 'Sesión no válida o expirada' }, 401, cors);
  }

  return null;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > MAX_URL_LENGTH) return null;

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname.includes('.')) return null;
  if (parsed.href.length > MAX_URL_LENGTH) return null;
  return parsed.href;
}

function normalizeDescription(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_DESCRIPTION_LENGTH) : '';
}

function normalizeStatus(value) {
  return value === 'vista' ? 'vista' : 'no-vista';
}

async function verifyPassword(password, env) {
  const saltHex = env.AUTH_PASSWORD_SALT;
  const expectedHash = env.AUTH_PASSWORD_HASH;
  if (!saltHex || !expectedHash) return false;

  try {
    const salt = hexToBytes(saltHex);
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
      material,
      256
    );
    return safeEqual(bytesToHex(new Uint8Array(bits)), expectedHash.toLowerCase());
  } catch {
    return false;
  }
}

async function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b))
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let index = 0; index < bytesA.length; index += 1) {
    diff |= bytesA[index] ^ bytesB[index];
  }
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function base64urlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('Hex inválido');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
