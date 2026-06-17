// Minimal LZ4 *block* decompressor (no frame header), enough to inflate the
// cat blobs in a Mewgenics .sav. Each cat row is stored as:
//   [uint32 uncompressedSize][lz4-block-compressed bytes]
// This is the same format the reference parser inflates with `lz4.block`.

/**
 * Decompress an LZ4 block. `uncompressedSize` is required (LZ4 block format
 * carries no size header — the game stores it in the 4 bytes before the block).
 */
export function lz4DecompressBlock(src: Uint8Array, uncompressedSize: number): Uint8Array {
  const dst = new Uint8Array(uncompressedSize);
  let sPos = 0;
  let dPos = 0;

  const readLength = (initial: number): number => {
    let len = initial;
    if (initial === 15) {
      let b: number;
      do {
        b = src[sPos++];
        len += b;
      } while (b === 255);
    }
    return len;
  };

  while (sPos < src.length) {
    const token = src[sPos++];

    // Literals
    const litLen = readLength(token >> 4);
    for (let i = 0; i < litLen; i++) dst[dPos++] = src[sPos++];

    // The last sequence ends after its literals (no match part).
    if (sPos >= src.length) break;

    // Match
    const offset = src[sPos] | (src[sPos + 1] << 8);
    sPos += 2;
    let matchLen = readLength(token & 0x0f) + 4; // minmatch = 4
    let matchPos = dPos - offset;
    while (matchLen-- > 0) dst[dPos++] = dst[matchPos++];
  }

  return dst;
}
