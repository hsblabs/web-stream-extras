/**
 * PNG text-chunk embed / extract usage examples
 *
 * Run: node --experimental-strip-types ./png/index.ts
 *      or: pnpm --filter examples run png  (from the repo root)
 *
 * Requires the library to be built first:
 *      pnpm build  (from the repo root)
 */

import { readAllBytes, readableFromChunks } from "@hsblabs/web-stream-extras";
import {
    createPNGTextChunkWriter,
    extractPNGTextChunk,
    streamPNGTextChunk,
} from "@hsblabs/web-stream-extras/png";

// A minimal valid 1×1 pixel PNG used as the base image in these examples.
// Replace this with a real PNG read from disk for real-world use.
const MINIMAL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
);

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Helper: embed a payload into a PNG ────────────────────────────────────────
//
// createPNGTextChunkWriter returns a { readable, writable } pair.
// Both sides must be driven concurrently: pipe the payload into writable while
// consuming readable to get the output PNG bytes.

async function embed(
    pngBytes: Uint8Array,
    payload: Uint8Array,
): Promise<Uint8Array> {
    const writer = createPNGTextChunkWriter(readableFromChunks(pngBytes));

    const [, result] = await Promise.all([
        readableFromChunks(payload).pipeTo(writer.writable),
        readAllBytes(writer.readable),
    ]);

    return result;
}

// ── 1. Embed a text payload into a PNG ───────────────────────────────────────

console.log("=== 1. Embed payload ===");

const payload = enc.encode("Hello from PNG payload!");
const embeddedPng = await embed(MINIMAL_PNG, payload);

console.log(`Source PNG size  : ${MINIMAL_PNG.byteLength} bytes`);
console.log(`Payload size     : ${payload.byteLength} bytes`);
console.log(`Embedded PNG size: ${embeddedPng.byteLength} bytes`);
console.log(
    "Still valid PNG? :",
    embeddedPng[0] === 0x89 && embeddedPng[1] === 0x50,
);

// ── 2. Extract with all-or-nothing semantics ──────────────────────────────────
//
// extractPNGTextChunk buffers everything and only emits after the manifest
// chunk has been validated.  Use this when you need guaranteed integrity before
// processing the payload.

console.log("\n=== 2. extractPNGTextChunk (all-or-nothing) ===");

const extracted = await readAllBytes(
    extractPNGTextChunk(readableFromChunks(embeddedPng)),
);

console.log("Extracted payload:", dec.decode(extracted));
console.log(
    "Matches original :",
    extracted.length === payload.length &&
    extracted.every((b, i) => b === payload[i]),
);

// ── 3. Stream with early emission ─────────────────────────────────────────────
//
// streamPNGTextChunk yields payload segments as they arrive, before the
// terminal manifest has been validated.  Useful for large payloads where you
// want to start processing immediately.  Any integrity error is reported on a
// subsequent read.

console.log("\n=== 3. streamPNGTextChunk (streaming) ===");

// Embed a larger payload so multiple segments are emitted.
const largePayload = enc.encode("A".repeat(64 * 1024)); // 64 KiB, spans two segments
const largePng = await embed(MINIMAL_PNG, largePayload);

const segmentReader = streamPNGTextChunk(
    readableFromChunks(largePng),
).getReader();

const segments: Uint8Array[] = [];
while (true) {
    const { done, value } = await segmentReader.read();
    if (done) break;
    segments.push(value);
    console.log(`  Received segment: ${value.byteLength} bytes`);
}

const reassembled = new Uint8Array(
    segments.reduce((s, c) => s + c.byteLength, 0),
);
let offset = 0;
for (const seg of segments) {
    reassembled.set(seg, offset);
    offset += seg.byteLength;
}
console.log(
    "Reassembled matches original:",
    reassembled.length === largePayload.length &&
    reassembled.every((b, i) => b === largePayload[i]),
);

// ── 4. Re-embed with { onExisting: "replace" } ───────────────────────────────
//
// By default the writer throws if the source PNG already contains an embedded
// payload.  Pass { onExisting: "replace" } to overwrite it silently.

console.log("\n=== 4. Replace existing payload ===");

const replacement = enc.encode("Updated payload");
const replaceWriter = createPNGTextChunkWriter(
    readableFromChunks(embeddedPng),
    { onExisting: "replace" },
);
const [, replacedPng] = await Promise.all([
    readableFromChunks(replacement).pipeTo(replaceWriter.writable),
    readAllBytes(replaceWriter.readable),
]);

const replacedExtracted = await readAllBytes(
    extractPNGTextChunk(readableFromChunks(replacedPng)),
);
console.log("Replaced payload:", dec.decode(replacedExtracted));
