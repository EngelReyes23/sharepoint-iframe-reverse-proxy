const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const PORT = parsePort(process.env.PORT, 3000);
const TARGET_ORIGIN = normalizeTargetOrigin(
  process.env.TARGET_ORIGIN || 'https://www.radioshackla.com'
);
const PROXY_BASE_PATH = normalizeBasePath(process.env.PROXY_BASE_PATH || '/radioshack');

const interceptResponse = responseInterceptor(async (responseBuffer, proxyRes) => {
  if (!isHtmlResponse(proxyRes.headers['content-type'])) {
    return responseBuffer;
  }

  const html = responseBuffer.toString('utf8');
  const headTag = /<head\b[^>]*>/i.exec(html);
  if (!headTag) {
    return responseBuffer;
  }

  const baseTag = `<base href="${escapeHtmlAttribute(`${TARGET_ORIGIN}/`)}">`;
  const insertionPoint = headTag.index + headTag[0].length;
  return Buffer.from(`${html.slice(0, insertionPoint)}${baseTag}${html.slice(insertionPoint)}`);
});

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const proxy = createProxyMiddleware({
  target: TARGET_ORIGIN,
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  selfHandleResponse: true,
  pathRewrite: (path) => {
    if (path === PROXY_BASE_PATH) {
      return '/';
    }

    if (path.startsWith(`${PROXY_BASE_PATH}/`)) {
      return path.slice(PROXY_BASE_PATH.length) || '/';
    }

    return path;
  },
  on: {
    proxyReq: (proxyReq) => {
      proxyReq.setHeader(
        'user-agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );
      proxyReq.setHeader('accept-language', 'es-NI,es;q=0.9,en;q=0.8');
    },
    proxyRes: (proxyRes, req, res) => {
      removeFramingHeaders(proxyRes.headers);
      res.removeHeader('x-frame-options');
      res.removeHeader('content-security-policy');
      res.removeHeader('content-security-policy-report-only');
      return interceptResponse(proxyRes, req, res);
    },
    error: handleProxyError
  }
});

app.use(PROXY_BASE_PATH, proxy);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`);
  console.log(`Proxying ${PROXY_BASE_PATH} to ${TARGET_ORIGIN}`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
  process.exitCode = 1;
});

function handleProxyError(error, req, res) {
  console.error(`Upstream proxy error for ${req.method} ${req.originalUrl}:`, error);

  if (!res.headersSent) {
    res.status(502).json({ error: error.message || 'Upstream request failed' });
  }
}

function removeFramingHeaders(headers) {
  for (const headerName of Object.keys(headers)) {
    if (
      headerName.toLowerCase() === 'x-frame-options' ||
      headerName.toLowerCase() === 'content-security-policy' ||
      headerName.toLowerCase() === 'content-security-policy-report-only'
    ) {
      delete headers[headerName];
    }
  }
}

function isHtmlResponse(contentType) {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
}

function escapeHtmlAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeBasePath(value) {
  const path = value.trim();
  if (!path || !path.startsWith('/')) {
    throw new Error('PROXY_BASE_PATH must be a non-empty path beginning with /.');
  }

  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function normalizeTargetOrigin(value) {
  const origin = value.trim().replace(/\/+$/, '');
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('TARGET_ORIGIN must be an HTTP(S) origin such as https://example.com.');
  }

  return origin;
}

function parsePort(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return port;
}
