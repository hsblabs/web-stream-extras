import { toArrayBuffer } from "../shared/array-buffer";
import { throwError } from "../shared/error";
import { toU8Array } from "../shared/uint8array";
import type { HeaderVersion } from "./constants";
import {
	createAesGcm,
	deriveRecordMaterial,
	type RecordCipherAdapter,
} from "./crypto";
import { padRecord, removePadding } from "./framing";

export class RecordCipher {
	#ikm: ArrayBuffer;
	#aesGcm: RecordCipherAdapter | undefined;
	#nonceBase: Uint8Array | undefined;

	constructor(ikm: Uint8Array) {
		this.#ikm = toArrayBuffer(ikm);
	}

	async initialize(salt: ArrayBuffer, version: HeaderVersion): Promise<void> {
		const material = await deriveRecordMaterial(this.#ikm, salt, version);
		this.#aesGcm = createAesGcm(material.key);
		this.#nonceBase = material.nonceBase;
	}

	async encryptRecord(
		buffer: Uint8Array,
		sequence: number,
		recordSize: number,
		isLast: boolean,
	): Promise<Uint8Array> {
		return this.#getAesGcm().encrypt(
			padRecord(buffer, recordSize, isLast),
			this.#createNonce(sequence),
		);
	}

	async decryptRecord(
		buffer: Uint8Array,
		sequence: number,
		isLast: boolean,
	): Promise<Uint8Array> {
		const data = await this.#getAesGcm().decrypt(
			buffer,
			this.#createNonce(sequence),
		);
		return removePadding(data, isLast);
	}

	#getAesGcm(): RecordCipherAdapter {
		if (!this.#aesGcm) {
			throwError("Encryption key is not initialized");
		}

		return this.#aesGcm;
	}

	#createNonce(sequence: number): Uint8Array {
		if (!this.#nonceBase) {
			throwError("Nonce base is not initialized");
		}
		if (sequence > 0xffff_ffff) {
			throwError("Record sequence number exceeds limit");
		}

		const nonce = toU8Array(this.#nonceBase);
		const view = new DataView(toArrayBuffer(nonce));
		const base = view.getUint32(nonce.length - 4, false);
		view.setUint32(nonce.length - 4, (base ^ sequence) >>> 0, false);
		return nonce;
	}
}
