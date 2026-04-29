# PNG Text Chunk Binary Stream Design

**Date:** 2026-03-22

**Status:** Proposed

## Goal

PNG の `tEXt` チャンクを使って任意バイナリを埋め込み・取り出しできる Web Streams API ベースの API を `@hsblabs/web-stream-extras/png` として追加する。

利用者が欲しいものは次の 2 つに絞る。

- バイナリを書き込むと、元の PNG を再構成した `ReadableStream<Uint8Array>` を得られる `WritableStream`
- PNG を読むと、埋め込まれた任意バイナリを `ReadableStream<Uint8Array>` として取り出せる API

## Non-Goals

- PNG 画像のデコード、描画、圧縮率最適化
- `zTXt` や `iTXt` の初期対応
- 利用者が任意の PNG `keyword` を指定する API
- 複数種類の埋め込み payload を同じ PNG に共存させる汎用メタデータ層

## Public API

新しい subpath を追加する。

```ts
import {
  createPNGTextChunkWriter,
  extractPNGTextChunk,
} from "@hsblabs/web-stream-extras/png";
```

```ts
export interface PNGTextChunkWriteOptions {
  onExisting?: "error" | "replace";
}

export interface PNGTextChunkWriter {
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;
}

export function createPNGTextChunkWriter(
  png: ReadableStream<Uint8Array>,
  options?: PNGTextChunkWriteOptions,
): PNGTextChunkWriter;

export function extractPNGTextChunk(
  png: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array>;
```

### API rationale

- `createPNGTextChunkWriter()` は、利用者が任意のファイルを `WritableStream<Uint8Array>` に流し込めるようにするための低レベル API である
- 再構成 PNG は `writer.readable` から読む
- `extractPNGTextChunk()` は埋め込まれた payload だけを返す。PNG 自体の再出力はしない
- `keyword` は公開 options に出さない。PNG 上の識別子は内部詳細とし、外部 API から隠す

## PNG Storage Format

### Why `tEXt`

`tEXt` は `keyword + NUL + text` の構造を持つ。`text` には `NUL` を含められないため、生バイナリはそのまま書けない。

`base64` は約 33% 膨らむため、初期設計では採用しない。代わりに COBS を使い、`0x00` を含まない byte 列へ変換して `tEXt` の text に載せる。

### Internal chunk identification

- `keyword` はライブラリ内部の固定値を使う
- 利用者はこの値を指定しない
- extractor はこの固定 `keyword` を持つ `tEXt` チャンク列を payload として扱う

### Payload segmentation

payload 全体を 1 個の `tEXt` にまとめると、chunk length の都合で書き込み側が全 payload を事前に保持しやすい。初期実装では payload を複数の `tEXt` chunk に分割する。

各 payload segment は次の順で格納する。

1. 元の payload の一部を固定上限まで読む
2. segment header を先頭に付ける
3. segment payload と header をまとめて COBS encode する
4. `tEXt` chunk の text field に encode 結果を書き込む

extract 側は各 `tEXt` chunk の text を個別に COBS decode し、segment header を検証した上で segment payload を連結して出力する。

### Segment wire format

COBS decode 後の各 segment は次の binary header を持つ。

```text
magic[4]        = ASCII "HSBP"
version[1]      = 0x01
flags[1]        = bit0:first, bit1:last
segmentIndex[4] = uint32 big-endian
segmentCount[4] = uint32 big-endian
payloadCrc32[4] = uint32 big-endian
segmentData[n]
```

header の意図は次の通り。

- `magic` と `version` で将来の format 変更を識別する
- `segmentIndex` と `segmentCount` で欠落や並び替えを検出する
- `payloadCrc32` で payload 全体の整合性を検証する
- empty payload は `segmentCount = 1`, `segmentIndex = 0`, `flags = first|last`, `segmentData = empty` の 1 segment で表現する

### Segment ordering

- payload segment 用 `tEXt` chunks はすべて `IEND` 直前に挿入する
- replace 時は既存の内部 `keyword` の `tEXt` chunks を全て除去してから、新しい segment 群を `IEND` 直前に挿入する
- extractor は PNG 内に現れる順に segment を読み、`segmentIndex` が `0..segmentCount-1` で単調増加していることを要求する

### Integrity

- parser は PNG signature を検証する
- 各 chunk の length, type, data, CRC を検証する
- writer が新規に生成する `tEXt` chunks は CRC を再計算して書く
- 既存 chunk の CRC 不整合は error にする

## Behavior Rules

### `createPNGTextChunkWriter()`

- `png` は元画像の byte stream
- 返却された `writable` に payload bytes を書き込む
- payload の受け取りと PNG 再構成は並行して進むが、payload segments は `IEND` 直前に挿入するため、writer は payload close まで segment 情報を保持する
- `readable` は入力 PNG をそのまま流しつつ、`IEND` 直前で payload `tEXt` chunks を差し込む
- source PNG が先に `IEND` まで到達しても、`writable.close()` されるまでは `readable` はその位置で待機する

#### Lifecycle coupling

