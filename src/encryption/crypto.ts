import { toArrayBuffer } from "../shared/array-buffer";
import { toU8Array } from "../shared/uint8array";
import {
	AES_GCM_BIT_LENGTH,
	ALGORITHM_AES_GCM,
	ALGORITHM_SHA_256,
	type HeaderVersion,
	HKDF_INFO_KEY,
	HKDF_INFO_LEGACY,
	HKDF_INFO_NONCE,
	KEY_USAGES,
	LEGACY_HEADER_VERSION,
	NONCE_LENGTH,
} from "./constants";

export interface RecordCipherAdapter {
	decrypt(data: Uint8Array, iv: Uint8Array): Promise<Uint8Array>;
	encrypt(data: Uint8Array, iv: Uint8Array): Promise<Uint8Array>;
}

export interface DerivedRecordMaterial {
	key: CryptoKey;
	nonceBase: Uint8Array;
}

function createAesGcmParams(iv: Uint8Array): AesGcmParams {
	return {
		name: ALGORITHM_AES_GCM,
		iv: toArrayBuffer(iv),
		tagLength: AES_GCM_BIT_LENGTH,
	};
}

export function createAesGcm(key: CryptoKey): RecordCipherAdapter {
	return {
		async encrypt(data, iv) {
			const cipher = await crypto.subtle.encrypt(
				createAesGcmParams(iv),
				key,
				toArrayBuffer(data),
			);
			return toU8Array(cipher);
		},
		async decrypt(data, iv) {
			const decipher = await crypto.subtle.decrypt(
				createAesGcmParams(iv),
				key,
				toArrayBuffer(data),
			);
			return toU8Array(decipher);
		},
	};
}

async function importHkdfBaseKey(ikm: ArrayBuffer): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
}

async function deriveHkdfBits(
	baseKey: CryptoKey,
	salt: ArrayBuffer,
	info: Uint8Array,
	bitLength: number,
): Promise<ArrayBuffer> {
	return crypto.subtle.deriveBits(
		{
			name: "HKDF",
			salt,
			hash: ALGORITHM_SHA_256,
			info: toArrayBuffer(info),
		},
		baseKey,
		bitLength,
	);
}

export async function deriveRecordMaterial(
	ikm: ArrayBuffer,
	salt: ArrayBuffer,
	version: HeaderVersion,
): Promise<DerivedRecordMaterial> {
	const baseKey = await importHkdfBaseKey(ikm);
	const rawKey = await deriveHkdfBits(
		baseKey,
		salt,
		version === LEGACY_HEADER_VERSION ? HKDF_INFO_LEGACY : HKDF_INFO_KEY,
		AES_GCM_BIT_LENGTH,
	);
	const nonceBytes =
		version === LEGACY_HEADER_VERSION
			? toU8Array(rawKey).slice(0, NONCE_LENGTH)
			: toU8Array(
					await deriveHkdfBits(
						baseKey,
						salt,
						HKDF_INFO_NONCE,
						NONCE_LENGTH * 8,
					),
				);

	return {
		key: await crypto.subtle.importKey(
			"raw",
			rawKey,
			{ name: ALGORITHM_AES_GCM, length: AES_GCM_BIT_LENGTH },
			false,
			KEY_USAGES,
		),
		nonceBase: nonceBytes,
	};
}
