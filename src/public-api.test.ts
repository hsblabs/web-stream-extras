import { describe, expect, it } from "vitest";
import * as base64Api from "./base64";
import * as rootApi from "./index";
import * as jsonlApi from "./jsonl";
import * as textApi from "./text";

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

describe("jsonl public API", () => {
	it("only exports the supported JSONL stream helpers", () => {
		expect(Object.keys(jsonlApi).sort()).toEqual([
			"JSONLEncodeStream",
			"JSONLParseError",
			"JSONLParseStream",
			"JSONLStringifyStream",
			"encodeJSONLStream",
			"parseJSONLStream",
			"stringifyJSONLStream",
		]);
	});
});

describe("text public API", () => {
	it("only exports the supported text stream helpers", () => {
		expect(Object.keys(textApi).sort()).toEqual([
			"LineJoinStream",
			"LineSplitStream",
			"TextDecodeStream",
			"TextEncodeStream",
			"decodeTextStream",
			"encodeTextStream",
			"joinLinesStream",
			"splitLinesStream",
		]);
	});
});

describe("base64 public API", () => {
	it("only exports the supported base64 stream helpers", () => {
		expect(Object.keys(base64Api).sort()).toEqual([
			"Base64DecodeStream",
			"Base64EncodeStream",
			"decodeBase64Stream",
			"decodeBase64UrlStream",
			"encodeBase64Stream",
			"encodeBase64UrlStream",
		]);
	});
});
