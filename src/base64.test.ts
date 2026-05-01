import { describe, expect, it } from "vitest";
import {
	Base64DecodeStream,
	Base64EncodeStream,
	decodeBase64Stream,
	decodeBase64UrlStream,
	encodeBase64Stream,
	encodeBase64UrlStream,
} from "./base64";
import {
	binaryToString,
	readAllBytes,
	readAllChunks,
	readableFromChunks,
	stringToBinary,
} from "./shared";

describe("base64", () => {
	it("encodes byte chunks across 3-byte boundaries", async () => {
		const encoded = await readAllChunks(
			readableFromChunks([
				stringToBinary("he"),
				stringToBinary("llo "),
				stringToBinary("world"),
			]).pipeThrough(new Base64EncodeStream()),
		);

		expect(encoded.join("")).toBe("aGVsbG8gd29ybGQ=");
	});

	it("encodes base64url without padding by default", async () => {
		const encoded = await readAllChunks(
			encodeBase64UrlStream(
				readableFromChunks(new Uint8Array([251, 255, 255])),
			),
		);

		expect(encoded.join("")).toBe("-___");
	});

	it("can keep base64url padding when requested", async () => {
		const encoded = await readAllChunks(
			readableFromChunks(stringToBinary("hi")).pipeThrough(
				new Base64EncodeStream({ variant: "base64url", padding: true }),
			),
		);

		expect(encoded.join("")).toBe("aGk=");
	});

	it("decodes base64 chunks across 4-character boundaries", async () => {
		const decoded = await readAllBytes(
			readableFromChunks(["aG", "Vsb", "G8gd29ybGQ="]).pipeThrough(
				new Base64DecodeStream(),
			),
		);

		expect(binaryToString(decoded)).toBe("hello world");
	});

	it("decodes base64url without padding", async () => {
		const decoded = await readAllBytes(
			decodeBase64UrlStream(readableFromChunks(["-_", "__"])),
		);

		expect(decoded).toEqual(new Uint8Array([251, 255, 255]));
	});

	it("ignores ASCII whitespace while decoding", async () => {
		const decoded = await readAllBytes(
			decodeBase64Stream(readableFromChunks(["aGVs\n", "bG8gd29y\r\nbGQ="])),
		);

		expect(binaryToString(decoded)).toBe("hello world");
	});

	it("rejects malformed base64 input", async () => {
		await expect(
			readAllBytes(decodeBase64Stream(readableFromChunks("%%%"))),
		).rejects.toThrow(SyntaxError);
	});

	it("creates encoded streams from iterables", async () => {
		const encoded = await readAllChunks(
			encodeBase64Stream([stringToBinary("hello"), stringToBinary(" world")]),
		);

		expect(encoded.join("")).toBe("aGVsbG8gd29ybGQ=");
	});
});
