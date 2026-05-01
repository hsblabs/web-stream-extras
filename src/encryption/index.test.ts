import { describe, expect, it } from "vitest";
import {
	binaryToString,
	randomBytes,
	readAllBytes,
	readableFromChunks,
	stringToBinary,
} from "../shared";
import { HEADER_SIZE, TAG_LENGTH } from "./constants";
import {
	DecryptionStream,
	decryptStream,
	EncryptionStream,
	encryptStream,
	webCryptoStream,
} from "./index";

const TEST_RECORD_SIZE = 64;
const TEST_RECORD_PAYLOAD_SIZE = TEST_RECORD_SIZE - 17;
const RECORD_SIZE_OFFSET = 16;
const LEGACY_HEADER_VERSION = 0;
const CURRENT_HEADER_VERSION = 1;
const LEGACY_HKDF_REGRESSION_HEX =
	"02020202020202020202020202020202000000400005180b45e3b13289fac671612e89193af3171f7b88545cfbb1799344fd1246aa";
const CURRENT_HKDF_REGRESSION_HEX =
	"02020202020202020202020202020202000000400117622b6ec9508795731510da0f41918a098ba0ba37908f1f345b549e3979dc8f";

function splitBytes(data: Uint8Array, sizes: number[]): Uint8Array[] {
	const chunks: Uint8Array[] = [];
	let offset = 0;

	for (const size of sizes) {
		if (offset >= data.byteLength) {
			break;
		}
		chunks.push(data.slice(offset, offset + size));
		offset += size;
	}

	if (offset < data.byteLength) {
		chunks.push(data.slice(offset));
	}

	return chunks;
}

function splitIntoSingleBytes(data: Uint8Array): Uint8Array[] {
	return Array.from(data, (value) => new Uint8Array([value]));
}

function setRecordSize(ciphertext: Uint8Array, recordSize: number): Uint8Array {
	const mutated = ciphertext.slice();
	const view = new DataView(
		mutated.buffer,
		mutated.byteOffset,
		mutated.byteLength,
	);
	view.setUint32(RECORD_SIZE_OFFSET, recordSize, false);
	return mutated;
}

function flipByte(ciphertext: Uint8Array, index: number): Uint8Array {
	const mutated = ciphertext.slice();
	mutated[index] ^= 0xff;
	return mutated;
}

function withTrailingByte(ciphertext: Uint8Array, value = 0xff): Uint8Array {
	const mutated = new Uint8Array(ciphertext.byteLength + 1);
	mutated.set(ciphertext);
	mutated[mutated.byteLength - 1] = value;
	return mutated;
}

function toHex(data: Uint8Array): string {
	return Array.from(data)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function fromHex(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function createDeterministicRng(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (state * 1_664_525 + 1_013_904_223) >>> 0;
		return state;
	};
}

function createDeterministicBytes(
	length: number,
	nextRandom: () => number,
): Uint8Array {
	const bytes = new Uint8Array(length);

	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = nextRandom() & 0xff;
	}

	return bytes;
}

function createChunkPlan(
	length: number,
	nextRandom: () => number,
	maxChunkSize: number,
): number[] {
	const sizes: number[] = [];
	let remaining = length;

	while (remaining > 0) {
		const size = Math.min((nextRandom() % maxChunkSize) + 1, remaining);
		sizes.push(size);
		remaining -= size;
	}

	return sizes;
}

function createFuzzChunks(
	data: Uint8Array,
	nextRandom: () => number,
	maxChunkSize: number,
): Uint8Array[] {
	return splitBytes(
		data,
		createChunkPlan(data.byteLength, nextRandom, maxChunkSize),
	);
}

async function encryptFixture(
	encKey: Uint8Array,
	plaintext: Uint8Array,
	chunks: Uint8Array | Uint8Array[],
): Promise<Uint8Array> {
	const salt = new Uint8Array(16).fill(7);
	salt[salt.length - 1] = plaintext.byteLength & 0xff;

	return readAllBytes(
		encryptStream(encKey, readableFromChunks(chunks), {
			recordSize: TEST_RECORD_SIZE,
			salt,
		}),
	);
}

async function createMasterKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
		"encrypt",
		"decrypt",
	]);
}

