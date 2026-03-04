import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "./base64url";

describe("encodeBase64Url / decodeBase64Url", () => {
	it("round-trips binary payloads", () => {
		const input = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);

		expect(decodeBase64Url(encodeBase64Url(input))).toEqual(input);
	});

	it("omits padding and uses URL-safe characters", () => {
		expect(encodeBase64Url(new Uint8Array([251, 255, 255]))).toBe("-___");
	});

	it("rejects malformed values", () => {
		expect(() => decodeBase64Url("%%%")).toThrow(
			"Encrypted stream key is not valid base64url",
		);
	});
});
