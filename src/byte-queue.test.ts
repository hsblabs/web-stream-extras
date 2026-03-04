import { describe, expect, it } from "vitest";
import {
	ByteQueue,
	readAllBytes,
	readableFromChunks,
	toU8Array,
} from "./index";

describe("ByteQueue", () => {
	it("reads across chunk boundaries without losing order", () => {
		const queue = new ByteQueue();
		queue.append(toU8Array([1, 2]));
		queue.append(toU8Array([3, 4, 5]));

		expect(queue.read(4)).toEqual(toU8Array([1, 2, 3, 4]));
		expect(queue.byteLength).toBe(1);
		expect(queue.read(1)).toEqual(toU8Array([5]));
	});

	it("returns the original chunk when reading its full length", () => {
		const queue = new ByteQueue();
		const chunk = toU8Array([7, 8, 9]);
		queue.append(chunk);

		expect(queue.read(3)).toBe(chunk);
		expect(queue.byteLength).toBe(0);
	});

	it("supports partial reads followed by the remainder", () => {
		const queue = new ByteQueue();
		queue.append(toU8Array([1, 2, 3, 4]));

		expect(queue.read(2)).toEqual(toU8Array([1, 2]));
		expect(queue.read(2)).toEqual(toU8Array([3, 4]));
		expect(queue.byteLength).toBe(0);
	});

	it("rejects reads larger than the buffered payload", () => {
		const queue = new ByteQueue();
		queue.append(toU8Array([1]));

		expect(() => queue.read(2)).toThrow();
	});

	it("preserves ordering after repeated reads trigger internal compaction", () => {
		const queue = new ByteQueue();
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
