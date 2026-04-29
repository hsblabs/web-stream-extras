# @hsblabs/web-stream-extras

`@hsblabs/web-stream-extras` is a TypeScript utility library for the WHATWG Streams API.

It helps you work with `ReadableStream`, `TransformStream`, and `Uint8Array` data in browsers and Node.js runtimes that support Web Streams. The package includes practical stream helpers for byte-oriented workflows, plus an `encryption` subpath for encrypted byte streams.

## What This Package Is For

Use this package when you need to:

- build or consume `ReadableStream<Uint8Array>` pipelines
- collect byte streams into a single `Uint8Array`
- convert between strings and `Uint8Array`
- encode and decode base64 or base64url streams
- decode, encode, split, and join text streams
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
- binary conversion helpers for strings and random byte generation
- `encryption` helpers for stream encryption without changing your stream-first API style

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

### `@hsblabs/web-stream-extras/text`

The `text` subpath provides small convenience wrappers for text-oriented streams:

- `TextDecodeStream`
- `TextEncodeStream`
- `LineSplitStream`
- `LineJoinStream`
- `decodeTextStream`
- `encodeTextStream`
- `splitLinesStream`
- `joinLinesStream`

`TextDecodeStream` accepts `string | Uint8Array` chunks, which makes it useful when a pipeline may already contain decoded text. `LineSplitStream` handles UTF-8 byte chunks and string chunks, including chunks split inside multibyte characters.

```ts
import { readAllChunks } from "@hsblabs/web-stream-extras";
import { splitLinesStream } from "@hsblabs/web-stream-extras/text";

const lines = await readAllChunks(
  splitLinesStream(response.body!, { maxLineChars: 1024 }),
);
```

### `@hsblabs/web-stream-extras/base64`

The `base64` subpath provides streaming base64 and base64url codecs:

- `Base64EncodeStream`
- `Base64DecodeStream`
- `encodeBase64Stream`
- `decodeBase64Stream`
- `encodeBase64UrlStream`
- `decodeBase64UrlStream`

The encoder preserves chunk boundaries where it can while carrying incomplete 3-byte groups to the next chunk. `encodeBase64UrlStream()` omits padding by default.

```ts
import { readAllChunks } from "@hsblabs/web-stream-extras";
import { encodeBase64UrlStream } from "@hsblabs/web-stream-extras/base64";

const encoded = await readAllChunks(encodeBase64UrlStream(file.stream()));
const token = encoded.join("");
```

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
