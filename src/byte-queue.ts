import { throwError } from "./shared/error";
import { toU8Array } from "./shared/uint8array";

export interface ByteQueue {
	readonly byteLength: number;
	append(chunk: Uint8Array): void;
	discard(length: number): void;
	indexOf(value: number): number;
	read(length: number): Uint8Array;
}

export function createByteQueue(): ByteQueue {
	const chunks: Uint8Array[] = [];
	let head = 0;
	let byteLength = 0;

	const compact = (): void => {
		if (head === 0) return;
		if (head === chunks.length) {
			chunks.length = 0;
			head = 0;
			return;
		}
		if (head >= 32 && head * 2 >= chunks.length) {
			chunks.splice(0, head);
			head = 0;
		}
	}

	const append: ByteQueue["append"] = (chunk) => {
		const size = chunk.byteLength;
		if (size === 0) return;
		chunks.push(chunk);
		byteLength += size;
	};

	const discard: ByteQueue["discard"] = (length) => {
		if (length < 0) throwError("Length must be non-negative");
		if (length > byteLength) throwError("Length exceeds buffered data");
		if (length === 0) return;

		let remaining = length;

		while (remaining > 0) {
			const chunk = chunks[head];
			if (!chunk) {
				throwError("Buffered data is inconsistent");
			}

			if (chunk.byteLength <= remaining) {
				head++;
				remaining -= chunk.byteLength;
				continue;
			}

			chunks[head] = chunk.subarray(remaining);
			remaining = 0;
		}

		byteLength -= length;
		compact();
	}

	const indexOf: ByteQueue["indexOf"] = (value) => {
		let offset = 0;
		for (let index = head; index < chunks.length; index++) {
			const chunk = chunks[index];
			if (!chunk) {
				break;
			}

			const foundIndex = chunk.indexOf(value);
			if (foundIndex !== -1) {
				return offset + foundIndex;
			}

			offset += chunk.byteLength;
		}

		return -1;
	}

	const read: ByteQueue["read"] = (length) => {
		if (length < 0) {
			throwError("Length must be non-negative");
		}
		if (length > byteLength) {
			throwError("Length exceeds buffered data");
		}
		if (length === 0) {
			return toU8Array(0);
		}

		const firstChunk = chunks[head];
		if (firstChunk && firstChunk.byteLength === length) {
			head++;
			byteLength -= length;
			compact();
			return firstChunk;
		}

		const value = toU8Array(length);
		let offset = 0;

		while (offset < length) {
			const chunk = chunks[head];
			if (!chunk) {
				throwError("Buffered data is inconsistent");
			}

			const takeLength = Math.min(length - offset, chunk.byteLength);
			value.set(chunk.subarray(0, takeLength), offset);
			offset += takeLength;

			if (takeLength === chunk.byteLength) {
				head++;
				continue;
			}

			chunks[head] = chunk.subarray(takeLength);
		}

		byteLength -= length;
		compact();
		return value;
	}



	return {
		get byteLength(): number {
			return byteLength;
		},
		append,
		discard,
		indexOf,
		read,
	}

}
