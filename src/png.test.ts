import { describe, expect, it } from "vitest";
import * as pngApi from "./png";
import { decodeCOBS, encodeCOBS } from "./png/cobs";
import {
	PNG_INTERNAL_TEXT_CHUNK_KEYWORD,
	PNG_PAYLOAD_MAGIC,
	PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
	PNG_PAYLOAD_VERSION,
	PNG_SIGNATURE,
} from "./png/constants";
import { crc32 } from "./png/crc32";
import {
	createChunk,
	createPayloadSegment,
	createTextChunk,
	isInternalTextChunk,
	parsePayloadSegment,
	parsePNGBytes,
} from "./png/framing";
import { createPNGTextChunkWriter, extractPNGTextChunk } from "./png/public";
import { readAllBytes, readableFromChunks } from "./readable";

const MINIMAL_PNG = concatBytes(
	PNG_SIGNATURE,
	createChunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)),
	createChunk(
		"IDAT",
		Uint8Array.of(0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01),
	),
	createChunk("IEND", new Uint8Array(0)),
);

function splitBytes(data: Uint8Array, sizes: number[]): Uint8Array[] {
	const chunks: Uint8Array[] = [];
	let offset = 0;

	for (const size of sizes) {
		if (offset >= data.byteLength) {
			break;
		}

		chunks.push(data.slice(offset, offset + size));
		offset += size;
	}

	if (offset < data.byteLength) {
		chunks.push(data.slice(offset));
	}

	return chunks;
}

function splitIntoSingleBytes(data: Uint8Array): Uint8Array[] {
	return Array.from(data, (value) => new Uint8Array([value]));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, array) => sum + array.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;

	for (const array of arrays) {
		result.set(array, offset);
		offset += array.byteLength;
	}

	return result;
}

function delayed<T>(value: T, ms: number): Promise<T> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(value), ms);
	});
}

function reverseSegmentOrder(png: Uint8Array): Uint8Array {
	const chunks = parsePNGBytes(png);
	const internalChunks = chunks.filter(isInternalTextChunk).reverse();
	const nextChunks = chunks.flatMap((chunk) =>
		isInternalTextChunk(chunk) ? internalChunks.splice(0, 1) : [chunk],
	);

	return concatBytes(PNG_SIGNATURE, ...nextChunks.map((chunk) => chunk.raw));
}

function mutateFirstInternalChunk(
	png: Uint8Array,
	mutate: (segmentBytes: Uint8Array) => Uint8Array,
): Uint8Array {
	const chunks = parsePNGBytes(png);
	const nextChunks = chunks.map((chunk) => {
		if (!isInternalTextChunk(chunk)) {
			return chunk.raw;
		}

		const segment = parsePayloadSegment(
			chunk.data.subarray(PNG_INTERNAL_TEXT_CHUNK_KEYWORD.length + 1),
		);
		const mutated = mutate(segment.raw);
		return createTextChunk(mutated, PNG_INTERNAL_TEXT_CHUNK_KEYWORD);
	});

	return concatBytes(PNG_SIGNATURE, ...nextChunks);
}

async function embedPayload(
	payload: Uint8Array,
	options?: { onExisting?: "error" | "replace" },
	source = MINIMAL_PNG,
): Promise<Uint8Array> {
	const writer = createPNGTextChunkWriter(readableFromChunks(source), options);
	await readableFromChunks(payload).pipeTo(writer.writable);
	return readAllBytes(writer.readable);
}

describe("png public API", () => {
	it("exports the supported png helpers", () => {
		expect(Object.keys(pngApi).sort()).toEqual([
			"createPNGTextChunkWriter",
			"extractPNGTextChunk",
		]);
	});
});

