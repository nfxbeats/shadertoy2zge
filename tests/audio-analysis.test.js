const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeAudioMarkers, buildAudioBufferUpdateCode, validateAudioBufferParameters } = require('../audio-analysis.js');

function analyze(body, helpers = '') {
    return analyzeAudioMarkers(`${helpers}\nvoid mainImage(out vec4 color, in vec2 pixel) { ${body} }`);
}

const fallbackHelpers = `
float AudioFFT(float frequency) { return frequency; }
float AudioBuffer1(float frequency) { return AudioFFT(frequency); }
float AudioBuffer2(float frequency) { return AudioFFT(frequency); }
float AudioBuffer37(float frequency) { return AudioFFT(frequency); }
`;

assert.deepEqual(analyze('color = vec4(1.0);', fallbackHelpers).numberedBuffers, []);
assert.deepEqual(
    analyze('color = vec4(AudioBuffer1(0.2));', fallbackHelpers).errors,
    ['AudioBuffer1 requires integer AudioBuffer1Mode and AudioBuffer1Source declarations.']
);
const mixed = analyze('color = vec4(AudioFFT(0.1) + AudioBuffer37(0.2) + AudioBuffer2(0.3));', fallbackHelpers);
assert.equal(mixed.usesAudioFFT, true);
assert.deepEqual(mixed.numberedBuffers, ['2', '37']);

const indirect = `
float AudioBuffer3(float frequency) { return frequency; }
float audioSample(float frequency, bool buffered) { return AudioBuffer3(frequency); }
float fftAvg(float frequency) { return audioSample(frequency, true); }
float bandEnvFromFreqIndex(float frequency) { return fftAvg(frequency); }
`;
assert.deepEqual(analyze('color = vec4(bandEnvFromFreqIndex(0.4));', indirect).numberedBuffers, ['3']);

const unusedChain = `${indirect}\nfloat unused(float frequency) { return AudioBuffer9(frequency); }`;
assert.deepEqual(analyze('color = vec4(1.0);', unusedChain).numberedBuffers, []);

const dependencies = `
const int AudioBuffer1Mode = 1;
const int AudioBuffer1Source = 2;
const int AudioBuffer2Mode = 0;
const int AudioBuffer2Source = 0;
float AudioBuffer1(float frequency) { return AudioFFT(frequency); }
float AudioBuffer2(float frequency) { return AudioFFT(frequency); }
`;
const dependencyAnalysis = analyze('color = vec4(AudioBuffer1(0.2));', dependencies);
assert.deepEqual(dependencyAnalysis.errors, []);
assert.deepEqual(dependencyAnalysis.orderedBuffers, [
    { id: '2', mode: 0, source: 0 },
    { id: '1', mode: 1, source: 2 },
]);

const cycle = dependencies
    .replace('AudioBuffer2Source = 0', 'AudioBuffer2Source = 1');
assert.match(analyze('color = vec4(AudioBuffer1(0.2));', cycle).errors[0], /dependency cycle/);

const unsupported = dependencies.replace('AudioBuffer1Mode = 1', 'AudioBuffer1Mode = 99');
assert.match(analyze('color = vec4(AudioBuffer1(0.2));', unsupported).errors[0], /Unsupported audio buffer mode/);

const expressions = { attack: 'ATTACK', decay: 'DECAY', peakDecay: 'PEAK_DECAY', trailsDecay: 'TRAIL_DECAY' };
const boundHelpers = `
// Buffer 1 uses ZGELoAttack / ZGELoDecay.
// AudioBuffer2 uses ZGEMidAttack / ZGEMidDecay.
int AudioBuffer1Mode = 1;
int AudioBuffer1Source = 0;
int AudioBuffer2Mode = 1;
int AudioBuffer2Source = 0;
float AudioBuffer1(float f) { return AudioFFT(f); }
float AudioBuffer2(float f) { return AudioFFT(f); }
`;
const boundAnalysis = analyze('color = vec4(AudioBuffer1(0.1) + AudioBuffer2(0.2));', boundHelpers);
assert.deepEqual(boundAnalysis.errors, []);
assert.equal(boundAnalysis.orderedBuffers[0].attackParameter, 'LoAttack');
assert.equal(boundAnalysis.orderedBuffers[1].decayParameter, 'MidDecay');
assert.deepEqual(validateAudioBufferParameters(boundAnalysis.orderedBuffers,
    ['LoAttack', 'LoDecay', 'MidAttack', 'MidDecay']), []);
assert.deepEqual(validateAudioBufferParameters(boundAnalysis.orderedBuffers,
    ['LoAttack', 'LoDecay', 'MidAttack']), ['AudioBuffer2 mode 1 requires ZGEMidDecay.']);
assert.deepEqual(validateAudioBufferParameters(dependencyAnalysis.orderedBuffers, ['Attack', 'Decay']), []);
assert.match(validateAudioBufferParameters(dependencyAnalysis.orderedBuffers, [])[0], /ZGEAttack and ZGEDecay/);

// Distinct coefficients must produce distinct rise and fall behavior per buffer.
const boundUpdates = buildAudioBufferUpdateCode(boundAnalysis.orderedBuffers, {
    ...expressions,
    buffers: { '1': { attack: '0.0', decay: '0.0' }, '2': { attack: '1000.0', decay: '1000.0' } },
});
const stepEnvelopes = new Function('SpecBandArray', 'AudioBuffer1', 'AudioBuffer2', 'App', 'exp', 'abs', 'clamp',
    boundUpdates.replace(/\b(?:float|int)\b/g, 'let'));
