    | Verb | Path           | Purpose                                   |
|------|----------------|-------------------------------------------|
| GET  | `/v1/status`   | Full server health + metrics (human/ops)  |
| GET  | `/v1/stats`    | ⚡ Cheap stats for UI (users & speed)      |
| GET  | `/v1/chars`    | Random‑access slice of the stream text    |
| WS   | `/ws`          | Socket.io - See WS.md for events          |

## 1  GET /v1/status
Returns a verbose JSON snapshot:

```json
{
  "cursor": 35108,
  "chunks": 5,
  "dictionarySize": 466_550,
  "users": 7,
  "charsPerMinute": 35,
  "uptimeSec": 912
}
```

## 2  GET /v1/stats
User statistics
```json
{ "users": 7, "charsPerMinute": 35 }
```

## 3  GET /v1/chars?start=<int>&len=<int>
Fetch a slice of the text that has already scrolled past.  Guards: `len ≤ 8 KiB × 16`.

```json
// /v1/chars?start=16384&len=4096
# → 4096 characters of raw text starting at index 16384 (ASCII a‑z)
```