describe("encryption", () => {
	it("creates encrypted stream keys with webCryptoStream", async () => {
		const cryptoStream = webCryptoStream(await createMasterKey());
		const key1 = await cryptoStream.createStreamKey();
		const key2 = await cryptoStream.createStreamKey();

		expect(typeof key1).toBe("string");
		expect(key1).not.toBe(key2);
	});

	it("round-trips using webCryptoStream", async () => {
		const cryptoStream = webCryptoStream(await createMasterKey());
		const encryptedStreamKey = await cryptoStream.createStreamKey();
		const plaintext = stringToBinary("wrapped stream payload");
		const encrypted = await readAllBytes(
			await cryptoStream.encrypt(
				encryptedStreamKey,
				readableFromChunks(splitBytes(plaintext, [4, 3, 2, 1])),
				{
					recordSize: TEST_RECORD_SIZE,
					salt: new Uint8Array(16).fill(5),
				},
			),
		);
		const decrypted = await readAllBytes(
			await cryptoStream.decrypt(
				encryptedStreamKey,
				readableFromChunks(splitBytes(encrypted, [7, 5, 3])),
			),
		);

		expect(binaryToString(decrypted)).toBe("wrapped stream payload");
	});

	it("fails to unwrap an encrypted stream key with the wrong master key", async () => {
		const source = webCryptoStream(await createMasterKey());
		const target = webCryptoStream(await createMasterKey());
		const encryptedStreamKey = await source.createStreamKey();

		await expect(
			target.encrypt(
				encryptedStreamKey,
				readableFromChunks(stringToBinary("mismatch")),
			),
		).rejects.toThrow();
	});

	it("rejects a master key that does not use AES-GCM", async () => {
		const masterKey = await crypto.subtle.generateKey(
			{ name: "AES-KW", length: 256 },
			false,
			["wrapKey", "unwrapKey"],
		);

		expect(() => webCryptoStream(masterKey)).toThrow();
	});

	it("round-trips text with stream classes", { timeout: 30_000 }, async () => {
		const encKey = randomBytes(32);
		const plaintext = stringToBinary("Hello, stream codec world!");
		const encrypted = await readAllBytes(
			readableFromChunks(splitBytes(plaintext, [5, 4, 3, 2])).pipeThrough(
				new EncryptionStream(encKey, {
					recordSize: TEST_RECORD_SIZE,
					salt: new Uint8Array(16).fill(7),
				}),
			),
		);

		const decrypted = await readAllBytes(
			readableFromChunks(splitBytes(encrypted, [3, 2, 11, 5])).pipeThrough(
				new DecryptionStream(encKey),
			),
		);

		expect(binaryToString(decrypted)).toBe("Hello, stream codec world!");
	});

	it("round-trips multi-record binary data with helper functions", async () => {
		const encKey = randomBytes(32);
		const plaintext = randomBytes(250);
		const encrypted = await readAllBytes(
			encryptStream(
				encKey,
				readableFromChunks(splitBytes(plaintext, [9, 7, 5, 3, 1])),
				{
					recordSize: TEST_RECORD_SIZE,
					salt: new Uint8Array(16).fill(3),
				},
			),
		);

		const decrypted = await readAllBytes(
			decryptStream(
				encKey,
				readableFromChunks(splitBytes(encrypted, [8, 6, 4])),
			),
		);

		expect(decrypted).toEqual(plaintext);
	});

	it("fails to decrypt with the wrong encKey", async () => {
		const plaintext = stringToBinary("secret message");
		const encrypted = await readAllBytes(
			encryptStream(randomBytes(32), readableFromChunks(plaintext), {
				recordSize: TEST_RECORD_SIZE,
				salt: new Uint8Array(16).fill(1),
			}),
		);

		const decrypted = decryptStream(
			randomBytes(32),
			readableFromChunks(splitBytes(encrypted, [4, 4, 4])),
		);

		await expect(readAllBytes(decrypted)).rejects.toThrow();
	});

	it("fails on truncated headers", async () => {
		const decrypted = decryptStream(
			randomBytes(32),
			readableFromChunks(new Uint8Array([1, 2, 3])),
		);

		await expect(readAllBytes(decrypted)).rejects.toThrow();
	});

	it("builds the encryption header from EncryptionStream options", async () => {
		const encKey = randomBytes(32);
		const salt = new Uint8Array(16).fill(9);
		const encrypted = await readAllBytes(
			encryptStream(encKey, readableFromChunks(new Uint8Array(0)), {
				recordSize: TEST_RECORD_SIZE,
				salt,
			}),
		);

		const view = new DataView(
			encrypted.buffer,
			encrypted.byteOffset,
			encrypted.byteLength,
		);

		expect(encrypted).toHaveLength(HEADER_SIZE);
		expect(encrypted.slice(0, RECORD_SIZE_OFFSET)).toEqual(salt);
		expect(view.getUint32(RECORD_SIZE_OFFSET, false)).toBe(TEST_RECORD_SIZE);
		expect(encrypted[HEADER_SIZE - 1]).toBe(CURRENT_HEADER_VERSION);
	});

	it("decrypts legacy header version 0 ciphertext", async () => {
		const encKey = new Uint8Array(32).fill(1);
		const encrypted = fromHex(LEGACY_HKDF_REGRESSION_HEX);
		const decrypted = await readAllBytes(
			decryptStream(encKey, readableFromChunks(encrypted)),
		);

		expect(encrypted[HEADER_SIZE - 1]).toBe(LEGACY_HEADER_VERSION);
		expect(binaryToString(decrypted)).toBe("hkdf-regression");
	});

	it("uses the current key schedule for deterministic ciphertext", async () => {
		const encKey = new Uint8Array(32).fill(1);
		const salt = new Uint8Array(16).fill(2);
		const plaintext = stringToBinary("hkdf-regression");
		const encrypted = await readAllBytes(
			encryptStream(encKey, readableFromChunks(plaintext), {
				recordSize: TEST_RECORD_SIZE,
				salt,
			}),
		);

		expect(encrypted[HEADER_SIZE - 1]).toBe(CURRENT_HEADER_VERSION);
		expect(toHex(encrypted)).toBe(CURRENT_HKDF_REGRESSION_HEX);
		expect(CURRENT_HKDF_REGRESSION_HEX).not.toBe(LEGACY_HKDF_REGRESSION_HEX);
	});

	it("rejects unsupported header versions", async () => {
		const encrypted = fromHex(LEGACY_HKDF_REGRESSION_HEX);
		encrypted[HEADER_SIZE - 1] = 0xff;

		await expect(
			readAllBytes(
				decryptStream(
					new Uint8Array(32).fill(1),
					readableFromChunks(encrypted),
				),
			),
		).rejects.toThrow();
	});

	it("round-trips empty plaintext", async () => {
		const encKey = randomBytes(32);
		const encrypted = await encryptFixture(encKey, new Uint8Array(0), []);
		const decrypted = await readAllBytes(
			decryptStream(
				encKey,
				readableFromChunks(splitIntoSingleBytes(encrypted)),
			),
		);

		expect(decrypted).toEqual(new Uint8Array(0));
	});

	it("round-trips boundary-sized payloads", async () => {
		const encKey = randomBytes(32);

		for (const size of [
			TEST_RECORD_PAYLOAD_SIZE - 1,
			TEST_RECORD_PAYLOAD_SIZE,
			TEST_RECORD_PAYLOAD_SIZE + 1,
		]) {
			const plaintext = new Uint8Array(size).fill(size);
			const encrypted = await encryptFixture(
				encKey,
				plaintext,
				splitIntoSingleBytes(plaintext),
			);
			const decrypted = await readAllBytes(
				decryptStream(
					encKey,
					readableFromChunks(splitIntoSingleBytes(encrypted)),
				),
			);

			expect(decrypted).toEqual(plaintext);
		}
	});

	it("round-trips when both sides are split into single-byte chunks", async () => {
		const encKey = randomBytes(32);
		const plaintext = randomBytes(95);
		const encrypted = await encryptFixture(
			encKey,
			plaintext,
			splitIntoSingleBytes(plaintext),
		);
		const decrypted = await readAllBytes(
			readableFromChunks(splitIntoSingleBytes(encrypted)).pipeThrough(
				new DecryptionStream(encKey),
			),
		);

		expect(decrypted).toEqual(plaintext);
	});

	it("fails when a plausible but wrong record size is injected into the header", async () => {
		const encKey = randomBytes(32);
		const plaintext = randomBytes(TEST_RECORD_PAYLOAD_SIZE * 2 + 6);
		const encrypted = await encryptFixture(encKey, plaintext, plaintext);
		const tampered = setRecordSize(encrypted, TEST_RECORD_SIZE - 1);

		await expect(
			readAllBytes(
				decryptStream(
					encKey,
					readableFromChunks(splitIntoSingleBytes(tampered)),
				),
			),
		).rejects.toThrow();
	});

	it("fails when ciphertext bytes are tampered after the header", async () => {
		const encKey = randomBytes(32);
		const plaintext = randomBytes(TEST_RECORD_PAYLOAD_SIZE * 2 + 3);
		const encrypted = await encryptFixture(encKey, plaintext, plaintext);
		const tampered = flipByte(encrypted, Math.floor(encrypted.byteLength / 2));

		await expect(
			readAllBytes(
				decryptStream(
					encKey,
					readableFromChunks(splitIntoSingleBytes(tampered)),
				),
			),
		).rejects.toThrow();
	});

	it("fails when the final record is truncated", async () => {
		const encKey = randomBytes(32);
		const plaintext = randomBytes(TEST_RECORD_PAYLOAD_SIZE + 9);
		const encrypted = await encryptFixture(encKey, plaintext, plaintext);
		const truncated = encrypted.slice(0, -1);

		await expect(
			readAllBytes(
				decryptStream(
					encKey,
					readableFromChunks(splitIntoSingleBytes(truncated)),
				),
			),
		).rejects.toThrow();
	});

	it("fails when trailing garbage is appended to an otherwise valid ciphertext", async () => {
		const encKey = randomBytes(32);
		const plaintext = randomBytes(TEST_RECORD_PAYLOAD_SIZE - 3);
		const encrypted = await encryptFixture(encKey, plaintext, plaintext);
		const tampered = withTrailingByte(encrypted);

		await expect(
			readAllBytes(
				decryptStream(
					encKey,
					readableFromChunks(splitIntoSingleBytes(tampered)),
				),
			),
		).rejects.toThrow();
	});

	it("rejects invalid record sizes before encryption starts", () => {
		const encKey = randomBytes(32);

		expect(
			() =>
				new EncryptionStream(encKey, {
					recordSize: TAG_LENGTH + 1,
					salt: new Uint8Array(16).fill(1),
				}),
		).toThrow();
	});

	it("rejects non-integer record sizes before encryption starts", () => {
		const encKey = randomBytes(32);

		expect(
			() =>
				new EncryptionStream(encKey, {
					recordSize: TEST_RECORD_SIZE + 0.5,
					salt: new Uint8Array(16).fill(1),
				}),
		).toThrow();
	});

	it("rejects record sizes that do not fit in the 4-byte header", () => {
		const encKey = randomBytes(32);

		expect(
			() =>
				new EncryptionStream(encKey, {
					recordSize: 0x1_0000_0000,
					salt: new Uint8Array(16).fill(1),
				}),
		).toThrow();
	});

	it("rejects salts that do not match the header format", () => {
		const encKey = randomBytes(32);

		expect(
			() =>
				new EncryptionStream(encKey, {
					recordSize: TEST_RECORD_SIZE,
					salt: new Uint8Array(15).fill(1),
				}),
		).toThrow();
	});

	it("round-trips across deterministic chunk fuzz cases", async () => {
		const nextRandom = createDeterministicRng(0xc0de_2026);

		for (let i = 0; i < 12; i++) {
			const encKey = createDeterministicBytes(32, nextRandom);
			const plaintext = createDeterministicBytes(
				nextRandom() % (TEST_RECORD_PAYLOAD_SIZE * 3 + 5),
				nextRandom,
			);
			const encrypted = await encryptFixture(
				encKey,
				plaintext,
				createFuzzChunks(plaintext, nextRandom, 11),
			);
			const decrypted = await readAllBytes(
				decryptStream(
					encKey,
					readableFromChunks(createFuzzChunks(encrypted, nextRandom, 7)),
				),
			);

			expect(decrypted).toEqual(plaintext);
		}
	});

	it("fails across deterministic tamper fuzz cases", async () => {
		const nextRandom = createDeterministicRng(0x5eed_2026);

		for (let i = 0; i < 12; i++) {
			const encKey = createDeterministicBytes(32, nextRandom);
			const plaintext = createDeterministicBytes(
				TEST_RECORD_PAYLOAD_SIZE +
					1 +
					(nextRandom() % (TEST_RECORD_PAYLOAD_SIZE * 2)),
				nextRandom,
			);
			const encrypted = await encryptFixture(
				encKey,
				plaintext,
				createFuzzChunks(plaintext, nextRandom, 13),
			);
			const tamperIndex =
				HEADER_SIZE + (nextRandom() % (encrypted.byteLength - HEADER_SIZE));
			const tampered = flipByte(encrypted, tamperIndex);

			await expect(
				readAllBytes(
					decryptStream(
						encKey,
						readableFromChunks(createFuzzChunks(tampered, nextRandom, 9)),
					),
				),
			).rejects.toThrow();
		}
	});
});
