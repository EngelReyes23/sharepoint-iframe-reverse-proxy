# SharePoint iframe reverse proxy

This Node.js service proxies an external website under a local path so the proxied copy can be embedded in a SharePoint Online iframe. It removes the upstream framing headers from proxied responses and adds a `<base>` element to HTML pages so relative links and assets resolve against the configured target origin.

## Run locally

Requirements: Node.js 20 LTS and npm.

```sh
npm install
npm start
```

The default service listens on `http://localhost:3000`. Copy `.env.example` to `.env` and set values before starting if needed. The application reads environment variables directly; loading `.env` is intentionally left to the host or shell because no runtime dependency beyond the two proxy packages is used.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP listening port. |
| `TARGET_ORIGIN` | `https://www.radioshackla.com` | HTTP(S) origin to proxy. |
| `PROXY_BASE_PATH` | `/radioshack` | Public path prefix removed before forwarding. |

## Deploy notes

Deploy this as a Node.js 20 service on a generic HTTPS-capable Node host. Configure the host to run `npm install` during the build/release phase and `npm start` as the process command. Set `TARGET_ORIGIN`, `PROXY_BASE_PATH`, and `PORT` through the host's environment configuration, terminate TLS at the host or a trusted reverse proxy, and use the resulting HTTPS URL as the SharePoint iframe source. Keep the service process private behind the host's HTTPS ingress where possible and monitor upstream errors and bandwidth.

## Validation commands

With the service running locally:

```sh
# (a) Health check
curl -i http://localhost:3000/health

# (b) Framing headers should be absent from the proxied HTML response.
curl -sS -D - -o /tmp/radioshack.html http://localhost:3000/radioshack/nicaragua/search/nintendo | findstr /I /C:"x-frame-options" /C:"content-security-policy"

# Inspect the HTML for the injected base element.
findstr /I /C:"<base href=\"https://www.radioshackla.com/\">" /tmp/radioshack.html

# (c) The returned CSS/image Content-Type should match the upstream asset.
curl -sS -D - -o NUL http://localhost:3000/radioshack/path/to/asset.css | findstr /I "content-type"
curl -sS -D - -o NUL http://localhost:3000/radioshack/path/to/image.png | findstr /I "content-type"
```

On a Unix-like shell, replace `findstr` with `grep -i` and `/tmp/radioshack.html` with a suitable temporary path. For a strict absence check on Unix:

```sh
curl -sS -D - -o /tmp/radioshack.html http://localhost:3000/radioshack/nicaragua/search/nintendo | grep -iE 'x-frame-options|content-security-policy' && echo 'unexpected framing header' || echo 'framing headers absent'
```

## Limitations

- Cookies and `SameSite` behavior may prevent login or stateful flows when the site is embedded on a different SharePoint origin.
- Third-party JavaScript calls may still fail because of CORS, origin checks, CSP behavior, or browser privacy controls.
- Absolute links and asset URLs that point outside the proxy path can escape the proxied copy and load from the origin directly.
- Bot protection, WAF rules, rate limits, and upstream anti-automation checks may block requests or require additional integration.
- Stripping framing headers affects only responses returned by this proxy; it does not change the origin site's policy or make the origin itself frameable.
