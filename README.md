# @hsblabs/web-stream-extras

`@hsblabs/web-stream-extras` is a TypeScript utility library for the WHATWG Streams API.

It helps you work with `ReadableStream`, `TransformStream`, and `Uint8Array` data in browsers and Node.js runtimes that support Web Streams. The package includes practical stream helpers for byte-oriented workflows, plus an `encryption` subpath for encrypted byte streams.

## What This Package Is For

Use this package when you need to:

- build or consume `ReadableStream<Uint8Array>` pipelines
- collect byte streams into a single `Uint8Array`
- convert between strings, `Uint8Array`, and `ArrayBuffer`
- build custom `TransformStream` utilities for binary data
- encrypt or decrypt byte streams with the Web Streams API

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

## Why Use It

This package focuses on a small set of utilities that are useful in real byte-stream pipelines:

- `readableFromChunks()` for quickly creating a `ReadableStream`
- `readAllChunks()` and `readAllBytes()` for consuming a stream
- `ByteTransformStream` for building binary `TransformStream` wrappers
- `Uint8Array` and `ArrayBuffer` helpers for consistent byte handling
- `encryption` helpers for stream encryption without changing your stream-first API style

The goal is to keep Web Streams code simple, predictable, and easy to compose.

## API Overview

### Root package

The root package provides:

- Web Streams utilities for creating and consuming streams
- byte conversion helpers for `Uint8Array`, strings, and `ArrayBuffer`
- small building blocks for binary transform pipelines

Representative exports include:

- `readableFromChunks`
- `readAllChunks`
- `readAllBytes`
- `ByteTransformStream`
- `ByteQueue`
- `stringToBinary`
- `binaryToString`
- `toU8Array`
- `toArrayBuffer`

### `@hsblabs/web-stream-extras/encryption`

The `encryption` subpath provides stream encryption utilities for binary streams:

- `EncryptionStream`
- `DecryptionStream`
- `encryptStream`
- `decryptStream`
- `webCryptoStream`

`encryptStream()` and `decryptStream()` are convenience helpers for piping an existing `ReadableStream<Uint8Array>` through the corresponding transform stream.

`webCryptoStream(masterKey)` is a higher-level helper for applications that manage stream keys with the Web Crypto API. It uses an `AES-GCM` master key to create encrypted 32-byte stream keys, then unwraps those keys before delegating to `encryptStream()` and `decryptStream()`.

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
  - `encryption` depends on both the Web Streams API and Web Crypto

## Notes

- `encryption` is intentionally a subpath export. The root package is not encryption-only.
- This package does not handle authentication, password-based key derivation, user management, or key storage.
- For `encryption`, you are expected to provide the raw encryption key (`Uint8Array`) yourself.
- `webCryptoStream()` is optional. It is a convenience wrapper when you already manage a separate `AES-GCM` master key and want encrypted per-stream keys as strings.
