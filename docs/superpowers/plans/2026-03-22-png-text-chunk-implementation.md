# PNG Text Chunk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `@hsblabs/web-stream-extras/png` subpath that can embed arbitrary binary data into PNG `tEXt` chunks and extract it back as `ReadableStream<Uint8Array>`.

**Architecture:** Keep the root package unchanged and add a dedicated `png` public entry mirroring the existing `encryption` subpath pattern. Implement PNG-specific helpers locally in `src/png/` for COBS, CRC32, and chunk framing, then build two public stream APIs on top: a coupled writer pair for embedding and a readable extractor for extraction.

**Tech Stack:** TypeScript, WHATWG Streams, Vitest, pnpm, tsdown

---

### Task 1: Add Public Surface And Failing API Tests

**Files:**
- Create: `src/png.ts`
- Create: `src/png/public.ts`
- Modify: `package.json`
- Modify: `tsdown.config.ts`
- Test: `src/png.test.ts`

- [ ] **Step 1: Write the failing public API tests**

```ts
import { describe, expect, it } from "vitest";
import * as pngApi from "./png";

describe("png public API", () => {
	it("exports the supported png helpers", () => {
		expect(Object.keys(pngApi).sort()).toEqual([
			"createPNGTextChunkWriter",
			"extractPNGTextChunk",
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: FAIL because `./png` does not exist or exports are missing

- [ ] **Step 3: Write minimal public entry implementation**

```ts
export type { PNGTextChunkWriteOptions, PNGTextChunkWriter } from "./png/public";
export { createPNGTextChunkWriter, extractPNGTextChunk } from "./png/public";
```

- [ ] **Step 4: Wire packaging for the new subpath**

Update `package.json` exports and `tsdown.config.ts` entries to include `./png` and `src/png.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: PASS for the export surface assertion

### Task 2: Build Low-Level PNG Helpers With Red-Green Tests

**Files:**
- Create: `src/png/constants.ts`
- Create: `src/png/cobs.ts`
- Create: `src/png/crc32.ts`
- Create: `src/png/framing.ts`
- Modify: `src/png.test.ts`

- [ ] **Step 1: Write failing tests for COBS, CRC32, and PNG framing**

```ts
it("round-trips arbitrary bytes through COBS", () => {
	expect(decodeCOBS(encodeCOBS(new Uint8Array([0, 1, 0, 2])))).toEqual(
		new Uint8Array([0, 1, 0, 2]),
	);
});

it("builds a valid tEXt chunk with matching CRC", () => {
	const chunk = createTextChunk(new Uint8Array([1, 2, 3]));
	expect(parseChunk(chunk).type).toBe("tEXt");
});

it("encodes and validates a versioned payload segment header", () => {
	const encoded = createPayloadSegment({
		segmentData: new Uint8Array([1, 2, 3]),
		segmentIndex: 0,
		segmentCount: 2,
		payloadCrc32: 123,
		isFirst: true,
		isLast: false,
	});
	expect(parsePayloadSegment(encoded).segmentIndex).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: FAIL because helper modules/functions are missing

- [ ] **Step 3: Implement minimal helper modules**

```ts
// cobs.ts
export function encodeCOBS(input: Uint8Array): Uint8Array {}
export function decodeCOBS(input: Uint8Array): Uint8Array {}

// crc32.ts
export function crc32(input: Uint8Array): number {}

// framing.ts
export function parsePNGSignature(...) {}
export function parseChunkHeader(...) {}
export function createTextChunk(...) {}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: PASS for helper-level tests

- [ ] **Step 5: Refactor helper boundaries without changing behavior**

Keep PNG-specific logic under `src/png/` and avoid moving it into `src/shared/` yet.

### Task 3: Implement `extractPNGTextChunk()` With TDD

**Files:**
- Modify: `src/png/public.ts`
- Modify: `src/png/framing.ts`
- Modify: `src/png/constants.ts`
- Modify: `src/png.test.ts`

- [ ] **Step 1: Write failing extraction tests**

