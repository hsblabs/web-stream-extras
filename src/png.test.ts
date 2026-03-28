import { describe, expect, it } from "vitest";
import { decodeCOBSFrame, encodeCOBSFrame } from "./cobs";
import * as pngApi from "./png";
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
	createPayloadDataSegment,
	createPayloadManifestSegment,
	createTextChunk,
	getInternalTextChunkPayload,
	isInternalTextChunk,
	parsePayloadSegment,
	parsePNGBytes,
} from "./png/framing";
import {
	createPNGTextChunkWriter,
	extractPNGTextChunk,
	streamPNGTextChunk,
} from "./png/public";
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

function readableFromDelayedChunks(
	chunks: Uint8Array[],
	delayMs: number,
): ReadableStream<Uint8Array> {
	let index = 0;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}

			const chunk = chunks[index];
			index += 1;
			await delayed(undefined, delayMs);
			controller.enqueue(chunk);
		},
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

function replaceInternalChunks(
	png: Uint8Array,
	replace: (chunks: ReturnType<typeof parsePNGBytes>) => Uint8Array[],
): Uint8Array {
	const chunks = parsePNGBytes(png);
	const iendChunk = chunks.find((chunk) => chunk.type === "IEND");
	const nextInternalChunks = replace(chunks.filter(isInternalTextChunk));
	const nextChunks = chunks
		.filter((chunk) => chunk.type !== "IEND" && !isInternalTextChunk(chunk))
		.map((chunk) => chunk.raw);

	if (!iendChunk) {
		throw new Error("Expected IEND chunk");
	}

	return concatBytes(
		PNG_SIGNATURE,
		...nextChunks,
		...nextInternalChunks,
		iendChunk.raw,
	);
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
			"streamPNGTextChunk",
		]);
	});
});

describe("png helpers", () => {
	it("round-trips arbitrary bytes through COBS", () => {
		const input = new Uint8Array([0, 1, 0, 2, 3, 0, 4, 0]);

		expect(decodeCOBSFrame(encodeCOBSFrame(input))).toEqual(input);
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

	it("encodes and validates payload data segments", () => {
		const encoded = createPayloadDataSegment({
			segmentData: new Uint8Array([1, 2, 3]),
			segmentIndex: 0,
		});
		const parsed = parsePayloadSegment(encoded);

		expect(Array.from(parsed.magic)).toEqual(Array.from(PNG_PAYLOAD_MAGIC));
		expect(parsed.version).toBe(PNG_PAYLOAD_VERSION);
		expect(parsed.kind).toBe("data");
		if (parsed.kind !== "data") {
			throw new Error("Expected a data segment");
		}
		expect(parsed.segmentIndex).toBe(0);
		expect(parsed.segmentData).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("encodes and validates payload manifest segments", () => {
		const encoded = createPayloadManifestSegment({
			payloadCrc32: 123,
			segmentCount: 2,
		});
		const parsed = parsePayloadSegment(encoded);

		expect(Array.from(parsed.magic)).toEqual(Array.from(PNG_PAYLOAD_MAGIC));
		expect(parsed.version).toBe(PNG_PAYLOAD_VERSION);
		expect(parsed.kind).toBe("manifest");
		if (parsed.kind !== "manifest") {
			throw new Error("Expected a manifest segment");
		}
		expect(parsed.segmentCount).toBe(2);
		expect(parsed.payloadCrc32).toBe(123);
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
			return encodeCOBSFrame(next);
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

	it("rejects payload data that appears after the manifest", async () => {
		const payload = new Uint8Array(
			PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH * 2 + 4,
		).map((_, index) => index & 0xff);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) => {
			const manifestChunk = internalChunks.at(-1);
			const dataChunks = internalChunks.slice(0, -1);
			const trailingDataChunk = dataChunks.at(-1);

			if (!manifestChunk || !trailingDataChunk) {
				throw new Error("Expected manifest and trailing data chunk");
			}

			return [
				...dataChunks.slice(0, -1).map((chunk) => chunk.raw),
				manifestChunk.raw,
				trailingDataChunk.raw,
			];
		});

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects manifest segment-count mismatches", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 4).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) => {
			const manifestChunk = internalChunks.at(-1);
			if (!manifestChunk) {
				throw new Error("Expected manifest chunk");
			}

			const manifest = parsePayloadSegment(
				getInternalTextChunkPayload(manifestChunk),
			);
			if (manifest.kind !== "manifest") {
				throw new Error("Expected a manifest segment");
			}

			return [
				...internalChunks.slice(0, -1).map((chunk) => chunk.raw),
				createTextChunk(
					createPayloadManifestSegment({
						payloadCrc32: manifest.payloadCrc32,
						segmentCount: manifest.segmentCount + 1,
					}),
				),
			];
		});

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects manifest crc mismatches", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 4).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) => {
			const manifestChunk = internalChunks.at(-1);
			if (!manifestChunk) {
				throw new Error("Expected manifest chunk");
			}

			const manifest = parsePayloadSegment(
				getInternalTextChunkPayload(manifestChunk),
			);
			if (manifest.kind !== "manifest") {
				throw new Error("Expected a manifest segment");
			}

			return [
				...internalChunks.slice(0, -1).map((chunk) => chunk.raw),
				createTextChunk(
					createPayloadManifestSegment({
						payloadCrc32: manifest.payloadCrc32 ^ 0xffffffff,
						segmentCount: manifest.segmentCount,
					}),
				),
			];
		});

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects duplicate manifests", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 4).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) => {
			const manifestChunk = internalChunks.at(-1);
			if (!manifestChunk) {
				throw new Error("Expected manifest chunk");
			}

			return [
				...internalChunks.slice(0, -1).map((chunk) => chunk.raw),
				manifestChunk.raw,
				manifestChunk.raw,
			];
		});

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});

	it("rejects manifest-first ordering", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 4).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) => {
			const manifestChunk = internalChunks.at(-1);
			if (!manifestChunk) {
				throw new Error("Expected manifest chunk");
			}

			return [
				manifestChunk.raw,
				...internalChunks.slice(0, -1).map((chunk) => chunk.raw),
			];
		});

		await expect(
			readAllBytes(extractPNGTextChunk(readableFromChunks(mutated))),
		).rejects.toThrow();
	});
});

