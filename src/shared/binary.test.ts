import { describe, expect, it } from "vitest";
import { binaryToString, randomBytes, stringToBinary } from "./binary";

describe("stringToBinary / binaryToString", () => {
	it("round-trips ASCII strings", () => {
		const input = "Hello, World!";
		expect(binaryToString(stringToBinary(input))).toBe(input);
	});

	it("round-trips UTF-8 strings", () => {
		const input = "こんにちは世界 🌍";
		expect(binaryToString(stringToBinary(input))).toBe(input);
	});

	it("encodes text as UTF-8 bytes", () => {
		expect(stringToBinary("hello")).toEqual(
			new Uint8Array([104, 101, 108, 108, 111]),
		);
	});
});

describe("randomBytes", () => {
	it("returns the requested byte length", () => {
		expect(randomBytes(8)).toHaveLength(8);
	});

	it("returns different values across calls", () => {
		expect(randomBytes(8)).not.toEqual(randomBytes(8));
	});
});