describe("png helpers", () => {
	it("round-trips arbitrary bytes through COBS", () => {
		const input = new Uint8Array([0, 1, 0, 2, 3, 0, 4, 0]);

		expect(decodeCOBS(encodeCOBS(input))).toEqual(input);
	});

	it("builds a valid tEXt chunk with matching CRC", () => {
		const chunk = createTextChunk(new Uint8Array([1, 2, 3]), "keyword");
		const parsed = parsePNGBytes(concatBytes(PNG_SIGNATURE, chunk));

		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.type).toBe("tEXt");
		expect(parsed[0]?.crc).toBe(
			crc32(concatBytes(new TextEncoder().encode("tEXt"), parsed[0].data)),
		);
	});

	it("encodes and validates a versioned payload segment header", () => {
		const encoded = createPayloadSegment({
			isFirst: true,
			isLast: false,
			payloadCrc32: 123,
			segmentCount: 2,
			segmentData: new Uint8Array([1, 2, 3]),
			segmentIndex: 0,
		});
		const parsed = parsePayloadSegment(encoded);

		expect(Array.from(parsed.magic)).toEqual(Array.from(PNG_PAYLOAD_MAGIC));
		expect(parsed.version).toBe(PNG_PAYLOAD_VERSION);
		expect(parsed.segmentIndex).toBe(0);
		expect(parsed.segmentCount).toBe(2);
		expect(parsed.payloadCrc32).toBe(123);
		expect(parsed.isFirst).toBe(true);
		expect(parsed.isLast).toBe(false);
		expect(parsed.segmentData).toEqual(new Uint8Array([1, 2, 3]));
	});
});

describe("extractPNGTextChunk", () => {
	it("extracts payloads split across multiple tEXt chunks", async () => {
		const payload = new Uint8Array(
			PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 32,
		).map((_, index) => index & 0xff);
		const embedded = await embedPayload(payload);

		const extracted = await readAllBytes(
			extractPNGTextChunk(
				readableFromChunks(splitBytes(embedded, [5, 3, 2, 1])),
			),
		);

		expect(extracted).toEqual(payload);
	});

	it("round-trips empty payloads", async () => {
		const embedded = await embedPayload(new Uint8Array(0));
		const extracted = await readAllBytes(
			extractPNGTextChunk(readableFromChunks(embedded)),
		);

		expect(extracted).toEqual(new Uint8Array(0));
	});

	it("rejects pngs without embedded payloads", async () => {
		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(MINIMAL_PNG))),
		).rejects.toThrow();
	});

	it("rejects malformed signatures", async () => {
		const mutated = MINIMAL_PNG.slice();
		mutated[0] ^= 0xff;

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects missing IEND chunks", async () => {
		const mutated = MINIMAL_PNG.slice(0, -12);

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects trailing bytes after IEND", async () => {
		const mutated = concatBytes(MINIMAL_PNG, new Uint8Array([0xff]));

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects invalid non-ascii chunk types", async () => {
		const mutated = MINIMAL_PNG.slice();
		mutated[12] = 0x80;

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects invalid payload versions", async () => {
		const embedded = await embedPayload(new Uint8Array([1, 2, 3]));
		const mutated = mutateFirstInternalChunk(embedded, (segmentRaw) => {
			const next = segmentRaw.slice();
			next[4] = 0x7f;
			return encodeCOBS(next);
		});

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects reverse-order segment indexes", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 4).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);

		await expect(
			readAllBytes(
				extractPNGTextChunk(readableFromChunks(reverseSegmentOrder(embedded))),
			),
		).rejects.toThrow();
	});
});

