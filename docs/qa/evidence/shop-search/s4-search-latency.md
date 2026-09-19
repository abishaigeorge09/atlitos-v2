# Search latency, production, measured from the US (2026-09-19)

Keystroke path (rerank: false), each line one request, warm after the first:

```
 3934 ms  mode=keyword vector=false results=20  "b"
 1467 ms  mode=keyword vector=false results=20  "ba"
 2265 ms  mode=keyword vector=true results=6  "bad"
 1274 ms  mode=keyword vector=true results=6  "badm"
  977 ms  mode=keyword vector=true results=8  "badminton"
  686 ms  mode=keyword vector=true results=9  "badminton racket"
  692 ms  mode=keyword vector=true results=1  "yonex"
-- submit (rerank on):
 3380 ms  mode=llm vector=true results=9  "badminton racket"
-- plain catalogue read (no ai-search), what the empty query path does:
  311 ms  REST list
```

Before any change (same script, same origin):

```
(v10)  2412 ms  mode=keyword vector=false results=20  "b"
(v10)  1028 ms  mode=keyword vector=false results=20  "ba"
(v10)  6021 ms  mode=llm vector=true results=6  "bad"
(v10)  5649 ms  mode=llm vector=true results=6  "badm"
(v10)  6039 ms  mode=llm vector=true results=8  "badminton"
(v10)  4828 ms  mode=llm vector=false results=6  "badminton racket"
(v10)  4382 ms  mode=llm vector=false results=6  "badminton racket"
(v10)  2142 ms  mode=llm vector=false results=1  "yonex"
(v10) -- plain catalogue read (no ai-search), what the empty query path does:
```

First measurement, v9: 7999, 7516, 6499, 5648, 5665, 4706, 4523, 4739 ms for the same eight queries.

Database region ap-south-1. Without x-region the function ran in the caller's nearest edge region and each of its sequential round trips crossed the Pacific.
