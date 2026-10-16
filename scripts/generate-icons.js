/**
 * Dollarvault icon generator — writes the full icon set into public/ with a
 * pure-JS PNG codec (node zlib, no deps).
 *
 * Source artwork: scripts/brand-emblem-plate.png — the gold "D" dollar/growth
 * emblem lifted from the brand master, alpha-keyed so its dark background is
 * transparent. Every icon composites that emblem onto a dark plate, so the
 * glyph stays centred and legible from 512px PWA icons down to 16px favicons.
 *
 * Usage: node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------------ PNG IO */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

const crc32 = buf => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
};

const encodePng = (width, height, rgba) => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
};

const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
};

/** Decode a non-interlaced 8-bit PNG to { width, height, channels, data }. */
const decodePng = file => {
    const buf = fs.readFileSync(file);
    let off = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat = [];

    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        off += 12 + len;
    }

    if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
    if (interlace !== 0) throw new Error('interlaced PNG not supported');
    const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
    if (!channels) throw new Error(`unsupported color type ${colorType}`);

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const out = Buffer.alloc(stride * height);
    let prev = Buffer.alloc(stride);
    let pos = 0;

    for (let y = 0; y < height; y++) {
        const filter = raw[pos++];
        const row = raw.subarray(pos, pos + stride);
        pos += stride;
        const cur = Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const rawv = row[x];
            const a = x >= channels ? cur[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let v;
            switch (filter) {
                case 0: v = rawv; break;
                case 1: v = rawv + a; break;
                case 2: v = rawv + b; break;
                case 3: v = rawv + ((a + b) >> 1); break;
                case 4: v = rawv + paeth(a, b, c); break;
                default: throw new Error(`bad filter ${filter}`);
            }
            cur[x] = v & 0xff;
        }
        cur.copy(out, y * stride);
        prev = cur;
    }

    return { width, height, channels, data: out };
};

/** Promote a decoded image to straight-alpha RGBA. */
const toRgba = img => {
    const { width, height, channels, data } = img;
    const out = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const s = i * channels;
        const d = i * 4;
        if (channels >= 3) {
            out[d] = data[s];
            out[d + 1] = data[s + 1];
            out[d + 2] = data[s + 2];
            out[d + 3] = channels === 4 ? data[s + 3] : 255;
        } else {
            out[d] = out[d + 1] = out[d + 2] = data[s];
            out[d + 3] = 255;
        }
    }
    return out;
};

/* ------------------------------------------------------------------ resize */

/** Box-filter (area average) downscale; bilinear for upscale. */
const resize = (src, sw, sh, dw, dh) => {
    const dst = Buffer.alloc(dw * dh * 4);
    const xRatio = sw / dw;
    const yRatio = sh / dh;

    if (xRatio >= 1 && yRatio >= 1) {
        for (let y = 0; y < dh; y++) {
            const sy0 = Math.floor(y * yRatio);
            const sy1 = Math.min(sh, Math.max(sy0 + 1, Math.ceil((y + 1) * yRatio)));
            for (let x = 0; x < dw; x++) {
                const sx0 = Math.floor(x * xRatio);
                const sx1 = Math.min(sw, Math.max(sx0 + 1, Math.ceil((x + 1) * xRatio)));
                let r = 0;
                let g = 0;
                let b = 0;
                let a = 0;
                let n = 0;
                for (let yy = sy0; yy < sy1; yy++) {
                    for (let xx = sx0; xx < sx1; xx++) {
                        const i = (yy * sw + xx) * 4;
                        r += src[i];
                        g += src[i + 1];
                        b += src[i + 2];
                        a += src[i + 3];
                        n++;
                    }
                }
                const o = (y * dw + x) * 4;
                dst[o] = Math.round(r / n);
                dst[o + 1] = Math.round(g / n);
                dst[o + 2] = Math.round(b / n);
                dst[o + 3] = Math.round(a / n);
            }
        }
        return dst;
    }

    for (let y = 0; y < dh; y++) {
        const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(sh - 1, y0 + 1);
        const wy = fy - y0;
        for (let x = 0; x < dw; x++) {
            const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
            const x0 = Math.floor(fx);
            const x1 = Math.min(sw - 1, x0 + 1);
            const wx = fx - x0;
            const o = (y * dw + x) * 4;
            for (let c = 0; c < 4; c++) {
                const p00 = src[(y0 * sw + x0) * 4 + c];
                const p10 = src[(y0 * sw + x1) * 4 + c];
                const p01 = src[(y1 * sw + x0) * 4 + c];
                const p11 = src[(y1 * sw + x1) * 4 + c];
                const top = p00 + (p10 - p00) * wx;
                const bot = p01 + (p11 - p01) * wx;
                dst[o + c] = Math.round(top + (bot - top) * wy);
            }
        }
    }
    return dst;
};

