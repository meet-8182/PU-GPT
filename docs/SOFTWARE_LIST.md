# PU-GPT Software List

This document lists every component added to the PU-GPT system, including version, license, purpose, and where it runs.

## Reverse Proxy
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| nginx | 1.25.x | BSD-style | TLS termination, request routing, rate limiting, caching, security headers, streaming support | Production server / campus server |

## Caching & Queues
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| Redis | 7.x+ | BSD-3-Clause | Rate limits (replace in-process counters), answer cache (SHA-256 key, TTL 24h), embedding cache (hash of normalized text, TTL 7 days), BullMQ queues for document ingestion, student attachment processing, cleanup, nightly evaluation | Production server (two databases: DB 0 = queues noeviction, DB 1 = caches allkeys-lru) |
| BullMQ | 5.x+ | BSD-3-Clause | Document ingestion queue (extract, OCR, chunk, embed, index), student attachment processing, cleanup and TTL jobs, nightly evaluation run. Per-queue concurrency (OCR 1-2, embedding 2), retries with exponential backoff, failed-jobs list, idempotent job ids (file hash) | Production server |

## Monitoring & Observability
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| prom-client | 15.x+ | MIT | Backend `/metrics` endpoint: request rate and latency histograms by route (no ids), time to first token, tokens per second, queue depth and wait time, in-flight generations, cache hit ratio, retrieval latency, ingestion durations and failures, login failures, rate-limit hits, thumbs ratio | Production server (internal network only, not through nginx) |
| exporters/prometheus | v1+ | Apache-2.0 | Host, Redis, MongoDB, model server metrics exporters. GPU metrics (DCGM or nvidia-smi exporter) documented for model host | Production server / model host |
| Grafana | 10.x+ | AGPL-3.0 | Dashboards: Overview (traffic, errors, latency, TTFT), LLM (queue, in-flight, tokens/sec, GPU), Data (MongoDB, Redis), Ingestion (jobs), Quality (daily Hit@3, abstain rate, thumbs ratio) | Production server (optional Compose profile `monitoring`) |
| Alertmanager | v0.27.x+ | Apache-2.0 | Alert rules: backend down, readiness failing, 5xx above 2% for 5 min, p95 TTFT above 5s for 10 min, p95 queue wait above 20s, GPU memory above 95%, disk above 80%, Redis memory above 90%, more than 3 ingestion failures in an hour, no backup in 26 hours, MongoDB/vector store down | Production server (optional Compose profile `monitoring`) |
| Uptime Kuma | 1.2+ | MIT | Simple uptime monitoring (laptop dev setup) | Laptop / dev machine |

## Background Job Queues
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| BullMQ | 5.x+ | BSD-3-Clause | Queues: document ingestion (extract, OCR, chunk, embed, index), student attachment processing, cleanup and TTL jobs, nightly evaluation run. Per-queue concurrency (OCR 1-2, embedding 2), retries with exponential backoff, failed-jobs list with reason visible to admins, idempotent job ids (file hash), recovery of stalled jobs. Progress and final status written to document/attachment record | Production server |

## GPU & Model Server
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| vLLM | 0.4.x+ | Apache-2.0 | LLM serving on university HPC (12 GB GPU slice). Exposes `/metrics` Prometheus endpoint when available. | University HPC (separate from app server) |
| Ollama | 0.5.x+ | MIT | Local LLM fallback (qwen2.5:3b-instruct-q4_K_M at 11434). Used when vLLM not available. | App server (development/laptop) |

## Database
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| MongoDB | 8.x+ | AGPL-3.0+ | Primary data store: users, chats, conversations, documents, attachments, memory items, rate-limit counters (as fallback). Chats by `studentId` and `updatedAt`, messages by `chatId` and `createdAt`, TTL indexes on expired items. | Production server / campus infrastructure |
| Mongoose | 8.x+ | MIT | MongoDB ODM for Node.js ESM backend |

