import { stringToBinary } from "../shared/binary";

export const ALGORITHM_AES_GCM = "AES-GCM";
export const ALGORITHM_SHA_256 = "SHA-256";
export const AES_GCM_BIT_LENGTH = 128;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const KEY_LENGTH = 16;
export const HEADER_SIZE = 21;
export const HEADER_RECORD_SIZE_OFFSET = KEY_LENGTH;
export const HEADER_VERSION_OFFSET = HEADER_RECORD_SIZE_OFFSET + 4;
export const ECE_RECORD_SIZE = 1024 * 1024 * 4;
export const KEY_USAGES: KeyUsage[] = ["decrypt", "encrypt"];
export const LEGACY_HEADER_VERSION = 0 as const;
export const CURRENT_HEADER_VERSION = 1 as const;
export type HeaderVersion =
	| typeof LEGACY_HEADER_VERSION
	| typeof CURRENT_HEADER_VERSION;
export const HKDF_INFO_LEGACY = stringToBinary("Content-Encoding: aes128gcm\0");
export const HKDF_INFO_KEY = stringToBinary(
	"Content-Encoding: aes128gcm:key\0",
);
export const HKDF_INFO_NONCE = stringToBinary(
	"Content-Encoding: aes128gcm:nonce\0",
);
export const MAX_HEADER_RECORD_SIZE = 0xffff_ffff;
