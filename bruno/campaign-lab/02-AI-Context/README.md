# NOT EXPOSED VIA HTTP

No independent Business Context REST route. Internal buildBusinessContext validates C1/C6/C8 and freshness.

- tests/unit/ai-context.test.ts, memory-context.test.ts
- GET /api/dev/discussions?sessionId=... returns currentHash/historicalMemory and saved session.contextHash.
- GET /api/dev/evaluations?campaignId=... exposes its separate evaluation context.

No fake context endpoint, client-supplied authoritative price/capacity, or production C1/C6/C8 implementation.
