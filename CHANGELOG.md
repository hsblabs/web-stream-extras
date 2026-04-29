# @hsblabs/web-stream-extras

## 0.5.0

### Minor Changes

- d072a31: Add PNG text chunk and COBS stream APIs

  - `createPNGTextChunkWriter` — embed arbitrary binary payloads into PNG tEXt chunks as a transform stream
  - `extractPNGTextChunk` — extract a payload from a PNG tEXt chunk (all-at-once)
  - `streamPNGTextChunk` — stream-extract a payload from a PNG tEXt chunk segment by segment
  - `encodeCOBSFrame` / `decodeCOBSFrame` — frame-level COBS encode/decode
  - `createCOBSEncoderStream` / `createCOBSDecoderStream` — COBS transform streams
  - `writeCOBS` / `readCOBS` — high-level COBS pipe helpers

## 0.4.0

### Minor Changes

- 37b85e4: Add a `base64` subpath with streaming base64 and base64url encode/decode helpers.
- 0507b56: Add a `text` subpath with text encode/decode helpers and line split/join streams.

## 0.3.0

### Minor Changes

- Add JSONL Web Streams API and Changesets release automation.