describe("createPNGTextChunkWriter", () => {
	it("embeds payload chunks before IEND and round-trips with extractor", async () => {
		const payload = new Uint8Array([0, 1, 2, 3, 0, 4, 5, 0, 6]);
		const writer = createPNGTextChunkWriter(
			readableFromChunks(splitBytes(MINIMAL_PNG, [8, 7, 5, 3, 2, 1])),
		);

		await readableFromChunks(splitIntoSingleBytes(payload)).pipeTo(
			writer.writable,
		);
		const rebuilt = await readAllBytes(writer.readable);
		const extracted = await readAllBytes(
			extractPNGTextChunk(readableFromChunks(splitIntoSingleBytes(rebuilt))),
		);
		const chunks = parsePNGBytes(rebuilt);
		const iendIndex = chunks.findIndex((chunk) => chunk.type === "IEND");
		const internalIndex = chunks.findIndex(isInternalTextChunk);
		const previousChunk = chunks[iendIndex - 1];

		expect(extracted).toEqual(payload);
		expect(internalIndex).toBeGreaterThanOrEqual(0);
		expect(iendIndex).toBeGreaterThan(internalIndex);
		expect(previousChunk ? isInternalTextChunk(previousChunk) : false).toBe(
			true,
		);
	});

	it("uses error as the default existing-chunk policy", async () => {
		const embedded = await embedPayload(new Uint8Array([1, 2, 3]));
		const writer = createPNGTextChunkWriter(readableFromChunks(embedded));
		const writePromise = readableFromChunks(new Uint8Array([4, 5, 6])).pipeTo(
			writer.writable,
		);

		await expect(writePromise).rejects.toThrow();
		await expect(readAllBytes(writer.readable)).rejects.toThrow();
	});

	it("replaces an existing embedded payload when onExisting is replace", async () => {
		const embedded = await embedPayload(new Uint8Array([1, 2, 3]));
		const rewritten = await embedPayload(
			new Uint8Array([4, 5, 6, 7]),
			{ onExisting: "replace" },
			embedded,
		);
		const extracted = await readAllBytes(
			extractPNGTextChunk(readableFromChunks(rewritten)),
		);
		const chunks = parsePNGBytes(rewritten).filter(isInternalTextChunk);

		expect(extracted).toEqual(new Uint8Array([4, 5, 6, 7]));
		expect(chunks.length).toBeGreaterThan(0);
	});

	it("waits for payload close before completing the output", async () => {
		const writer = createPNGTextChunkWriter(readableFromChunks(MINIMAL_PNG));
		const outputPromise = readAllBytes(writer.readable);
		const payloadWriter = writer.writable.getWriter();

		await payloadWriter.write(new Uint8Array([1, 2, 3]));

		await expect(
			Promise.race([outputPromise.then(() => "done"), delayed("pending", 20)]),
		).resolves.toBe("pending");

		await payloadWriter.close();
		const rebuilt = await outputPromise;
		const extracted = await readAllBytes(
			extractPNGTextChunk(readableFromChunks(rebuilt)),
		);

		expect(extracted).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("rejects pending close when the source png is invalid", async () => {
		const mutated = MINIMAL_PNG.slice();
		mutated[20] ^= 0xff;
		const writer = createPNGTextChunkWriter(readableFromChunks(mutated));
		const payloadWriter = writer.writable.getWriter();

		await payloadWriter.write(new Uint8Array([1, 2, 3]));

		await expect(payloadWriter.close()).rejects.toThrow();
		await expect(readAllBytes(writer.readable)).rejects.toThrow();
	});

	it("propagates readable cancel reasons and cancels the source png reader", async () => {
		let canceledReason: unknown;
		const source = new ReadableStream<Uint8Array>({
			cancel(reason) {
				canceledReason = reason;
			},
			start(controller) {
				controller.enqueue(MINIMAL_PNG);
			},
		});
		const writer = createPNGTextChunkWriter(source);
		const reason = new Error("cancel output");

		await writer.readable.cancel(reason);

		await expect(
			writer.writable.getWriter().write(new Uint8Array([1])),
		).rejects.toBe(reason);
		expect(canceledReason).toBe(reason);
	});

	it("propagates writable abort reasons and cancels the source png reader", async () => {
		let canceledReason: unknown;
		const source = new ReadableStream<Uint8Array>({
			cancel(reason) {
				canceledReason = reason;
			},
			start(controller) {
				controller.enqueue(MINIMAL_PNG);
			},
		});
		const writer = createPNGTextChunkWriter(source);
		const payloadWriter = writer.writable.getWriter();
		const reason = new Error("abort payload");

		await expect(payloadWriter.abort(reason)).resolves.toBeUndefined();
		await expect(readAllBytes(writer.readable)).rejects.toBe(reason);
		expect(canceledReason).toBe(reason);
	});
});