- `writable.close()` は payload の終端を表す
- `writable.close()` が返す promise は、payload 受付だけでは resolve しない。source PNG の検証、`IEND` 直前への segment 挿入、`readable` への終端反映まで成功した時点で resolve する
- source PNG の parse / CRC / `onExisting` 失敗が payload close 後に発覚した場合でも、その失敗は保留中の `writable.close()` promise を reject する
- `WritableStreamDefaultWriter.close()` の代わりに `payload.pipeTo(writer.writable)` を使う場合も、返却 promise は同じ完了条件に従う
- `readable` は source PNG の検証完了と payload 埋め込み完了の両方がそろった時点で close する
- `readable.cancel(reason)` されたら source PNG reader を cancel し、`writable` は同じ reason で error 状態にする
- `writable.abort(reason)` されたら `readable` は同じ reason で error にし、source PNG reader を cancel する
- source PNG の read error、PNG parse error、CRC error、`onExisting: "error"` の衝突は `readable` を error にし、以後の `writable.write()` / `close()` も同じ reason で reject する

#### Memory model

- 初期実装は constant-memory ではない
- `IEND` 直前へ挿入する設計上、最悪ケースでは payload segment 群を `readable` 完了まで保持するため、追加メモリは `O(payload)` になる
- segment 分割の目的は 1 個の巨大 contiguous buffer を避け、wire format と処理単位を明確にすることにある

#### `onExisting`

- default は `"error"`
- `"error"`:
  - 内部 `keyword` の既存 `tEXt` chunk を 1 個でも見つけたら失敗
- `"replace"`:
  - 内部 `keyword` の既存 `tEXt` chunks をすべて除去し、新しい payload segments に置き換える

### `extractPNGTextChunk()`

- 固定 `keyword` を持つ `tEXt` chunks をすべて検出する
- text field を順番に COBS decode し、segment header を検証してから `segmentData` を `ReadableStream<Uint8Array>` に流す
- 対象 chunk が 1 個もなければ error
- 対象 chunk の COBS decode に失敗したら error
- `magic`, `version`, `segmentCount`, `payloadCrc32` が segment 間で一致しなければ error
- 最終 segment 読了時に payload CRC32 を検証し、不一致なら error

### Empty payload

- writer は empty payload でも 1 つの sentinel segment を出力する
- extractor は sentinel segment を空の payload として扱い、空 stream を正常終了する

## Error Handling

次は明示的に error とする。

- PNG signature が不正
- chunk header が途中で切れている
- chunk body または CRC が途中で切れている
- chunk type が ASCII 英字 4 byte でない
- CRC mismatch
- `IEND` が存在しない
- `IEND` 後に余剰データがある
- `"error"` 指定時に既存埋め込み chunk が見つかる
- extractor で対象 chunk が存在しない
- COBS decode 不能
- segment `magic` または `version` が不正
- segment index が欠落・重複・逆順
- segment count が 0
- payload CRC32 mismatch

## Implementation Outline

### File layout

- `src/png.ts`
  - public entry re-export
- `src/png/public.ts`
  - 公開型と公開関数
- `src/png/constants.ts`
  - PNG signature, internal keyword, segment size 上限
- `src/png/cobs.ts`
  - COBS encode/decode
- `src/png/crc32.ts`
  - CRC32 計算
- `src/png/framing.ts`
  - PNG chunk parse / build helper
- `src/png/transformers.ts`
  - writer / extractor の stream 実装
- `src/png.test.ts`
  - public API ベースの統合テスト

### Stream architecture

- PNG parser は `ByteQueue` を使って signature / chunk header / CRC を段階的に読む
- 既存 PNG の chunk body は必要以上に保持せず、そのまま出力へ流す
- payload 側は writer 内部で独立した queue に蓄積し、close 時に segment 列と payload CRC32 を確定させる
- `IEND` を読むまでは payload chunks を出さず、payload close 後に `IEND` 直前でまとめて排出する
- source PNG が `IEND` まで先に進んだ場合は、payload close までそこで待機する

## Testing Strategy

最低限、次を cover する。

- writer + extractor の round-trip
- payload を 1 byte 分割で書き込んでも round-trip する
- PNG 入力を 1 byte 分割で渡しても動く
- payload に `0x00` を大量に含んでも round-trip する
- empty payload を round-trip する
- `onExisting: "error"` で既存埋め込みがあると失敗する
- `onExisting: "replace"` で既存埋め込みを置き換える
- 埋め込み chunk 群が `IEND` 直前に入る
- source PNG が先に `IEND` へ到達しても payload close 待ちをする
- `readable.cancel()` と `writable.abort()` の error 伝播が期待通りに動く
- malformed PNG signature を reject する
- truncated chunk header / body / CRC を reject する
- CRC mismatch を reject する
- extractor が対象 chunk 不在で失敗する
- segment index 欠落・逆順・重複を reject する
- payload CRC mismatch を reject する

## Documentation Updates

- `package.json.exports` に `./png` を追加する
- `tsdown.config.ts` の entry に `src/png.ts` を追加する
- `README.md` に `png` subpath の概要とサンプルを追加する
- root public API テストは不変のまま維持し、`png` 用の public API テストを新設する

## Open Questions Resolved

- payload は `string` ではなく任意バイナリとして扱う
- `keyword` は公開 options にしない
- サイズ効率は `base64` ではなく COBS を優先する
- payload は 1 chunk ではなく複数 `tEXt` chunks に分割し、wire format version と整合性検証を持たせる
