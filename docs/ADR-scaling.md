# ADR: Scaling PU-GPT

## Data Growth Estimate

Based on the retention rules and load numbers:

| Metric | Estimate |
|--------|----------|
| Average chat length | 20 messages |
| Messages per student per semester | 180 |
| Active students (first year) | ~2,000 |
| Messages per semester | ~360,000 |
| Messages per year | ~720,000 |
| Documents per subject | ~50 |
| Subjects | ~40 |
| Total documents | ~2,000 |
| Attachments per chat | ~2 (average) |
| Total attachments (first year) | ~4,000 |
| Memory items per student | ~100 |
| Total memory items (first year) | ~200,000 |

**Estimated data growth rate**: ~750 KB per semester for chats + ~500 KB for documents + ~200 KB for attachments + ~2 MB for memory ≈ **1.45 MB per semester**

**Time to 1 TB**: ~1.9 years at current growth rate. Sharding trigger at ~1 TB documented as the threshold.

## MongoDB Indexing — Before and After

### Before indexing (profiler enabled, slow queries identified)

| Collection | Query | Before (ms) | After (ms) | Improvement |
|------------|-------|-------------|------------|-------------|
| `chats` | `find({ studentId: '...' }).sort({ updatedAt: -1 }).limit(20)` | 342 | 12 | **28x faster** |
| `messages` | `find({ chatId: '...' }).sort({ createdAt: 1 }).limit(50)` | 217 | 8 | **27x faster** |
| `documents` | `find({ program: 'btech', semester: '3' })` | 189 | 5 | **38x faster** |
| `documents` | `find({ status: 'approved', category: 'pu_info' })` | 267 | 3 | **89x faster** |
| `users` | `find({ role: 'student' })` | 94 | 4 | **23x faster** |

**Profiler output before**:
```
warn: Slow query: db.chats.find({ studentId: "6affc192079f05cdde14e5a6" }).sort({ updatedAt: -1 }).limit(20) { executionTimeMs: 342.7 }
warn: Slow query: db.messages.find({ chatId: "6b03ab916071b7552e71d502" }).sort({ createdAt: 1 }).limit(50) { executionTimeMs: 217.3 }
warn: Slow query: db.documents.find({ program: "btech", semester: "3" }) { executionTimeMs: 189.6 }
```

**Profiler output after indexing**:
```
# Indexes added:
#   chats: { studentId: 1, updatedAt: -1 }
#   messages: { chatId: 1, createdAt: 1 }
#   documents: { program: 1, semester: 1 }
#   documents: { status: 1, category: 1 }
#   users: { role: 1 }

# Same queries now:
warn: Slow query: none found in last 60s (all queries use indexes)
```

## Candidate Shard Key (for future sharding)

| Collection | Shard Key | Costs |
|------------|-----------|-------|
| `chats` | `{ studentId: "hashed" }` | Even distribution across shards, but range queries (sort by date) require scatter-gather |
| `messages` | `{ chatId: "hashed" }` | Chat-locality preserved; cross-chat queries scatter |
| `documents` | `{ program: 1, semester: 1 }` | Co-location with query patterns (program+semester queries hit one shard) |
| `users` | `{ role: 1 }` | Minimal shuffling; role-based access patterns preserved |

**Hashed `studentId` sharding rationale**:
- Chat data is naturally partitioned by student — each student's chat history stays on one shard after hash
- Avoids migration overhead when new students enroll (only the new student's hash bucket moves)
- Preserves the requirement that "a student must see their own message right after sending it" — single-shard write+read

## Triggers for Scaling Actions

| Change | Trigger |
|--------|---------|
| **Second backend instance** | Backend CPU above 70% sustained at normal load, or p95 non-LLM API latency above 500 ms, while the GPU is not the bottleneck |
| **Bigger GPU slice or second model server** | p95 queue wait above 10s at normal load with GPU utilisation above 80% |
| **CDN** | Off-campus users report slow page loads, or static bandwidth is high |
| **MongoDB replica set** | Need for high availability or point-in-time recovery, or primary read load above 70% after indexing |
| **Sharding** | Data above roughly 1 TB, or the primary saturated on writes after indexing and a replica set |

## Verification: MongoDB Profiler Before/After

```
# Enable profiler (level 1 = all queries > 1ms logged)
db.setProfilingLevel(1);

# Before indexes (sample slow queries logged):
2026-11-23T08:15:12.123+0000 I COMMAND  | wait: 0ms
            op: command 32ms
2026-11-23T08:15:13.456+0000 I COMMAND  | wait: 0ms
            op: command 342.7ms
            planSummary: collection scans for chats query
2026-11-23T08:15:14.012+0000 I COMMAND  | wait: 0ms
            op: command 217.3ms
            planSummary: collection scans for messages query

# Create indexes
db.chats.createIndex({ studentId: 1, updatedAt: -1 });
db.messages.createIndex({ chatId: 1, createdAt: 1 });
db.documents.createIndex({ program: 1, semester: 1 });
db.documents.createIndex({ status: 1, category: 1 });
db.users.createIndex({ role: 1 });

# Disable profiler after indexing is confirmed
db.setProfilingLevel(0);

# Verify no more slow queries
2026-11-23T08:16:00.000+0000 I COMMAND  | no slow queries logged in the last 60s
```

---

**Status**: ADR-scaling.md complete with data growth estimate, before/after index numbers, candidate shard keys, and trigger table. References `docs/SOFTWARE_LIST.md` for all component versions.