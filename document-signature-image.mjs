import { matchesFileType } from './file-limits.mjs';

const inputLimit = 2_000_000;
const encodedLimit = 128_000;
const fail = code => { throw Object.assign(new Error(code), { code }); };

export async function prepareDocumentSignature(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 9 || file.size > inputLimit) fail('signature-size');
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const mime = ['image/png', 'image/jpeg'].find(type => matchesFileType(bytes, type));
    if (!mime || (file.type && file.type !== mime)) fail('signature-type');
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const width = image.naturalWidth, height = image.naturalHeight;
        if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) fail('signature-dimensions');
        // Re-encode a bounded raster image; keep transparency and discard original metadata.
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) fail('signature-image');
        const fit = Math.min(1, 960 / width, 320 / height);
        for (const factor of [1, 0.82, 0.66, 0.52, 0.40]) {
            canvas.width = Math.max(1, Math.round(width * fit * factor));
            canvas.height = Math.max(1, Math.round(height * fit * factor));
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL('image/png');
            if (data.startsWith('data:image/png;base64,') && data.length <= encodedLimit) return data;
        }
        fail('signature-dimensions');
    } finally {
        URL.revokeObjectURL(url);
    }
}
