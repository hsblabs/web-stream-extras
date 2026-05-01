import { describe, expect, it } from "vitest";
import { createByteQueue } from "./byte-queue";
import { readAllBytes, readableFromChunks } from "./index";
import { toU8Array } from "./shared/uint8array";

describe("ByteQueue", () => {
	it("reads across chunk boundaries without losing order", () => {
		const queue = createByteQueue();
		queue.append(toU8Array([1, 2]));
		queue.append(toU8Array([3, 4, 5]));

		expect(queue.read(4)).toEqual(toU8Array([1, 2, 3, 4]));
		expect(queue.byteLength).toBe(1);
		expect(queue.read(1)).toEqual(toU8Array([5]));
	});

	it("returns the original chunk when reading its full length", () => {
		const queue = createByteQueue();
		const chunk = toU8Array([7, 8, 9]);
		queue.append(chunk);

		expect(queue.read(3)).toBe(chunk);
		expect(queue.byteLength).toBe(0);
	});

	it("supports partial reads followed by the remainder", () => {
		const queue = createByteQueue();
		queue.append(toU8Array([1, 2, 3, 4]));

		expect(queue.read(2)).toEqual(toU8Array([1, 2]));
		expect(queue.read(2)).toEqual(toU8Array([3, 4]));
		expect(queue.byteLength).toBe(0);
	});

	it("rejects reads larger than the buffered payload", () => {
		const queue = createByteQueue();
		queue.append(toU8Array([1]));

		expect(() => queue.read(2)).toThrow();
	});

	it("finds a byte across chunk boundaries without flattening the queue", () => {
		const queue = createByteQueue();
		queue.append(toU8Array([1, 2]));
		queue.append(toU8Array([3, 0, 4]));

		expect(queue.indexOf(0)).toBe(3);
		expect(queue.indexOf(9)).toBe(-1);
	});

	it("discards buffered bytes without allocating a read result", () => {
		const queue = createByteQueue();
		queue.append(toU8Array([1, 2]));
		queue.append(toU8Array([3, 4, 5]));

		queue.discard(3);

		expect(queue.byteLength).toBe(2);
		expect(queue.read(2)).toEqual(toU8Array([4, 5]));
	});

	it("preserves ordering after repeated reads trigger internal compaction", () => {
		const queue = createByteQueue();
		const source = toU8Array(96);

		for (let i = 0; i < source.length; i++) {
			source[i] = i;
			queue.append(toU8Array([i]));
		}

		for (let i = 0; i < 64; i++) {
			expect(queue.read(1)).toEqual(toU8Array([i]));
		}

		expect(queue.byteLength).toBe(32);
		expect(queue.read(32)).toEqual(source.slice(64));
		expect(queue.byteLength).toBe(0);
	});

	it("creates and collects byte streams through the shared helpers", async () => {
		const stream = readableFromChunks([toU8Array([1, 2]), toU8Array([3, 4])]);

		await expect(readAllBytes(stream)).resolves.toEqual(
			toU8Array([1, 2, 3, 4]),
		);
	});
});
