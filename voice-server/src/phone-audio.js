const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function linearToMulaw(sample) {
  let pcm = sample | 0;
  const sign = (pcm >> 8) & 0x80;
  if (sign !== 0) pcm = -pcm;
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; exponent -= 1, mask >>= 1);

  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function pcmToPcmuBase64(base64, state, sampleRate = 24000) {
  const step = sampleRate >= 24000 ? 3 : 1;
  const incoming = Buffer.from(base64, "base64");
  const buf = state.carry?.length ? Buffer.concat([state.carry, incoming]) : incoming;
  const usable = buf.length - (buf.length % 2);
  state.carry = Buffer.from(buf.subarray(usable));

  const out = [];
  for (let i = 0; i < usable; i += 2) {
    state.acc += buf.readInt16LE(i);
    state.accCount += 1;
    if (state.accCount === step) {
      out.push(linearToMulaw(Math.round(state.acc / step)));
      state.acc = 0;
      state.accCount = 0;
    }
  }

  return out.length ? Buffer.from(out).toString("base64") : "";
}

export function emptyPcmState() {
  return { carry: Buffer.alloc(0), acc: 0, accCount: 0 };
}

export function isPcmFormat(format) {
  return format === "audio/pcm" || format === "pcm16";
}
