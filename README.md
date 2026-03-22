# @hsblabs/web-stream-extras

`@hsblabs/web-stream-extras` is a TypeScript utility library for the WHATWG Streams API.

It helps you work with `ReadableStream`, `TransformStream`, and `Uint8Array` data in browsers and Node.js runtimes that support Web Streams. The package includes practical stream helpers for byte-oriented workflows, plus an `encryption` subpath for encrypted byte streams.

## What This Package Is For

Use this package when you need to:

- build or consume `ReadableStream<Uint8Array>` pipelines
- collect byte streams into a single `Uint8Array`
- convert between strings and `Uint8Array`
- encode or decode delimiter-separated COBS frames
- encrypt or decrypt byte streams with the Web Streams API
- embed or extract binary payloads inside PNG `tEXt` chunks

This makes it a good fit for:

- Web Streams API utilities
- WHATWG stream processing
- browser and Node.js stream helpers
- byte stream and binary data handling
- encrypted file streams and encrypted payload pipelines

## Installation

```sh
npm install @hsblabs/web-stream-extras
```

```sh
pnpm add @hsblabs/web-stream-extras
```

```sh
bun add @hsblabs/web-stream-extras
```

```sh
yarn add @hsblabs/web-stream-extras
```

## Quick Start

### Read and collect a byte stream

```ts
import {
  binaryToString,
  readAllBytes,
  readableFromChunks,
  stringToBinary,
} from "@hsblabs/web-stream-extras";

const input = readableFromChunks([
  stringToBinary("hello"),
  stringToBinary(" "),
  stringToBinary("world"),
]);

const output = await readAllBytes(input);

console.log(binaryToString(output)); // "hello world"
```

### Encrypt and decrypt a stream

```ts
import {
  readAllBytes,
  readableFromChunks,
  stringToBinary,
} from "@hsblabs/web-stream-extras";
import {
  decryptStream,
  encryptStream,
} from "@hsblabs/web-stream-extras/encryption";

const encKey = crypto.getRandomValues(new Uint8Array(32));
const plaintext = readableFromChunks(stringToBinary("secret payload"));

const encrypted = encryptStream(encKey, plaintext);
const decrypted = decryptStream(encKey, encrypted);
const result = await readAllBytes(decrypted);

console.log(new TextDecoder().decode(result)); // "secret payload"
```

### Encode and decode COBS frames

```ts
import {
  createCOBSDecoderStream,
  createCOBSEncoderStream,
} from "@hsblabs/web-stream-extras/cobs";
import { readableFromChunks } from "@hsblabs/web-stream-extras";

const rawFrames = readableFromChunks([
  Uint8Array.of(0x11, 0x22, 0x00, 0x33),
  Uint8Array.of(0xff, 0xee),
]);

const encoded = rawFrames.pipeThrough(createCOBSEncoderStream());
const decoded = encoded.pipeThrough(createCOBSDecoderStream());
```

### Embed and extract a binary payload in PNG

```ts
import {
  createPNGTextChunkWriter,
  extractPNGTextChunk,
} from "@hsblabs/web-stream-extras/png";
import { readAllBytes, readableFromChunks } from "@hsblabs/web-stream-extras";

const sourcePNG = readableFromChunks(pngBytes);
const payloadWriter = createPNGTextChunkWriter(sourcePNG);

await readableFromChunks(fileBytes).pipeTo(payloadWriter.writable);
const rebuiltPNG = await readAllBytes(payloadWriter.readable);

const extracted = await readAllBytes(
  extractPNGTextChunk(readableFromChunks(rebuiltPNG)),
);
```

## Why Use It

This package focuses on a small set of utilities that are useful in real byte-stream pipelines:

- `readableFromChunks()` for quickly creating a `ReadableStream`
- `readAllChunks()` and `readAllBytes()` for consuming a stream
- binary conversion helpers for strings and random byte generation
- `cobs` helpers for delimiter-separated frame encoding and decoding
- `encryption` helpers for stream encryption without changing your stream-first API style
- `png` helpers for embedding and extracting binary payloads in PNG metadata

