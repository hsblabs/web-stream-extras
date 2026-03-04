import { describe, expect, it } from "vitest";
import { throwError } from "./error";

describe("throwError", () => {
	it("throws an Error with the provided message", () => {
		expect(() => throwError("boom")).toThrow("boom");
	});
});
