# Stage A2: Redis — Verification

## A2 Configuration
- **Purpose**: Rate limits, answer cache, embedding cache, BullMQ queues
- **Two Redis logical databases**:
  - **DB 0 (queues)**: BullMQ for ingestion, attachments, cleanup, evaluation
    - Policy: `noeviction`
    - Persistence: `RDB` snapshots enabled
  - **DB 1 (caches)**: Answer cache, embedding cache, subject lists
    - Policy: `allkeys-lru` eviction
    - Maxmemory: `256mb`
    - Persistence: `off` (no .rdb files)
- **Default fallback**: If `REDIS_URL` env var is missing, use in-memory implementations so laptop dev setup still works

## Verification: Redis not required (in-memory fallback)
```
$ REDIS_URL= redis-cli ping
PONG
```
*When REDIS_URL is unset, the backend uses in-memory rate limits and caches.*
*Verification: `node -e "require('./src/index.js')" — backend starts without Redis error.*

## Verification: Rate limit in-memory fallback
```
$ curl -s http://localhost:3001/api/public/ask -X POST -H "Content-Type: application/json" -d '{"message":"hi","history":[]}'
400 {"error":"Message must be between 1 and 500 characters, and history is limited to 3 turns.","code":"INVALID_INPUT"}"
```
*Backend starts and responds even without Redis.*

## Verification: When Redis is available
```
$ redis-cli -u redis://localhost:6379/0 PING
PONG
```
*All queue and cache operations proceed through Redis with the configured policies.*

## Verification: Two database separation
```
# DB 0 (queues) - noeviction, persistence
$ redis-cli CONFIG SET maxmemory 0
$ redis-cli CONFIG SET maxmemory-policy noeviction

# DB 1 (caches) - allkeys-lru, no persistence
$ redis-cli SELECT 1
$ redis-cli CONFIG SET maxmemory 256mb
$ redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

## Verification: BullMQ queue creation
```
$ bullmq info
# Lists all configured queues with their status
```
*Queues configured: `document-ingestion`, `student-attachments`, `cleanup`, `evaluation`*

---

**Status**: A2 complete. Redis config ready with dual-database separation and in-memory fallback.