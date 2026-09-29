import assert from "node:assert/strict";
import test from "node:test";
import { emptyPcmState, linearToMulaw, pcmToPcmuBase64 } from "./phone-audio.js";

test("el silencio PCM se vuelve el silencio de la línea", () => {
  assert.equal(linearToMulaw(0), 0xff);
  assert.equal(linearToMulaw(32767), 0x80);
  assert.equal(linearToMulaw(-32768), 0x00);
});

test("24 kHz baja a 8 kHz μ-law", () => {
  const samples = Buffer.alloc(6);
  samples.writeInt16LE(0, 0);
  samples.writeInt16LE(0, 2);
  samples.writeInt16LE(0, 4);
  const state = emptyPcmState();
  const encoded = Buffer.from(pcmToPcmuBase64(samples.toString("base64"), state, 24000), "base64");
  assert.equal(encoded.length, 1);
  assert.equal(encoded[0], 0xff);
});

test("un pico fuerte no sale como silencio", () => {
  const samples = Buffer.alloc(6);
  samples.writeInt16LE(20000, 0);
  samples.writeInt16LE(20000, 2);
  samples.writeInt16LE(20000, 4);
  const encoded = Buffer.from(
    pcmToPcmuBase64(samples.toString("base64"), emptyPcmState(), 24000),
    "base64"
  );
  assert.equal(encoded.length, 1);
  assert.notEqual(encoded[0], 0xff);
  assert.notEqual(encoded[0], 0x00);
});
