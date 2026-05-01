import { toArrayBuffer } from "../shared/array-buffer";
import { decodeBase64Url, encodeBase64Url } from "../shared/base64url";
import { randomBytes } from "../shared/binary";
import { throwError } from "../shared/error";
import type { BinaryReadableStream } from "../shared/stream";
import { ByteTransformStream } from "../shared/stream";
import { concatU8Arrays, toU8Array } from "../shared/uint8array";
import {
	AES_GCM_BIT_LENGTH,
	ALGORITHM_AES_GCM,
	CURRENT_HEADER_VERSION,
	ECE_RECORD_SIZE,
	KEY_LENGTH,
} from "./constants";
import { DecryptionTransformer, EncryptionTransformer } from "./transformers";

const MASTER_KEY_IV_LENGTH = 12;
const STREAM_KEY_LENGTH = 32;

export interface EncryptionStreamOptions {
	recordSize?: number;
	salt?: Uint8Array;
}

export interface WebCryptoStream {
	createStreamKey(): Promise<string>;
	decrypt(
		encryptedStreamKey: string,
		input: BinaryReadableStream,
	): Promise<BinaryReadableStream>;
	encrypt(
		encryptedStreamKey: string,
		input: BinaryReadableStream,
		options?: EncryptionStreamOptions,
	): Promise<BinaryReadableStream>;
}

export class EncryptionStream extends ByteTransformStream {
	constructor(
		encKey: Uint8Array,
		{
			recordSize = ECE_RECORD_SIZE,
			salt = randomBytes(KEY_LENGTH),
		}: EncryptionStreamOptions = {},
	) {
		super(
			new EncryptionTransformer(encKey, {
				recordSize,
				salt,
				version: CURRENT_HEADER_VERSION,
			}),
		);
	}
}

export class DecryptionStream extends ByteTransformStream {
	constructor(encKey: Uint8Array) {
		super(new DecryptionTransformer(encKey));
	}
}

export function encryptStream(
	encKey: Uint8Array,
	input: BinaryReadableStream,
	options?: EncryptionStreamOptions,
): BinaryReadableStream {
	return input.pipeThrough(new EncryptionStream(encKey, options));
}

export function decryptStream(
	encKey: Uint8Array,
	input: BinaryReadableStream,
): BinaryReadableStream {
	return input.pipeThrough(new DecryptionStream(encKey));
}

function createMasterKeyParams(iv: Uint8Array): AesGcmParams {
	return {
		name: ALGORITHM_AES_GCM,
		iv: toArrayBuffer(iv),
		tagLength: AES_GCM_BIT_LENGTH,
	};
}

function assertMasterKey(masterKey: CryptoKey): void {
	if (masterKey.algorithm.name !== ALGORITHM_AES_GCM) {
		throwError("Master key must use AES-GCM");
	}
	if (!masterKey.usages.includes("encrypt")) {
		throwError("Master key must allow encrypt");
	}
	if (!masterKey.usages.includes("decrypt")) {
		throwError("Master key must allow decrypt");
	}
}

async function encryptStreamKey(
	masterKey: CryptoKey,
	streamKey: Uint8Array,
): Promise<string> {
	const iv = randomBytes(MASTER_KEY_IV_LENGTH);
	const cipher = await crypto.subtle.encrypt(
		createMasterKeyParams(iv),
		masterKey,
		toArrayBuffer(streamKey),
	);

	return encodeBase64Url(concatU8Arrays(iv, toU8Array(cipher)));
}

async function decryptStreamKey(
	masterKey: CryptoKey,
	encryptedStreamKey: string,
): Promise<Uint8Array> {
	const payload = decodeBase64Url(encryptedStreamKey);

	if (payload.byteLength <= MASTER_KEY_IV_LENGTH) {
		throwError("Encrypted stream key payload is too small");
	}

	const iv = payload.subarray(0, MASTER_KEY_IV_LENGTH);
	const ciphertext = payload.subarray(MASTER_KEY_IV_LENGTH);
	const streamKey = toU8Array(
		await crypto.subtle.decrypt(
			createMasterKeyParams(iv),
			masterKey,
			toArrayBuffer(ciphertext),
		),
	);

	if (streamKey.byteLength !== STREAM_KEY_LENGTH) {
		throwError("Encrypted stream key must decrypt to 32 bytes");
	}

	return streamKey;
}

export function webCryptoStream(masterKey: CryptoKey): WebCryptoStream {
	assertMasterKey(masterKey);

	return {
		async createStreamKey() {
			return encryptStreamKey(masterKey, randomBytes(STREAM_KEY_LENGTH));
		},
		async encrypt(encryptedStreamKey, input, options) {
			return encryptStream(
				await decryptStreamKey(masterKey, encryptedStreamKey),
				input,
				options,
			);
		},
		async decrypt(encryptedStreamKey, input) {
			return decryptStream(
				await decryptStreamKey(masterKey, encryptedStreamKey),
				input,
			);
		},
	};
}
