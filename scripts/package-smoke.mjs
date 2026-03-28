import assert from "node:assert/strict";

import * as rootApi from "@hsblabs/web-stream-extras";
import * as cobsApi from "@hsblabs/web-stream-extras/cobs";
import * as encryptionApi from "@hsblabs/web-stream-extras/encryption";
import * as pngApi from "@hsblabs/web-stream-extras/png";

assert.deepEqual(Object.keys(rootApi).sort(), [
	"binaryToString",
	"randomBytes",
	"readAllBytes",
	"readAllChunks",
	"readableFromChunks",
	"stringToBinary",
]);

assert.deepEqual(Object.keys(cobsApi).sort(), [
	"createCOBSDecoderStream",
	"createCOBSEncoderStream",
	"decodeCOBSFrame",
	"encodeCOBSFrame",
	"readCOBS",
	"writeCOBS",
]);

assert.deepEqual(Object.keys(encryptionApi).sort(), [
	"DecryptionStream",
	"EncryptionStream",
	"decryptStream",
	"encryptStream",
	"webCryptoStream",
]);

assert.deepEqual(Object.keys(pngApi).sort(), [
	"createPNGTextChunkWriter",
	"extractPNGTextChunk",
	"streamPNGTextChunk",
]);

const frame = Uint8Array.of(0x11, 0x00, 0x22);
const encoded = cobsApi.encodeCOBSFrame(frame);

assert.deepEqual(
	Array.from(cobsApi.decodeCOBSFrame(encoded)),
	Array.from(frame),
);
assert.equal(
	typeof rootApi.readableFromChunks([Uint8Array.of(1)]).getReader,
	"function",
);
assert.equal(typeof encryptionApi.encryptStream, "function");
assert.equal(typeof pngApi.streamPNGTextChunk, "function");

process.stdout.write("package smoke test passed\n");
