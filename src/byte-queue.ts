import { throwError } from "./shared/error";
import { toU8Array } from "./shared/uint8array";

export class ByteQueue {
	#chunks: Uint8Array[] = [];
	#head = 0;
	#byteLength = 0;

	get byteLength(): number {
		return this.#byteLength;
	}

	append(chunk: Uint8Array): void {
		if (chunk.byteLength === 0) {
			return;
		}

		this.#chunks.push(chunk);
		this.#byteLength += chunk.byteLength;
	}

	read(length: number): Uint8Array {
		if (length < 0) {
			throwError("Length must be non-negative");
		}
		if (length > this.#byteLength) {
			throwError("Length exceeds buffered data");
		}
		if (length === 0) {
			return toU8Array(0);
		}

		const firstChunk = this.#chunks[this.#head];
		if (firstChunk && firstChunk.byteLength === length) {
			this.#head++;
			this.#byteLength -= length;
			this.#compact();
			return firstChunk;
		}

		const value = toU8Array(length);
		let offset = 0;

		while (offset < length) {
			const chunk = this.#chunks[this.#head];
			if (!chunk) {
				throwError("Buffered data is inconsistent");
			}

			const takeLength = Math.min(length - offset, chunk.byteLength);
			value.set(chunk.subarray(0, takeLength), offset);
			offset += takeLength;

			if (takeLength === chunk.byteLength) {
				this.#head++;
				continue;
			}

			this.#chunks[this.#head] = chunk.subarray(takeLength);
		}

		this.#byteLength -= length;
		this.#compact();
		return value;
	}

	#compact(): void {
		if (this.#head === 0) return;
		if (this.#head === this.#chunks.length) {
			this.#chunks = [];
			this.#head = 0;
			return;
		}
		if (this.#head >= 32 && this.#head * 2 >= this.#chunks.length) {
			this.#chunks = this.#chunks.slice(this.#head);
			this.#head = 0;
		}
	}
}