const envelopeInput = [1], fastEnvelope = [0], slowEnvelope = [0];
for (const array of [envelopeInput, fastEnvelope, slowEnvelope]) array.SizeDim1 = 1;
const step = () => stepEnvelopes(envelopeInput, fastEnvelope, slowEnvelope, { FpsCounter: 60 },
    Math.exp, Math.abs, (value, min, max) => Math.min(max, Math.max(min, value)));
step();
assert.equal(fastEnvelope[0], 1);
assert.ok(slowEnvelope[0] > 0 && slowEnvelope[0] < 0.02);
const slowPeak = slowEnvelope[0];
envelopeInput[0] = 0;
step();
assert.equal(fastEnvelope[0], 0);
assert.ok(slowEnvelope[0] > 0 && slowEnvelope[0] < slowPeak);

const updateCode = buildAudioBufferUpdateCode(dependencyAnalysis.orderedBuffers, expressions);
assert.ok(updateCode.indexOf('AudioBuffer2.SizeDim1') < updateCode.indexOf('AudioBuffer1.SizeDim1'));
assert.match(updateCode, /audioCurrent2 = SpecBandArray\[audioBin2\]/);
assert.match(updateCode, /audioCurrent1 = AudioBuffer2\[audioBin1\]/);
assert.doesNotMatch(updateCode, /audioPrevious2|audioCoeff2/);
assert.match(updateCode, /audioPrevious1|audioCoeff1/);

const decayModes = buildAudioBufferUpdateCode([
    { id: '2', mode: 2, source: 0 },
    { id: '3', mode: 3, source: 2 },
], expressions);
assert.match(decayModes, /audioCurrent2 > audioPrevious2 - \(PEAK_DECAY\) \* App\.DeltaTime \? audioCurrent2/);
assert.match(decayModes, /audioCurrent3 = AudioBuffer2\[audioBin3\]/);
assert.match(decayModes, /audioCurrent3 > audioPrevious3 \* exp\(-\(TRAIL_DECAY\) \* App\.DeltaTime\) \? audioCurrent3/);
assert.doesNotMatch(decayModes, /\bmax\s*\(/);

const accumulateHelpers = `
int AudioBuffer1Mode = 4;
int AudioBuffer1Source = 2;
int AudioBuffer2Mode = 0;
int AudioBuffer2Source = 0;
float AudioBuffer1(float frequency) { return AudioFFT(frequency); }
float AudioBuffer2(float frequency) { return AudioFFT(frequency); }
`;
const accumulateAnalysis = analyze('color = vec4(AudioBuffer1(0.2));', accumulateHelpers);
assert.deepEqual(accumulateAnalysis.errors, []);
assert.deepEqual(accumulateAnalysis.orderedBuffers.map(buffer => buffer.id), ['2', '1']);
assert.deepEqual(validateAudioBufferParameters(accumulateAnalysis.orderedBuffers, []), []);

// Execute the generated arithmetic across frames; the supplied arrays model
// ZGE's zero-initialized float arrays (SizeDim1 is their element count).
const accumulateCode = buildAudioBufferUpdateCode(accumulateAnalysis.orderedBuffers, expressions);
const stepAccumulation = new Function('SpecBandArray', 'AudioBuffer1', 'AudioBuffer2', 'App',
    accumulateCode.replace(/\b(?:float|int)\b/g, 'let'));
const spectrum = [2, -3, 0];
const accumulated = [0, 0, 0];
const copied = [0, 0, 0];
for (const array of [spectrum, accumulated, copied]) array.SizeDim1 = array.length;
stepAccumulation(spectrum, accumulated, copied, { DeltaTime: 0.5 });
assert.deepEqual(Array.from(accumulated), [1, 0, 0]);
stepAccumulation(spectrum, accumulated, copied, { DeltaTime: 0.25 });
assert.deepEqual(Array.from(accumulated), [1.5, 0, 0]);
spectrum.fill(0);
stepAccumulation(spectrum, accumulated, copied, { DeltaTime: 3 });
assert.deepEqual(Array.from(accumulated), [1.5, 0, 0]);
spectrum[0] = 8;
stepAccumulation(spectrum, accumulated, copied, { DeltaTime: 0 });
assert.deepEqual(Array.from(accumulated), [1.5, 0, 0]);

const rawAccumulate = buildAudioBufferUpdateCode([{ id: '4', mode: 4, source: 0 }], expressions);
assert.match(rawAccumulate, /audioCurrent4 = SpecBandArray\[audioBin4\]/);
assert.match(rawAccumulate, /AudioBuffer4\[audioBin4\] \+ .*App\.DeltaTime/);

const audioBufferTestSource = fs.readFileSync(path.join(__dirname, '..', 'AudioBufferTest.txt'), 'utf8');
const audioBufferTestAnalysis = analyzeAudioMarkers(audioBufferTestSource);
assert.deepEqual(audioBufferTestAnalysis.errors, []);
assert.deepEqual(audioBufferTestAnalysis.orderedBuffers.map(buffer => buffer.id), ['1', '2', '3', '4']);
const fixtureParameterIds = Array.from(audioBufferTestSource.matchAll(/\b(?:float|bool)\s+ZGE(\w+)\s*=/g), match => match[1]);
assert.deepEqual(validateAudioBufferParameters(audioBufferTestAnalysis.orderedBuffers, fixtureParameterIds), []);
const fixtureUpdates = buildAudioBufferUpdateCode(audioBufferTestAnalysis.orderedBuffers, expressions);
assert.match(fixtureUpdates, /audioCurrent2 = AudioBuffer1\[audioBin2\]/);
assert.match(fixtureUpdates, /audioCurrent3 = AudioBuffer1\[audioBin3\]/);
assert.match(fixtureUpdates, /audioCurrent4 = AudioBuffer3\[audioBin4\]/);

console.log('audio-analysis tests passed');
