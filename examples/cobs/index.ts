/**
 * COBS (Consistent Overhead Byte Stuffing) usage examples
 *
 * Run: node --experimental-strip-types ./cobs/index.ts
 *      or: pnpm --filter examples run cobs  (from the repo root)
 */

import {
	createCOBSDecoderStream,
	createCOBSEncoderStream,
	decodeCOBSFrame,
	encodeCOBSFrame,
	readCOBS,
	writeCOBS,
} from "@hsblabs/web-stream-extras/cobs";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── 1. Frame-level API ────────────────────────────────────────────────────────
//
// COBS replaces every 0x00 byte so that the resulting encoded frame contains no
// null bytes.  A 0x00 delimiter can then be appended to mark the end of the
// frame on a byte-stream transport.

console.log("=== 1. Frame-level encode / decode ===");

const message = enc.encode("hello\x00world"); // contains a null byte
const encoded = encodeCOBSFrame(message);
const decoded = decodeCOBSFrame(encoded);

console.log("Input bytes     :", [...message]);
console.log("Encoded (no 0x00):", [...encoded]);
console.log("Contains 0x00?  :", encoded.includes(0), "(should be false)");
console.log(
	"Round-trip match:",
	decoded.length === message.length &&
		decoded.every((b, i) => b === message[i]),
);

// ── 2. Transform stream API ───────────────────────────────────────────────────
//
// When frames arrive as a stream, pipe through createCOBSEncoderStream() and
// createCOBSDecoderStream().  The encoder appends a 0x00 delimiter after each
// encoded frame; the decoder strips delimiters and reconstructs original frames.

console.log("\n=== 2. Transform stream API ===");

const frames: Uint8Array[] = [
	enc.encode("first frame"),
	enc.encode("second\x00frame"), // null byte in the middle
	Uint8Array.of(0x01, 0x00, 0x02, 0x03), // binary data with null
];

const encodedStream = new ReadableStream<Uint8Array>({
	start(controller) {
		for (const f of frames) controller.enqueue(f);
		controller.close();
	},
}).pipeThrough(createCOBSEncoderStream());

const roundTripStream = encodedStream.pipeThrough(createCOBSDecoderStream());

const reader = roundTripStream.getReader();
let idx = 0;
while (true) {
	const { done, value } = await reader.read();
	if (done) break;
	const original = frames[idx];
	const ok =
		original !== undefined &&
		value.length === original.length &&
		value.every((b, i) => b === original[i]);
	console.log(`Frame ${idx} round-trip: ${ok ? "✓ OK" : "✗ MISMATCH"}`);
	idx++;
}

// ── 3. writeCOBS / readCOBS ───────────────────────────────────────────────────
//
// writeCOBS(sink) wraps a WritableStream so that each written chunk is
// automatically COBS-encoded with a trailing 0x00 before being forwarded.
// readCOBS(source) wraps a ReadableStream and yields decoded frames.
//
// Typical pattern: connect them via a pass-through or actual transport stream.
// Drive both ends concurrently to avoid backpressure deadlocks.

console.log("\n=== 3. writeCOBS / readCOBS ===");

const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
const encSink = writeCOBS(writable);
const decSource = readCOBS(readable);

// Read all decoded frames concurrently with the writes.
const readAllDecodedPromise = (async (): Promise<Uint8Array[]> => {
	const chunks: Uint8Array[] = [];
	const r = decSource.getReader();
	while (true) {
		const { done, value } = await r.read();
		if (done) break;
		chunks.push(value);
	}
	return chunks;
})();

const writeAllPromise = (async () => {
	const writer = encSink.getWriter();
	await writer.write(enc.encode("high-level COBS API"));
	await writer.write(Uint8Array.of(0xde, 0xad, 0x00, 0xbe, 0xef)); // binary with null
	await writer.close();
})();

const [decodedFrames] = await Promise.all([
	readAllDecodedPromise,
	writeAllPromise,
]);

for (const value of decodedFrames) {
	if ([...value].every((b) => b >= 0x20 && b < 0x80)) {
		console.log("Decoded (text) :", dec.decode(value));
	} else {
		console.log(
			"Decoded (hex)  :",
			[...value].map((b) => b.toString(16).padStart(2, "0")).join(" "),
		);
	}
}