The goal is to keep Web Streams code simple, predictable, and easy to compose.

## API Overview

### Root package

The root package provides:

- Web Streams utilities for creating and consuming streams
- byte conversion helpers for strings and `Uint8Array`

Representative exports include:

- `readableFromChunks`
- `readAllChunks`
- `readAllBytes`
- `stringToBinary`
- `binaryToString`
- `randomBytes`

Low-level buffering and byte-normalization helpers are internal implementation details and are not part of the supported root public API.

### `@hsblabs/web-stream-extras/encryption`

The `encryption` subpath provides stream encryption utilities for binary streams:

- `EncryptionStream`
- `DecryptionStream`
- `encryptStream`
- `decryptStream`
- `webCryptoStream`

`encryptStream()` and `decryptStream()` are convenience helpers for piping an existing `ReadableStream<Uint8Array>` through the corresponding transform stream.

`webCryptoStream(masterKey)` is a higher-level helper for applications that manage stream keys with the Web Crypto API. It uses an `AES-GCM` master key to create encrypted 32-byte stream keys, then unwraps those keys before delegating to `encryptStream()` and `decryptStream()`.

### `@hsblabs/web-stream-extras/cobs`

The `cobs` subpath provides Consistent Overhead Byte Stuffing helpers:

- `encodeCOBSFrame`
- `decodeCOBSFrame`
- `createCOBSEncoderStream`
- `createCOBSDecoderStream`
- `readCOBS`
- `writeCOBS`

`encodeCOBSFrame()` and `decodeCOBSFrame()` work on a single frame without the trailing delimiter.

The stream helpers use `0x00` as the frame delimiter. Each input chunk to `createCOBSEncoderStream()` is treated as one raw frame, and `createCOBSDecoderStream()` emits one decoded frame for each delimiter-terminated encoded frame.

### `@hsblabs/web-stream-extras/png`

The `png` subpath provides binary payload helpers for PNG files:

- `createPNGTextChunkWriter`
- `extractPNGTextChunk`

`createPNGTextChunkWriter()` accepts a source PNG stream and returns a `{ writable, readable }` pair. Write arbitrary `Uint8Array` payload bytes into `writable`, then read the rebuilt PNG from `readable`.

`extractPNGTextChunk()` reads a PNG stream and returns the embedded binary payload as `ReadableStream<Uint8Array>`.

### `webCryptoStream` example

```ts
import {
  readAllBytes,
  readableFromChunks,
  stringToBinary,
} from "@hsblabs/web-stream-extras";
import { webCryptoStream } from "@hsblabs/web-stream-extras/encryption";

const masterKey = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"],
);

const cryptoStream = webCryptoStream(masterKey);
const encryptedStreamKey = await cryptoStream.createStreamKey();
const plaintext = readableFromChunks(stringToBinary("secret payload"));

const encrypted = await cryptoStream.encrypt(encryptedStreamKey, plaintext);
const decrypted = await cryptoStream.decrypt(encryptedStreamKey, encrypted);
const result = await readAllBytes(decrypted);

console.log(new TextDecoder().decode(result)); // "secret payload"
```

## Environment and Compatibility

- Node.js: `>=22`
- Browsers: works in modern browsers with Web Streams support
- Runtime APIs:
  - root utilities depend on the WHATWG Streams API
  - `cobs` depends on the WHATWG Streams API
  - `encryption` depends on both the Web Streams API and Web Crypto
  - `png` depends on the WHATWG Streams API

## Notes

- `cobs` is intentionally a subpath export. The root package stays focused on generic stream helpers.
- `encryption` is intentionally a subpath export. The root package is not encryption-only.
- `png` is intentionally a subpath export. The root package stays focused on generic stream helpers.
- This package does not handle authentication, password-based key derivation, user management, or key storage.
- For `encryption`, you are expected to provide the raw encryption key (`Uint8Array`) yourself.
- `webCryptoStream()` is optional. It is a convenience wrapper when you already manage a separate `AES-GCM` master key and want encrypted per-stream keys as strings.
- `png` stores payload bytes in internal `tEXt` chunks and does not expose low-level PNG metadata knobs in the public API.
