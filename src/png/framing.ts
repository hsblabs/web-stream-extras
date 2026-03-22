import { throwError } from "../shared/error";
import { concatU8Arrays } from "../shared/uint8array";
import { decodeCOBS, encodeCOBS } from "./cobs";
import {
	PNG_IEND_CHUNK_TYPE,
	PNG_INTERNAL_TEXT_CHUNK_KEYWORD,
	PNG_PAYLOAD_FLAG_FIRST,
	PNG_PAYLOAD_FLAG_LAST,
	PNG_PAYLOAD_HEADER_LENGTH,
	PNG_PAYLOAD_MAGIC,
	PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
	PNG_PAYLOAD_VERSION,
	PNG_SIGNATURE,
	PNG_TEXT_CHUNK_TYPE,
} from "./constants";
import { crc32 } from "./crc32";

const textEncoder = new TextEncoder();
const ASCII_LETTER = /[A-Za-z]/;

function latin1BytesToString(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => String.fromCharCode(value)).join("");
}

export interface PNGChunk {
	crc: number;
	data: Uint8Array;
	length: number;
	raw: Uint8Array;
	type: string;
}

export interface CreatePayloadSegmentInput {
	isFirst: boolean;
	isLast: boolean;
	payloadCrc32: number;
	segmentCount: number;
	segmentData: Uint8Array;
	segmentIndex: number;
}

export interface ParsedPayloadSegment extends CreatePayloadSegmentInput {
	flags: number;
	magic: Uint8Array;
	raw: Uint8Array;
	version: number;
}

interface ParsePNGBytesOptions {
	requireIEND?: boolean;
}

function readUint32BE(data: Uint8Array, offset: number): number {
	return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
		offset,
		false,
	);
}

function writeUint32BE(value: number): Uint8Array {
	const output = new Uint8Array(4);
	new DataView(output.buffer).setUint32(0, value >>> 0, false);
	return output;
}

function assertChunkType(type: string): void {
	if (type.length !== 4 || [...type].some((char) => !ASCII_LETTER.test(char))) {
		throwError("PNG chunk type must be 4 ASCII letters");
	}
}

function assertChunkTypeBytes(typeBytes: Uint8Array): void {
	if (
		typeBytes.byteLength !== 4 ||
		Array.from(typeBytes).some(
			(value) =>
				!((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a)),
		)
	) {
		throwError("PNG chunk type must be 4 ASCII letters");
	}
}

function assertKeyword(keyword: string): Uint8Array {
	if (keyword.length === 0 || keyword.length >= 80 || keyword.includes("\0")) {
		throwError("PNG tEXt keyword must be 1-79 bytes without NUL");
	}

	return textEncoder.encode(keyword);
}

function parseTextChunkKeyword(data: Uint8Array): string | null {
	const separatorIndex = data.indexOf(0);
	if (separatorIndex <= 0) {
		return null;
	}

	return latin1BytesToString(data.subarray(0, separatorIndex));
}

export function createChunk(type: string, data: Uint8Array): Uint8Array {
	assertChunkType(type);
	const typeBytes = textEncoder.encode(type);
	const lengthBytes = writeUint32BE(data.byteLength);
	const crcBytes = writeUint32BE(crc32(concatU8Arrays(typeBytes, data)));

	return concatU8Arrays(lengthBytes, typeBytes, data, crcBytes);
}

export function createTextChunk(
	text: Uint8Array,
	keyword = PNG_INTERNAL_TEXT_CHUNK_KEYWORD,
): Uint8Array {
	if (text.includes(0)) {
		throwError("PNG tEXt payload must not contain NUL");
	}

	return createChunk(
		PNG_TEXT_CHUNK_TYPE,
		concatU8Arrays(assertKeyword(keyword), Uint8Array.of(0), text),
	);
}

export function createPayloadSegment(
	input: CreatePayloadSegmentInput,
): Uint8Array {
	if (input.segmentCount <= 0) {
		throwError("PNG payload segment count must be positive");
	}

	const header = new Uint8Array(PNG_PAYLOAD_HEADER_LENGTH);
	header.set(PNG_PAYLOAD_MAGIC, 0);
	header[4] = PNG_PAYLOAD_VERSION;

	let flags = 0;
	if (input.isFirst) flags |= PNG_PAYLOAD_FLAG_FIRST;
	if (input.isLast) flags |= PNG_PAYLOAD_FLAG_LAST;
	header[5] = flags;
	header.set(writeUint32BE(input.segmentIndex), 6);
	header.set(writeUint32BE(input.segmentCount), 10);
	header.set(writeUint32BE(input.payloadCrc32), 14);

	return encodeCOBS(concatU8Arrays(header, input.segmentData));
}

