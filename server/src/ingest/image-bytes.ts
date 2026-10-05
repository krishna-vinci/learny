export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only header bytes are read; malformed/truncated headers fail closed. */
export function sniffImage(bytes: Uint8Array): { ext: string; mime: string; width: number; height: number } {
  const b = Buffer.from(bytes);
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString("ascii", 12, 16) === "IHDR"
  )
    return { ext: "png", mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6)))
    return { ext: "gif", mime: "image/gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return { ext: "webp", mime: "image/webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    if (kind === "VP8 " && b.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
      return { ext: "webp", mime: "image/webp", width: b.readUInt16LE(26) & 16383, height: b.readUInt16LE(28) & 16383 };
    if (kind === "VP8L" && b[20] === 47) {
      const bits = b.readUInt32LE(21);
      return { ext: "webp", mime: "image/webp", width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
    }
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset] !== 255) break;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker !== undefined && marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > b.length) break;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) break;
      if (
        marker !== undefined &&
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      )
        return {
          ext: "jpg",
          mime: "image/jpeg",
          width: b.readUInt16BE(offset + 5),
          height: b.readUInt16BE(offset + 3),
        };
      offset += length;
    }
  }
  throw new Error("Only PNG, JPEG, GIF and WebP images with valid headers can be saved (SVG downloads are forbidden)");
}
