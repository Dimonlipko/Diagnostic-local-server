// --- js/core/isotp.js ---
// Розбір рядків ELM327 (ATH1 ATS0 ATCAF0) і збірка ISO-TP. Чисті функції, без I/O.

const FRAME_RE = /^([0-9A-F]{3})([0-9A-F]{2,16})$/;

export function toHex(bytes) {
    return Array.from(bytes, (v) => v.toString(16).toUpperCase().padStart(2, '0')).join('');
}

export function fromHex(hex) {
    const out = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

export function parseFrame(line) {
    const clean = line.replace(/\s+/g, '').toUpperCase();
    const m = FRAME_RE.exec(clean);
    if (!m || m[2].length % 2) return null;
    return { id: parseInt(m[1], 16), data: fromHex(m[2]) };
}

// Текстові відповіді адаптера, що означають стан, а не дані.
export function classifyLine(line) {
    const s = line.replace(/\s+/g, '').toUpperCase();
    if (s === 'NODATA') return 'nodata';
    if (s === 'BUFFERFULL') return 'buffer';
    if (s === 'CANERROR' || s === 'BUSERROR' || s === 'BUSBUSY') return 'bus';
    if (s === 'UNABLETOCONNECT') return 'bus';
    if (s.startsWith('<RXERROR') || s.startsWith('<DATAERROR') || s.startsWith('<CRC')) return 'rx';
    if (/^ERR\d/.test(s) || s.startsWith('ELM327') || s === 'LVRESET') return 'reset';
    if (s.startsWith('AT')) return 'echo';
    return null;
}

export class IsoTpRx {
    constructor(respId) {
        this.respId = respId;
        this.need = 0;
        this.buf = [];
        this.nextSeq = 1;
        this.payload = null;   // зібрана відповідь
        this.nrc = null;       // { sid, code }
        this.pending = false;  // був 7F xx 78 без остаточної відповіді
        this.broken = false;   // пропущений CF: збирати далі не можна
        this.cfCount = 0;
    }

    get started() { return this.need > 0; }
    get done() { return this.payload !== null || this.nrc !== null; }
    get have() { return this.buf.length; }

    push(frame) {
        if (frame.id !== this.respId || this.done || !frame.data.length) return;
        const d = frame.data;
        const type = d[0] >> 4;

        if (type === 0) {
            const len = d[0] & 0x0F;
            const body = d.slice(1, 1 + len);
            if (body[0] === 0x7F && body.length >= 3) {
                // responsePending: ECU просить часу, остаточна відповідь прийде окремо
                if (body[2] === 0x78) { this.pending = true; return; }
                this.nrc = { sid: body[1], code: body[2] };
                return;
            }
            this.payload = body;
            return;
        }

        if (type === 1) {
            this.need = ((d[0] & 0x0F) << 8) | d[1];
            this.buf = Array.from(d.slice(2));
            this.nextSeq = 1;
            this.pending = false;
            return;
        }

        if (type === 2 && this.started && !this.broken) {
            const seq = d[0] & 0x0F;
            if (seq !== this.nextSeq) {
                // Нулі на місці пропуску дали б правдоподібну, але хибну напругу комірки.
                this.broken = true;
                return;
            }
            this.nextSeq = (seq + 1) & 0x0F;
            this.cfCount++;
            this.buf.push(...d.slice(1));
            if (this.buf.length >= this.need) {
                this.payload = Uint8Array.from(this.buf.slice(0, this.need));
            }
        }
    }
}
