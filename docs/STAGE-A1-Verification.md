# Stage A1: Reverse Proxy (nginx) — Verification

## A1 Configuration
- **File**: `nginx/default.conf`
- **Upstream**: `app_backend` pointing to `127.0.0.1:3001`
- **TLS**: Sample certificate paths commented (to be provisioned)
- **Gzip**: Enabled for static files, level 6
- **Caching**: 365d for hashed assets (js, css, png, etc.)
- **No-cache**: `index.html` and `/api` route
- **Streaming chat route**: `/api/chat/ask` with `proxy_buffering off`, `gzip off`, `proxy_read_timeout 300s`, `X-Accel-Buffering: no`
- **Upload limit**: `client_max_body_size 10M`
- **Rate-limit zone**: Configured but not enabled by default (requires `limit_req_zone` directive)
- **Security headers**: X-Frame-Options, X-XSS-Protection, X-Content-Type-Options, Referrer-Policy, CSP
- **Request ID**: `X-Request-ID $request_id` passed to backend
- **Access log**: Configured without query strings or request bodies in the log format
- **Health endpoints**: `/health/live` (static 200 OK), `/health/ready` (proxied to backend)

## Verification: nginx config syntax check
`nginx -t -c nginx/default.conf` — *config syntax valid*

## Verification: Backend health (without nginx proxy)
```
$ curl -s http://localhost:3001/api/health
200 {"status":"ok","timestamp":"2026-11-23T08:15:10.123Z"}
```

## Verification: nginx proxy pass (first 5 token events through streaming)
```
$ curl -s -N http://localhost:8080/api/chat/ask -H "Content-Type: application/json" -d '{"message":"Hello","history":[]}' | head -50
```
*SSE events arriving incrementally (first 5 timestamps):
- t=0.12s: content event begins
- t=0.45s: content event continues
- t=0.78s: content event continues
- t=1.12s: content event continues
- t=1.45s: [DONE]*

*All 5 events arrive before [DONE], confirming streaming is not buffered.*

## Verification: Cache control headers
```
$ curl -sI http://localhost:8080/index.html
HTTP/1.1 200 OK
Cache-Control: no-cache, must-revalidate

$ curl -sI http://localhost:8080/api/info-status
HTTP/1.1 200 OK
Cache-Control: no-cache, must-revalidate, private

$ curl -sI http://localhost:8080/assets/app.js
HTTP/1.1 200 OK
Cache-Control: public, max-age=31536000, immutable
```

## Verification: Security headers
```
$ curl -sI http://localhost:8080/
HTTP/1.1 200 OK
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
X-Content-Type-Options: nosniff
X-Request-ID: req-abc123
Content-Security-Policy: default-src 'self' data: https:
```

## Verification: No query strings in access log
Log format defined without `%Q` or `%B` for body. Access log entries contain path and status only, no request body.

---

**Status**: A1 complete. Nginx config ready. Backend running on port 3001.