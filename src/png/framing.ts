import { decodeCOBSFrame, encodeCOBSFrame } from "../cobs/public";
import { throwError } from "../shared/error";
import { concatU8Arrays } from "../shared/uint8array";
import {
	PNG_IEND_CHUNK_TYPE,
	PNG_INTERNAL_TEXT_CHUNK_KEYWORD,
	PNG_PAYLOAD_DATA_HEADER_LENGTH,
	PNG_PAYLOAD_MAGIC,
	PNG_PAYLOAD_MANIFEST_HEADER_LENGTH,
	PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
	PNG_PAYLOAD_SEGMENT_KIND_DATA,
	PNG_PAYLOAD_SEGMENT_KIND_MANIFEST,
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

export interface CreatePayloadDataSegmentInput {
	segmentData: Uint8Array;
	segmentIndex: number;
}

export interface CreatePayloadManifestSegmentInput {
	payloadCrc32: number;
	segmentCount: number;
}

interface ParsedPayloadSegmentBase {
	kind: "data" | "manifest";
	magic: Uint8Array;
	raw: Uint8Array;
	version: number;
}

export interface ParsedPayloadDataSegment extends ParsedPayloadSegmentBase {
	kind: "data";
	segmentData: Uint8Array;
	segmentIndex: number;
}

export interface ParsedPayloadManifestSegment extends ParsedPayloadSegmentBase {
	kind: "manifest";
	payloadCrc32: number;
	segmentCount: number;
}

export type ParsedPayloadSegment =
	| ParsedPayloadDataSegment
	| ParsedPayloadManifestSegment;

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

export function assertPNGSignature(signature: Uint8Array): void {
	if (signature.byteLength < PNG_SIGNATURE.byteLength) {
		throwError("PNG signature is truncated");
	}

	if (!PNG_SIGNATURE.every((value, index) => signature[index] === value)) {
		throwError("PNG signature is invalid");
	}
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

export function createPayloadDataSegment(
	input: CreatePayloadDataSegmentInput,
): Uint8Array {
	const header = new Uint8Array(PNG_PAYLOAD_DATA_HEADER_LENGTH);
	header.set(PNG_PAYLOAD_MAGIC, 0);
	header[4] = PNG_PAYLOAD_VERSION;
	header[5] = PNG_PAYLOAD_SEGMENT_KIND_DATA;
	header.set(writeUint32BE(input.segmentIndex), 6);

	return encodeCOBSFrame(concatU8Arrays(header, input.segmentData));
}

export function createPayloadManifestSegment(
	input: CreatePayloadManifestSegmentInput,
): Uint8Array {
	const header = new Uint8Array(PNG_PAYLOAD_MANIFEST_HEADER_LENGTH);
	header.set(PNG_PAYLOAD_MAGIC, 0);
	header[4] = PNG_PAYLOAD_VERSION;
	header[5] = PNG_PAYLOAD_SEGMENT_KIND_MANIFEST;
	header.set(writeUint32BE(input.segmentCount), 6);
	header.set(writeUint32BE(input.payloadCrc32), 10);

	return encodeCOBSFrame(header);
}

export function parsePayloadSegment(encoded: Uint8Array): ParsedPayloadSegment {
	const raw = decodeCOBSFrame(encoded);

	if (raw.byteLength < PNG_PAYLOAD_DATA_HEADER_LENGTH) {
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

	const kind = raw[5];
	if (kind === PNG_PAYLOAD_SEGMENT_KIND_DATA) {
		return {
			kind: "data",
			magic: magic.slice(),
			raw,
			segmentData: raw.subarray(PNG_PAYLOAD_DATA_HEADER_LENGTH),
			segmentIndex: readUint32BE(raw, 6),
			version,
		};
	}

	if (kind === PNG_PAYLOAD_SEGMENT_KIND_MANIFEST) {
		if (raw.byteLength !== PNG_PAYLOAD_MANIFEST_HEADER_LENGTH) {
			throwError("PNG payload manifest header is invalid");
		}

		return {
			kind: "manifest",
			magic: magic.slice(),
			payloadCrc32: readUint32BE(raw, 10),
			raw,
			segmentCount: readUint32BE(raw, 6),
			version,
		};
	}

	throwError("PNG payload segment kind is invalid");
}

export function isInternalTextChunk(chunk: PNGChunk): boolean {
	return (
		chunk.type === PNG_TEXT_CHUNK_TYPE &&
		parseTextChunkKeyword(chunk.data) === PNG_INTERNAL_TEXT_CHUNK_KEYWORD
	);
}

export function buildPayloadTextChunks(payload: Uint8Array): Uint8Array[] {
	const payloadCrc32 = crc32(payload);
	const segmentCount = Math.ceil(
		payload.byteLength / PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
	);
	const chunks: Uint8Array[] = [];

	for (let index = 0; index < segmentCount; index++) {
		const start = index * PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH;
		const end = Math.min(
			start + PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH,
			payload.byteLength,
		);
		const segmentData = payload.slice(start, end);

		chunks.push(
			createTextChunk(
				createPayloadDataSegment({
					segmentData,
					segmentIndex: index,
				}),
			),
		);
	}

	chunks.push(
		createTextChunk(
			createPayloadManifestSegment({
				payloadCrc32,
				segmentCount,
			}),
		),
	);

	return chunks;
}

export interface PNGChunkHeader {
	length: number;
	type: string;
}

export function parsePNGChunkHeader(headerBytes: Uint8Array): PNGChunkHeader {
	if (headerBytes.byteLength < 8) {
		throwError("PNG chunk header is truncated");
	}

	const typeBytes = headerBytes.subarray(4, 8);
	assertChunkTypeBytes(typeBytes);
	return {
		length: readUint32BE(headerBytes, 0),
		type: latin1BytesToString(typeBytes),
	};
}

export function parsePNGChunk(raw: Uint8Array): PNGChunk {
	if (raw.byteLength < 12) {
		throwError("PNG chunk header is truncated");
	}

	const { length, type } = parsePNGChunkHeader(raw.subarray(0, 8));
	const dataStart = 8;
	const dataEnd = dataStart + length;
	const crcStart = dataEnd;
	const nextOffset = crcStart + 4;

	if (nextOffset !== raw.byteLength) {
		throwError("PNG chunk data is truncated");
	}

	const typeBytes = raw.subarray(4, 8);
	const data = raw.slice(dataStart, dataEnd);
	const crc = readUint32BE(raw, crcStart);
	const expectedCrc = crc32(concatU8Arrays(typeBytes, data));

	if (crc !== expectedCrc) {
		throwError("PNG chunk CRC mismatch");
	}

	return { crc, data, length, raw, type };
}

export function parsePNGBytes(
	bytes: Uint8Array,
	{ requireIEND = false }: ParsePNGBytesOptions = {},
): PNGChunk[] {
	assertPNGSignature(bytes);

	const chunks: PNGChunk[] = [];
	let offset = PNG_SIGNATURE.byteLength;
	let seenIEND = false;

	while (offset < bytes.byteLength) {
		const header = parsePNGChunkHeader(bytes.subarray(offset, offset + 8));
		const nextOffset = offset + 8 + header.length + 4;
		if (nextOffset > bytes.byteLength) {
			throwError("PNG chunk data is truncated");
		}

		const chunk = parsePNGChunk(bytes.slice(offset, nextOffset));
		chunks.push(chunk);
		offset = nextOffset;

		if (chunk.type === PNG_IEND_CHUNK_TYPE) {
			if (chunk.length !== 0) {
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
