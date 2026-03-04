import { describe, expect, it } from "vitest";
import { concatU8Arrays, toU8Array } from "./uint8array";

describe("toU8Array", () => {
	it("allocates a zero-filled array for numeric lengths", () => {
		expect(toU8Array(4)).toEqual(new Uint8Array([0, 0, 0, 0]));
	});

	it("copies array-like inputs", () => {
		expect(toU8Array([1, 2, 3])).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("copies typed-array inputs", () => {
		const source = new Uint8Array([9, 8, 7]);
		const copy = toU8Array(source);
		source[0] = 1;

		expect(copy).toEqual(new Uint8Array([9, 8, 7]));
	});

	it("creates a view for buffer inputs with offsets", () => {
		const source = new Uint8Array([1, 2, 3, 4]).buffer;
		const view = toU8Array(source, 1, 2);

		expect(view).toEqual(new Uint8Array([2, 3]));
		expect(view.buffer).toBe(source);
	});
});

describe("concatU8Arrays", () => {
	it("concatenates multiple arrays", () => {
		expect(
			concatU8Arrays(toU8Array([1, 2]), toU8Array([3]), toU8Array([4, 5])),
		).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it("handles empty input", () => {
		expect(concatU8Arrays()).toEqual(new Uint8Array(0));
	});
});