## Frontend
| Name | Version | License | Purpose | Runs On |
|------|---------|---------|---------|---------|
| React | 18.3.x | MIT | User interface | Client browser |
| Vite | 8.3.x | MIT | Dev server + build tool | Developer laptop + production CDN |
| Tailwind CSS | 3.4.x | MIT | Utility-first styling | Client browser |
| lucide-react | 0.378.x | MIT | Icon set | Client browser |
| axios | 1.20.x | MIT | HTTP client (all API calls except SSE go through axios, which Vite proxies to backend) | Client browser |
| sonner | 2.0.x | MIT | Toast notifications | Client browser |
| playwight-test | 1.64+ | Apache-2.0 | E2E testing | CI/CD pipeline |

## Monitoring & Alert Rules (Documentation)
| Rule | Trigger | Severity |
|------|---------|----------|
| Backend down | Health check `/health/live` returns non-200 | critical |
| Readiness failing | `/health/ready` fails (MongoDB, Redis, vector store, model server) | critical |
| 5xx above 2% for 5 min | `rate_limiter` metric sustained | warning |
| p95 TTFT above 5s for 10 min | `time_to_first_token` histogram p95 | warning |
| p95 queue wait above 20s | `queue_wait_seconds` histogram p95 | warning |
| GPU memory above 95% | `gpu_memory_utilization` | critical |
| disk above 80% | `disk_usage_percent` | warning |
| Redis memory above 90% | `used_memory_percent` | warning |
| More than 3 ingestion failures in an hour | `ingestion_failure_total` rate > 3/hour | warning |
| No backup in 26 hours | last backup timestamp > 26h ago | critical |
| MongoDB or vector store down | health check failure | critical |
| Hit@3 drops more than 3 points | daily evaluation metric | warning |

## ADR Triggers (from `docs/ADR-scaling.md`)

| Change | Trigger |
|--------|---------|
| Second backend instance | Backend CPU above 70% sustained at normal load, or p95 non-LLM API latency above 500 ms, while GPU is not the bottleneck |
| Bigger GPU slice or second model server | p95 queue wait above 10s at normal load with GPU utilisation above 80% |
| CDN | Off-campus users report slow page loads, or static bandwidth is high |
| MongoDB replica set | Need for high availability or point-in-time recovery, or primary read load above 70% after indexing |
| Sharding | Data above roughly 1 TB, or primary saturated on writes after indexing and replica set |

## Verification Checklist
- [ ] nginx config syntax: `nginx -t`
- [ ] Backend starts without REDIS_URL: `node src/index.js`
- [ ] Backend starts with REDIS_URL: rate limits and caches use Redis
- [ ] Two Redis databases separated: DB 0 noeviction/persisted, DB 1 allkeys-lru/no persistence
- [ ] BullMQ queues: document-ingestion, student-attachments, cleanup, evaluation
- [ ] BullMQ idempotent job ids: file hash used as job id
- [ ] BullMQ failed-jobs list: reason visible to admins
- [ ] Answer cache: SHA-256 of normalized question key, TTL 24h
- [ ] Answer cache eviction: thumbs-down deletes entry
- [ ] Embedding cache: hash of normalized text, TTL 7 days
- [ ] Subject list cache: 5-minute TTL
- [ ] Single-flight lock: prevents stampede on popular question
- [ ] `/metrics` endpoint: reachable on internal network only
- [ ] Prometheus targets up and scraping
- [ ] `/health/live` and `/health/ready` endpoints
- [ ] JSON logs: request id, route, status, duration, user role (not id)
- [ ] No message text in logs, metrics, queue payloads, cache keys
- [ ] No user ids in metric labels
- [ ] Evaluation harness runs and publishes Hit@3 metric
- [ ] `docs/SOFTWARE_LIST.md` complete and up to date
- [ ] `docs/ADR-scaling.md` with trigger table and before/after slow-query numbers from MongoDB B3

---

**Last updated**: 2026-11-23
**Maintainer**: PU-GPT Team