describe("streamPNGTextChunk", () => {
	it("closes cleanly for empty payloads", async () => {
		const embedded = await embedPayload(new Uint8Array(0));
		const reader = streamPNGTextChunk(readableFromChunks(embedded)).getReader();

		await expect(reader.read()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});

	it("supports single-byte source chunking", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 8).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const reader = streamPNGTextChunk(
			readableFromChunks(splitIntoSingleBytes(embedded)),
		).getReader();
		const first = await reader.read();

		expect(first.done).toBe(false);
		expect(first.value).toEqual(
			payload.subarray(0, PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
		);

		const remaining: Uint8Array[] = [];
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			remaining.push(next.value);
		}

		expect(concatBytes(first.value, ...remaining)).toEqual(payload);
	});

	it("emits payload bytes before the terminal manifest arrives", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 8).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const chunks = parsePNGBytes(embedded);
		const stream = streamPNGTextChunk(
			readableFromDelayedChunks(
				[PNG_SIGNATURE, ...chunks.map((chunk) => chunk.raw)],
				10,
			),
		);
		const reader = stream.getReader();

		const first = await Promise.race([reader.read(), delayed("pending", 80)]);
		if (first === "pending") {
			throw new Error("Expected payload bytes before the manifest arrived");
		}

		expect(first.done).toBe(false);
		expect(first.value).toEqual(
			payload.subarray(0, PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
		);

		const remaining: Uint8Array[] = [];
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			remaining.push(next.value);
		}

		expect(concatBytes(first.value, ...remaining)).toEqual(payload);
	});

	it("allows partial output before reporting missing manifests", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 8).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) =>
			internalChunks.slice(0, -1).map((chunk) => chunk.raw),
		);
		const reader = streamPNGTextChunk(readableFromChunks(mutated)).getReader();
		const first = await reader.read();

		expect(first.done).toBe(false);
		expect(first.value).toEqual(
			payload.subarray(0, PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
		);

		const second = await reader.read();
		expect(second.done).toBe(false);
		expect(second.value).toEqual(
			payload.subarray(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
		);

		await expect(reader.read()).rejects.toThrow(
			"PNG does not contain an embedded payload",
		);
	});

	it("allows partial output before reporting crc mismatches", async () => {
		const payload = new Uint8Array(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH + 8).map(
			(_, index) => index & 0xff,
		);
		const embedded = await embedPayload(payload);
		const mutated = replaceInternalChunks(embedded, (internalChunks) => {
			const manifestChunk = internalChunks.at(-1);
			if (!manifestChunk) {
				throw new Error("Expected manifest chunk");
			}

			const manifest = parsePayloadSegment(
				getInternalTextChunkPayload(manifestChunk),
			);
			if (manifest.kind !== "manifest") {
				throw new Error("Expected a manifest segment");
			}

			return [
				...internalChunks.slice(0, -1).map((chunk) => chunk.raw),
				createTextChunk(
					createPayloadManifestSegment({
						payloadCrc32: manifest.payloadCrc32 ^ 0xffffffff,
						segmentCount: manifest.segmentCount,
					}),
				),
			];
		});
		const reader = streamPNGTextChunk(readableFromChunks(mutated)).getReader();
		const first = await reader.read();

		expect(first.done).toBe(false);
		expect(first.value).toEqual(
			payload.subarray(0, PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
		);

		const second = await reader.read();
		expect(second.done).toBe(false);
		expect(second.value).toEqual(
			payload.subarray(PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
		);

		await expect(reader.read()).rejects.toThrow("PNG payload CRC mismatch");
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
		const internalChunks = chunks.filter(isInternalTextChunk);
		const internalIndex = chunks.findIndex(isInternalTextChunk);
		const previousChunk = chunks[iendIndex - 1];
		const manifestChunk = internalChunks.at(-1);
		const manifest = manifestChunk
			? parsePayloadSegment(getInternalTextChunkPayload(manifestChunk))
			: null;

		expect(extracted).toEqual(payload);
		expect(internalIndex).toBeGreaterThanOrEqual(0);
		expect(iendIndex).toBeGreaterThan(internalIndex);
		expect(previousChunk ? isInternalTextChunk(previousChunk) : false).toBe(
			true,
		);
		expect(manifest?.kind).toBe("manifest");
		expect(internalChunks.slice(0, -1).length).toBeGreaterThan(0);
		expect(
			internalChunks.slice(0, -1).every((chunk, index) => {
				const parsed = parsePayloadSegment(getInternalTextChunkPayload(chunk));
				return parsed.kind === "data" && parsed.segmentIndex === index;
			}),
		).toBe(true);
		if (manifest?.kind !== "manifest") {
			throw new Error("Expected a manifest segment");
		}
		expect(manifest.segmentCount).toBe(internalChunks.length - 1);
		expect(manifest.payloadCrc32).toBe(crc32(payload));
	});

	it("emits validated source chunks before payload close and keeps IEND pending", async () => {
		const sourceChunks = parsePNGBytes(MINIMAL_PNG);
		const writer = createPNGTextChunkWriter(
			readableFromDelayedChunks(
				[PNG_SIGNATURE, ...sourceChunks.map((chunk) => chunk.raw)],
				10,
			),
		);
		const reader = writer.readable.getReader();
		const payloadWriter = writer.writable.getWriter();
		const writePromise = payloadWriter.write(new Uint8Array([1, 2, 3]));

		const first = await Promise.race([reader.read(), delayed("pending", 40)]);
		if (first === "pending") {
			throw new Error("Expected the PNG signature before payload close");
		}
		const second = await reader.read();
		const third = await reader.read();
		const pendingRead = reader.read();

		expect(first).toEqual({ done: false, value: PNG_SIGNATURE });
		expect(second).toEqual({ done: false, value: sourceChunks[0]?.raw });
		expect(third).toEqual({ done: false, value: sourceChunks[1]?.raw });
		await expect(
			Promise.race([pendingRead.then(() => "done"), delayed("pending", 5)]),
		).resolves.toBe("pending");

		await writePromise;
		await payloadWriter.close();

		const remaining: Uint8Array[] = [];
		const fourth = await pendingRead;
		if (!fourth.done) {
			remaining.push(fourth.value);
		}
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			remaining.push(next.value);
		}

		const rebuilt = concatBytes(
			first.value,
			second.value as Uint8Array,
			third.value as Uint8Array,
			...remaining,
		);
		const extracted = await readAllBytes(
			extractPNGTextChunk(readableFromChunks(rebuilt)),
		);

		expect(extracted).toEqual(new Uint8Array([1, 2, 3]));
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

	it("preserves unrelated tEXt chunks byte-for-byte when onExisting is replace", async () => {
		const unrelatedTextChunk = createTextChunk(
			new TextEncoder().encode("keep-me"),
			"note",
		);
		const sourceWithText = concatBytes(
			PNG_SIGNATURE,
			createChunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)),
			unrelatedTextChunk,
			createChunk(
				"IDAT",
				Uint8Array.of(0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01),
			),
			createChunk("IEND", new Uint8Array(0)),
		);
		const embedded = await embedPayload(
			new Uint8Array([1, 2, 3]),
			undefined,
			sourceWithText,
		);
		const rewritten = await embedPayload(
			new Uint8Array([4, 5, 6, 7]),
			{ onExisting: "replace" },
			embedded,
		);
		const extracted = await readAllBytes(
			extractPNGTextChunk(readableFromChunks(rewritten)),
		);
		const textChunks = parsePNGBytes(rewritten).filter(
			(chunk) => chunk.type === "tEXt",
		);
		const unrelatedChunks = textChunks.filter(
			(chunk) => !isInternalTextChunk(chunk),
		);
		const internalChunks = textChunks.filter(isInternalTextChunk);

		expect(extracted).toEqual(new Uint8Array([4, 5, 6, 7]));
		expect(unrelatedChunks).toHaveLength(1);
		expect(unrelatedChunks[0]?.raw).toEqual(unrelatedTextChunk);
		expect(internalChunks).toHaveLength(2);
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

		await expect(
			payloadWriter.write(new Uint8Array([1, 2, 3])),
		).rejects.toThrow();
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