/* ------------------------------------------------------------------- build */

const SRC = path.join(__dirname, 'brand-emblem-plate.png');
const OUT = path.join(__dirname, '..', 'public');

const img = decodePng(SRC);
const emblem = toRgba(img);
const cw = img.width;
const ch = img.height;

// Plate colour sampled from the transparent corners of the emblem crop
// (alpha is keyed out there, but the original dark RGB is preserved).
const sample = (x, y) => {
    const i = (y * cw + x) * 4;
    return [emblem[i], emblem[i + 1], emblem[i + 2]];
};
const corners = [sample(2, 2), sample(cw - 3, 2), sample(2, ch - 3), sample(cw - 3, ch - 3)];
const plate = [0, 1, 2].map(c => Math.round(corners.reduce((s, v) => s + v[c], 0) / corners.length));

/**
 * Render a `size` square icon: dark plate gradient + centred emblem
 * (aspect ratio preserved).
 */
const renderIcon = (size, emblemRatio) => {
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const t = (x + y) / (size * 2);
            const i = (y * size + x) * 4;
            out[i] = Math.round(plate[0] * (1.06 - 0.16 * t));
            out[i + 1] = Math.round(plate[1] * (1.06 - 0.16 * t));
            out[i + 2] = Math.round(plate[2] * (1.06 - 0.16 * t));
            out[i + 3] = 255;
        }
    }

    const maxSide = Math.max(1, Math.round(size * emblemRatio));
    const scale = Math.min(maxSide / cw, maxSide / ch);
    const innerW = Math.max(1, Math.round(cw * scale));
    const innerH = Math.max(1, Math.round(ch * scale));
    const resized = resize(emblem, cw, ch, innerW, innerH);
    const offX = Math.round((size - innerW) / 2);
    const offY = Math.round((size - innerH) / 2);

    for (let y = 0; y < innerH; y++) {
        for (let x = 0; x < innerW; x++) {
            const s = (y * innerW + x) * 4;
            const d = ((y + offY) * size + (x + offX)) * 4;
            const a = resized[s + 3] / 255;
            out[d] = Math.round(resized[s] * a + out[d] * (1 - a));
            out[d + 1] = Math.round(resized[s + 1] * a + out[d + 1] * (1 - a));
            out[d + 2] = Math.round(resized[s + 2] * a + out[d + 2] * (1 - a));
        }
    }
    return out;
};

const write = (name, size, ratio) => {
    fs.writeFileSync(path.join(OUT, name), encodePng(size, size, renderIcon(size, ratio)));
    console.log(`wrote public/${name} (${size}x${size})`);
};

// PWA / app icons — emblem fills the plate.
write('icon-192.png', 192, 0.9);
write('icon-512.png', 512, 0.9);
// Maskable: Android clips to a circle, so keep the emblem in the 80% safe zone.
write('icon-maskable-512.png', 512, 0.66);
// Apple touch icon: must be opaque, no transparency.
write('apple-touch-icon.png', 180, 0.82);

// Website favicons.
write('favicon-32x32.png', 32, 0.9);
write('favicon-16x16.png', 16, 0.9);

// SVG favicon: crisp at any size, embedding a rasterised 192px emblem.
const embed = encodePng(192, 192, renderIcon(192, 0.9)).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <title>Dollarvault</title>
  <image width="192" height="192" href="data:image/png;base64,${embed}"/>
</svg>
`;
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg);
console.log(`wrote public/favicon.svg (${(svg.length / 1024).toFixed(1)} kB)`);