```ts
it("extracts an embedded payload", async () => {
	const payload = await readAllBytes(extractPNGTextChunk(readableFromChunks(png)));
	expect(payload).toEqual(expectedPayload);
});

it("extracts payloads split across multiple tEXt chunks", async () => {
	const payload = await readAllBytes(extractPNGTextChunk(readableFromChunks(png)));
	expect(payload).toEqual(expectedPayload);
});

it("fails when no embedded payload exists", async () => {
	await expect(readAllBytes(extractPNGTextChunk(readableFromChunks(png)))).rejects.toThrow();
});
```

- [ ] **Step 2: Run extraction tests to verify they fail**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: FAIL because extraction behavior is not implemented

- [ ] **Step 3: Implement the minimal extractor**

```ts
export function extractPNGTextChunk(
	png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	// parse PNG, collect matching tEXt chunks, validate segment headers,
	// stream segment data, and throw on malformed input
}
```

- [ ] **Step 4: Run extraction tests to verify they pass**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: PASS for extraction happy-path and error-path tests

- [ ] **Step 5: Add edge-case tests and keep green**

Cover empty payload sentinel, bad signature, invalid non-ASCII chunk type, missing `IEND`, trailing bytes after `IEND`, truncated chunks, CRC mismatch, COBS decode failure, invalid `magic`/`version`, `segmentCount = 0`, inconsistent `segmentCount` / `payloadCrc32`, missing or duplicate or reverse-order segment indexes, payload CRC mismatch, and PNG input split 1 byte at a time.

### Task 4: Implement `createPNGTextChunkWriter()` With TDD

**Files:**
- Modify: `src/png/public.ts`
- Create: `src/png/transformers.ts`
- Modify: `src/png/framing.ts`
- Modify: `src/png.test.ts`

- [ ] **Step 1: Write failing writer tests**

```ts
it("embeds payload chunks before IEND and round-trips with extractor", async () => {
	const writer = createPNGTextChunkWriter(readableFromChunks(sourcePng));
	await readableFromChunks(payloadChunks).pipeTo(writer.writable);
	const rebuilt = await readAllBytes(writer.readable);
	expect(await readAllBytes(extractPNGTextChunk(readableFromChunks(rebuilt)))).toEqual(payload);
});

it("replaces an existing embedded payload when onExisting is replace", async () => {
	// create PNG with existing embedded chunks and verify replacement
});

it("waits at IEND until payload close", async () => {
	// start reading output before closing the payload side and verify final bytes are withheld
});
```

- [ ] **Step 2: Run writer tests to verify they fail**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: FAIL because writer behavior and lifecycle coupling are not implemented

- [ ] **Step 3: Implement the minimal writer pair**

```ts
export function createPNGTextChunkWriter(
	png: ReadableStream<Uint8Array>,
	options?: PNGTextChunkWriteOptions,
): PNGTextChunkWriter {
	// accept payload writes, validate source PNG, buffer payload segments,
	// insert them before IEND, and couple close/error propagation
}
```

- [ ] **Step 4: Run writer tests to verify they pass**

Run: `pnpm exec vitest run src/png.test.ts`
Expected: PASS for round-trip, replace/error, and lifecycle tests

- [ ] **Step 5: Add cancellation and abort propagation tests**

Verify `readable.cancel(reason)` cancels the source PNG reader and propagates the same `reason` to the writer, `writable.abort(reason)` cancels the source PNG reader and propagates the same `reason` to the output, the default `onExisting` behavior is `"error"`, late source PNG failures reject pending `close()`/`pipeTo()` promises, subsequent `write()` / `close()` calls reject after source-side failures, `close()` / `pipeTo()` resolve only after segment insertion and output close, payload written 1 byte at a time still succeeds, `0x00`-heavy payloads still succeed, empty payload emits the sentinel segment, embedded chunks are inserted immediately before `IEND`, output waits at `IEND` until payload close, and the fixed internal keyword is used consistently.

### Task 5: Finish Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `TODO.md`
- Modify: `LESSONS.md`

- [ ] **Step 1: Update README with a focused png example**

```ts
import { createPNGTextChunkWriter, extractPNGTextChunk } from "@hsblabs/web-stream-extras/png";
```

- [ ] **Step 2: Run targeted tests**

Run: `pnpm exec vitest run src/png.test.ts src/public-api.test.ts`
Expected: PASS

- [ ] **Step 3: Run repository verification**

Run: `pnpm test`
Expected: PASS

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Review diffs and prepare handoff**

Confirm the new subpath is documented, buildable, and covered by tests before handing back results.
