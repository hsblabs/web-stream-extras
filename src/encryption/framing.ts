import { toArrayBuffer } from "../shared/array-buffer";
import { throwError } from "../shared/error";
import { toU8Array } from "../shared/uint8array";
import {
	CURRENT_HEADER_VERSION,
	HEADER_RECORD_SIZE_OFFSET,
	HEADER_SIZE,
	HEADER_VERSION_OFFSET,
	type HeaderVersion,
	LEGACY_HEADER_VERSION,
	MAX_HEADER_RECORD_SIZE,
	TAG_LENGTH,
} from "./constants";

export interface Header {
	salt: ArrayBuffer;
	recordSize: number;
	version: HeaderVersion;
}

function assertHeaderVersion(version: number): HeaderVersion {
	if (version !== LEGACY_HEADER_VERSION && version !== CURRENT_HEADER_VERSION) {
		throwError("Unsupported header version");
	}

	return version;
}

export function createHeader(
	salt: Uint8Array,
	recordSize: number,
	version: HeaderVersion,
): Uint8Array {
	const header = toU8Array(HEADER_SIZE);
	header.set(salt);
	const view = new DataView(header.buffer);
	view.setUint32(HEADER_RECORD_SIZE_OFFSET, recordSize, false);
	view.setUint8(HEADER_VERSION_OFFSET, version);
	return header;
}

export function readHeader(buffer: Uint8Array): Header {
	if (buffer.length < HEADER_SIZE) {
		throwError("Chunk too small for reading header");
	}

	const view = new DataView(
		buffer.buffer,
		buffer.byteOffset,
		buffer.byteLength,
	);

	return {
		salt: toArrayBuffer(buffer.subarray(0, HEADER_RECORD_SIZE_OFFSET)),
		recordSize: view.getUint32(HEADER_RECORD_SIZE_OFFSET, false),
		version: assertHeaderVersion(view.getUint8(HEADER_VERSION_OFFSET)),
	};
}

export function assertRecordSize(
	recordSize: number,
	errorMessage: string,
): void {
	if (recordSize <= TAG_LENGTH + 1) {
		throwError(errorMessage);
	}
}

export function assertWritableRecordSize(recordSize: number): void {
	if (!Number.isInteger(recordSize)) {
		throwError("Record size must be an integer");
	}
	if (recordSize > MAX_HEADER_RECORD_SIZE) {
		throwError("Record size must fit in 4 bytes");
	}

	assertRecordSize(recordSize, "Record size is too small");
}

export function padRecord(
	data: Uint8Array,
	recordSize: number,
	isLast: boolean,
): Uint8Array {
	if (data.length + TAG_LENGTH >= recordSize) {
		throwError("Data too large for record size");
	}
	if (isLast) {
		const result = toU8Array(data.byteLength + 1);
		result.set(data);
		result[data.byteLength] = 2;
		return result;
	}

	const padding = toU8Array(recordSize - data.length - TAG_LENGTH);
	padding[0] = 1;
	const result = toU8Array(data.byteLength + padding.byteLength);
	result.set(data);
	result.set(padding, data.byteLength);
	return result;
}

export function removePadding(data: Uint8Array, isLast: boolean): Uint8Array {
	for (let i = data.length - 1; i >= 0; i--) {
		if (data[i] === 0) {
			continue;
		}
		if (isLast) {
			if (data[i] !== 2) {
				throwError("Delimiter of final record is not 2");
			}
		} else if (data[i] !== 1) {
			throwError("Delimiter of intermediate record is not 1");
		}
		return data.slice(0, i);
	}

	throwError("No delimiter found in record");
}
