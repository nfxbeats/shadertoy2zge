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
