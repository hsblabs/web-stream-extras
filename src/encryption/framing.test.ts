import { describe, expect, it } from "vitest";
import { removePadding } from "./framing";

describe("encryption framing", () => {
	it("returns a view for normally padded records", () => {
		const record = new Uint8Array([5, 6, 2, 0]);

		const payload = removePadding(record, true);

		expect(payload).toEqual(new Uint8Array([5, 6]));
		expect(payload.buffer).toBe(record.buffer);
	});

	it("copies small payloads out of heavily padded records", () => {
		const record = new Uint8Array([5, 2, 0, 0, 0, 0]);

		const payload = removePadding(record, true);

		expect(payload).toEqual(new Uint8Array([5]));
		expect(payload.buffer).not.toBe(record.buffer);
	});

	it("preserves delimiter validation", () => {
		expect(() => removePadding(new Uint8Array([5, 1]), true)).toThrow(
			"Delimiter of final record is not 2",
		);
		expect(() => removePadding(new Uint8Array(4), false)).toThrow(
			"No delimiter found in record",
		);
	});
});
