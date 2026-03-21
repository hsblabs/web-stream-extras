import { describe, expect, it } from "vitest";
import * as rootApi from "./index";

describe("root public API", () => {
	it("only exports the supported high-level helpers", () => {
		expect(Object.keys(rootApi).sort()).toEqual([
			"binaryToString",
			"randomBytes",
			"readAllBytes",
			"readAllChunks",
			"readableFromChunks",
			"stringToBinary",
		]);
	});
});
