/**
 * Dollarvault icon generator — writes public/icon-192.png, icon-512.png and
 * icon-maskable-512.png with a pure-JS PNG encoder (node zlib, no deps).
 *
 * The rasterized design mirrors public/favicon.svg: a deep-navy vault plate,
 * gold vault-door ring with bolts + specular arc, and a gold market-ascent
 * line capped by a glowing teal dot.
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

/* ------------------------------------------------------------------ design */

const W = 512;
const CX = 256;
const CY = 256;

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_TOP = hex('#132148');
const BG_BOT = hex('#060a18');
const GOLD_LO = hex('#ffe9a3');
const GOLD_MID = hex('#f6c34b');
const GOLD_HI = hex('#c98a12');
const LINE_LO = hex('#e0a92c');
const LINE_HI = hex('#fff3c4');
const TEAL = hex('#5eead4');
const BOLT = hex('#7a5510');
const SPEC = hex('#fff8dd');

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mix3 = (a, m, b, t) => (t < 0.5 ? mix(a, m, t * 2) : mix(m, b, (t - 0.5) * 2));
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Rounded-square signed distance (negative inside). */
const sdRoundRect = (x, y, hw, hh, r) => {
    const qx = Math.abs(x) - (hw - r);
    const qy = Math.abs(y) - (hh - r);
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Distance from point to a line segment. */
const sdSegment = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
};

const CHART = [
    [176, 318],
    [238, 256],
    [278, 292],
    [346, 206],
];

const BOLTS = Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    return [CX + 148 * Math.cos(a), CY + 148 * Math.sin(a)];
});

/**
 * Shade one point of the icon. `k` scales the foreground geometry (maskable
 * icons shrink it into the safe zone); `round` controls the plate corners.
 */
const shade = (x, y, k, round) => {
    // Plate background gradient (top-left → bottom-right).
    const tBg = clamp01((x + y) / (W * 2));
    let [r, g, b] = mix(BG_TOP, BG_BOT, tBg);

    // Radial gold glow behind the door.
    const gd = Math.hypot(x - CX, y - (CY - 31)) / 320;
    if (gd < 1) {
        const gi = (1 - gd) * (1 - gd) * 0.34;
        r += 246 * gi;
        g += 195 * gi;
        b += 75 * gi;
    }

    // Diagonal sheen across the upper-left triangle.
    if (x + y < W) {
        r += 7.6;
        g += 7.6;
        b += 7.6;
    }

    const put = (col, a) => {
        r = r + (col[0] - r) * a;
        g = g + (col[1] - g) * a;
        b = b + (col[2] - b) * a;
    };

    // Everything below is foreground geometry (scaled about the centre).
    const gx = (x - CX) / k + CX;
    const gy = (y - CY) / k + CY;
    const dx = gx - CX;
    const dy = gy - CY;
    const d = Math.hypot(dx, dy);
    const tGold = clamp01((gx + gy) / (W * 2));

    // Framing ring.
    if (Math.abs(d - 228) <= 3) put(GOLD_MID, 0.3);

    // Vault-door ring (26px band).
    const ring = Math.abs(d - 148) - 13;
    if (ring <= 0) put(mix3(GOLD_LO, GOLD_MID, GOLD_HI, tGold), 1);

    // Specular arc on the top-left of the ring.
    if (Math.abs(d - 148) <= 3.5) {
        const ang = Math.atan2(dy, dx); // (-π, π]
        if (ang >= -2.62 && ang <= -1.72) put(SPEC, 0.9);
    }

    // Door bolts.
    for (const [bx, by] of BOLTS) {
        if (Math.hypot(gx - bx, gy - by) <= 9.5) {
            put(BOLT, 0.85);
            break;
        }
    }

    // Market-ascent line (capsule distance per segment).
    let seg = Infinity;
    for (let i = 0; i < CHART.length - 1; i++) {
        const [ax, ay] = CHART[i];
        const [bx, by] = CHART[i + 1];
        seg = Math.min(seg, sdSegment(gx, gy, ax, ay, bx, by));
        if (seg <= 0) break;
    }
    if (seg <= 11) put(mix(LINE_LO, LINE_HI, clamp01((gx + gy) / (W * 2))), 1);

    // Glowing teal cap dot (soft halo, then solid core).
    const dot = Math.hypot(gx - 346, gy - 206);
    if (dot < 52 && dot > 15) put(TEAL, (1 - dot / 52) * 0.28);
    if (dot <= 15) put(TEAL, 1);

    // Plate clip (rounded corners, or full bleed for maskable).
    const edge = sdRoundRect(x, y, W / 2, W / 2, round);
    const alpha = edge <= 0 ? 1 : 0;

    return [r, g, b, alpha];
};

/** Render an icon of `size` px, supersampled 4× for antialiasing. */
const renderIcon = (size, { maskable = false } = {}) => {
    const SS = 4;
    const N = size * SS;
    const k = maskable ? 0.78 : 1;
    const round = maskable ? 0 : Math.round(W * 0.226);
    const acc = new Float64Array(size * size * 4);
    for (let py = 0; py < N; py++) {
        for (let px = 0; px < N; px++) {
            const [r, g, b, a] = shade(((px + 0.5) / N) * W, ((py + 0.5) / N) * W, k, round);
            const i = ((py / SS) | 0) * size + ((px / SS) | 0);
            const o = i * 4;
            acc[o] += r;
            acc[o + 1] += g;
            acc[o + 2] += b;
            acc[o + 3] += a;
        }
    }
    const out = Buffer.alloc(size * size * 4);
    const div = SS * SS;
    for (let i = 0; i < size * size; i++) {
        const o = i * 4;
        out[o] = Math.max(0, Math.min(255, Math.round(acc[o] / div)));
        out[o + 1] = Math.max(0, Math.min(255, Math.round(acc[o + 1] / div)));
        out[o + 2] = Math.max(0, Math.min(255, Math.round(acc[o + 2] / div)));
        out[o + 3] = Math.max(0, Math.min(255, Math.round(acc[o + 3] / div)));
    }
    return encodePng(size, size, out);
};

/* ------------------------------------------------------------------- write */

const outDir = path.join(__dirname, '..', 'public');
const targets = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opts] of targets) {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, renderIcon(size, opts));
    console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
