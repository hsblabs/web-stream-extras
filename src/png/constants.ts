export const PNG_SIGNATURE = Uint8Array.of(
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
);

export const PNG_TEXT_CHUNK_TYPE = "tEXt";
export const PNG_IEND_CHUNK_TYPE = "IEND";
export const PNG_INTERNAL_TEXT_CHUNK_KEYWORD = "hsblabs-web-stream-extras-bin";

export const PNG_PAYLOAD_MAGIC = new TextEncoder().encode("HSBP");
export const PNG_PAYLOAD_VERSION = 2;
export const PNG_PAYLOAD_SEGMENT_KIND_DATA = 0;
export const PNG_PAYLOAD_SEGMENT_KIND_MANIFEST = 1;
export const PNG_PAYLOAD_SEGMENT_DATA_MAX_LENGTH = 32 * 1024;
export const PNG_PAYLOAD_DATA_HEADER_LENGTH = 10;
export const PNG_PAYLOAD_MANIFEST_HEADER_LENGTH = 14;
