import { describe, expect, it } from "vitest";
import { toArrayBuffer } from "./array-buffer";
import { toU8Array } from "./uint8array";

describe("toArrayBuffer", () => {
	it("returns ArrayBuffer inputs as-is", () => {
		const source = new ArrayBuffer(4);

		expect(toArrayBuffer(source)).toBe(source);
	});

	it("slices Uint8Array views into standalone ArrayBuffers", () => {
		const backing = new ArrayBuffer(8);
		const view = new Uint8Array(backing, 2, 3);
		view.set([4, 5, 6]);
		const result = toArrayBuffer(view);

		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(result).not.toBe(backing);
		expect(toU8Array(result)).toEqual(new Uint8Array([4, 5, 6]));
	});

	it("copies SharedArrayBuffer-backed views into ArrayBuffers", () => {
		const backing = new SharedArrayBuffer(4);
		const view = toU8Array(backing);
		view.set([7, 8, 9, 10]);
		const result = toArrayBuffer(view);

		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(toU8Array(result)).toEqual(new Uint8Array([7, 8, 9, 10]));
	});
});
