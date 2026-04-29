---
"@hsblabs/web-stream-extras": minor
---

Add PNG text chunk and COBS stream APIs

- `createPNGTextChunkWriter` — embed arbitrary binary payloads into PNG tEXt chunks as a transform stream
- `extractPNGTextChunk` — extract a payload from a PNG tEXt chunk (all-at-once)
- `streamPNGTextChunk` — stream-extract a payload from a PNG tEXt chunk segment by segment
- `encodeCOBSFrame` / `decodeCOBSFrame` — frame-level COBS encode/decode
- `createCOBSEncoderStream` / `createCOBSDecoderStream` — COBS transform streams
- `writeCOBS` / `readCOBS` — high-level COBS pipe helpers