export function parsePayloadSegment(encoded: Uint8Array): ParsedPayloadSegment {
	const raw = decodeCOBS(encoded);

	if (raw.byteLength < PNG_PAYLOAD_HEADER_LENGTH) {
		throwError("PNG payload segment header is truncated");
	}

	const magic = raw.subarray(0, 4);
	if (!magic.every((value, index) => value === PNG_PAYLOAD_MAGIC[index])) {
		throwError("PNG payload segment magic is invalid");
	}

	const version = raw[4] ?? -1;
	if (version !== PNG_PAYLOAD_VERSION) {
		throwError("PNG payload segment version is invalid");
	}

	const flags = raw[5] ?? 0;
	const segmentIndex = readUint32BE(raw, 6);
	const segmentCount = readUint32BE(raw, 10);
	const payloadCrc32 = readUint32BE(raw, 14);

	if (segmentCount === 0) {
		throwError("PNG payload segment count must be positive");
	}

	return {
		flags,
		isFirst: (flags & PNG_PAYLOAD_FLAG_FIRST) !== 0,
		isLast: (flags & PNG_PAYLOAD_FLAG_LAST) !== 0,
		magic: magic.slice(),
		payloadCrc32,
		raw,
		segmentCount,
		segmentData: raw.subarray(PNG_PAYLOAD_HEADER_LENGTH),
		segmentIndex,
		version,
	};
}

export function isInternalTextChunk(chunk: PNGChunk): boolean {
	return (
		chunk.type === PNG_TEXT_CHUNK_TYPE &&
		parseTextChunkKeyword(chunk.data) === PNG_INTERNAL_TEXT_CHUNK_KEYWORD
	);
}

export function buildPayloadTextChunks(payload: Uint8Array): Uint8Array[] {
	const payloadCrc32 = crc32(payload);
	const segmentCount = Math.max(
		1,
		Math.ceil(payload.byteLength / PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH),
	);
	const chunks: Uint8Array[] = [];

	for (let index = 0; index < segmentCount; index++) {
		const start = index * PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH;
		const end = Math.min(
			start + PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
			payload.byteLength,
		);
		const segmentData =
			payload.byteLength === 0 ? new Uint8Array(0) : payload.slice(start, end);

		chunks.push(
			createTextChunk(
				createPayloadSegment({
					isFirst: index === 0,
					isLast: index === segmentCount - 1,
					payloadCrc32,
					segmentCount,
					segmentData,
					segmentIndex: index,
				}),
			),
		);
	}

	return chunks;
}

export function parsePNGBytes(
	bytes: Uint8Array,
	{ requireIEND = false }: ParsePNGBytesOptions = {},
): PNGChunk[] {
	if (bytes.byteLength < PNG_SIGNATURE.byteLength) {
		throwError("PNG signature is truncated");
	}

	if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
		throwError("PNG signature is invalid");
	}

	const chunks: PNGChunk[] = [];
	let offset = PNG_SIGNATURE.byteLength;
	let seenIEND = false;

	while (offset < bytes.byteLength) {
		if (bytes.byteLength - offset < 8) {
			throwError("PNG chunk header is truncated");
		}

		const length = readUint32BE(bytes, offset);
		const typeBytes = bytes.subarray(offset + 4, offset + 8);
		assertChunkTypeBytes(typeBytes);
		const type = latin1BytesToString(typeBytes);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		const crcStart = dataEnd;
		const nextOffset = crcStart + 4;

		if (nextOffset > bytes.byteLength) {
			throwError("PNG chunk data is truncated");
		}

		const data = bytes.slice(dataStart, dataEnd);
		const crc = readUint32BE(bytes, crcStart);
		const expectedCrc = crc32(concatU8Arrays(typeBytes, data));

		if (crc !== expectedCrc) {
			throwError("PNG chunk CRC mismatch");
		}

		const raw = bytes.slice(offset, nextOffset);
		chunks.push({ crc, data, length, raw, type });
		offset = nextOffset;

		if (type === PNG_IEND_CHUNK_TYPE) {
			if (length !== 0) {
				throwError("PNG IEND chunk must be empty");
			}
			if (offset !== bytes.byteLength) {
				throwError("PNG has trailing bytes after IEND");
			}
			seenIEND = true;
			break;
		}
	}

	if (requireIEND && !seenIEND) {
		throwError("PNG is missing IEND");
	}

	return chunks;
}

export function rebuildPNGWithPayload(
	sourcePNG: Uint8Array,
	payload: Uint8Array,
	onExisting: "error" | "replace",
): Uint8Array {
	const chunks = parsePNGBytes(sourcePNG, { requireIEND: true });
	const output: Uint8Array[] = [PNG_SIGNATURE];

	for (const chunk of chunks) {
		if (chunk.type === PNG_IEND_CHUNK_TYPE) {
			output.push(...buildPayloadTextChunks(payload), chunk.raw);
			continue;
		}

		if (!isInternalTextChunk(chunk)) {
			output.push(chunk.raw);
			continue;
		}

		if (onExisting === "error") {
			throwError("PNG already contains an embedded payload");
		}
	}

	return concatU8Arrays(...output);
}

export function getInternalTextChunkPayload(chunk: PNGChunk): Uint8Array {
	if (!isInternalTextChunk(chunk)) {
		throwError("PNG chunk is not an internal tEXt chunk");
	}

	return chunk.data.subarray(PNG_INTERNAL_TEXT_CHUNK_KEYWORD.length + 1);
}
