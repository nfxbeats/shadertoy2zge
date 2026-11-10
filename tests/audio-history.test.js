const assert = require('node:assert/strict');
const vm = require('node:vm');
const { analyzeAudioMarkers, buildAudioBufferUpdateCode, validateAudioBufferParameters } = require('../audio-analysis.js');

const helpers = `
int AudioBuffer1Mode = 0;
int AudioBuffer1Source = 0;
int AudioBuffer2Mode = 5;
int AudioBuffer2Source = 1;
int AudioBuffer2HistoryFrames = 3;
float AudioBuffer2HistoryInterval = 0.1;
float AudioFFT(float freq) { return freq; }
float AudioBuffer1(float freq) { return AudioFFT(freq); }
float AudioBuffer2(float freq, float age) { return AudioFFT(freq); }
void mainImage(out vec4 color, in vec2 pixel) { color = vec4(AudioBuffer2(0.4, 1.0)); }
`;
const analysis = analyzeAudioMarkers(helpers);
assert.deepEqual(analysis.errors, []);
assert.deepEqual(analysis.orderedBuffers.map(buffer => buffer.id), ['1', '2']);
assert.equal(analysis.orderedBuffers[1].historyFrames, 3);
assert.equal(analysis.orderedBuffers[1].historyInterval, 0.1);
assert.deepEqual(validateAudioBufferParameters(analysis.orderedBuffers, []), []);
const defaults = analyzeAudioMarkers(helpers.replace('int AudioBuffer2HistoryFrames = 3;', '').replace('float AudioBuffer2HistoryInterval = 0.1;', ''));
assert.equal(defaults.orderedBuffers[1].historyFrames, 128);
assert.equal(defaults.orderedBuffers[1].historyInterval, 1 / 30);
for (const value of ['0', '1', '2049', '2.5', '3.0', 'bad']) {
    assert.match(analyzeAudioMarkers(helpers.replace('HistoryFrames = 3', `HistoryFrames = ${value}`)).errors.join(' '), /HistoryFrames/);
}
for (const value of ['0.0', '-1.0', '61.0', 'bad']) {
    assert.match(analyzeAudioMarkers(helpers.replace('HistoryInterval = 0.1', `HistoryInterval = ${value}`)).errors.join(' '), /HistoryInterval/);
}
assert.match(analyzeAudioMarkers(helpers.replace('int AudioBuffer2HistoryFrames', 'float AudioBuffer2HistoryFrames')).errors.join(' '), /HistoryFrames/);
assert.match(analyzeAudioMarkers(helpers.replace('int AudioBuffer2HistoryFrames = 3', 'bool AudioBuffer2HistoryFrames = true')).errors.join(' '), /HistoryFrames/);
assert.match(analyzeAudioMarkers(helpers.replace('AudioBuffer2Mode = 5', 'AudioBuffer2Mode = 0')).errors.join(' '), /requires mode 5/);
assert.match(analyzeAudioMarkers(helpers.replace('AudioBuffer1Source = 0', 'AudioBuffer1Source = 2')).errors.join(' '), /cycle/);
assert.match(analyzeAudioMarkers(helpers.replace('int AudioBuffer2HistoryFrames = 3;', 'int AudioBuffer2HistoryFrames = 3;\nint AudioBuffer2HistoryFrames = 4;')).errors.join(' '), /HistoryFrames/);

// Execute the real ZGE update arithmetic after translating its declarations.
// GPU storage is exercised separately by audio-history-gpu.test.py.
const generated = buildAudioBufferUpdateCode(analysis.orderedBuffers, {});
const js = generated.replace(/\b(?:int|float)\s+/g, 'var ');
const sized = values => Object.assign(values, { SizeDim1: values.length });
function instance() {
    return vm.createContext({
        SpecBandArray: sized([0, 0]), AudioBuffer1: sized([0, 0]), AudioBuffer2: sized([0, 0]),
        AudioBuffer2History: { values: [] }, AudioBuffer2HistoryBins: 0, AudioBuffer2HistoryCapture: 0,
        AudioBuffer2HistoryTarget: {}, AudioBuffer2HistoryPrevious: {},
        AudioBuffer2HistoryHead: 0, AudioBuffer2HistoryCount: 0, AudioBuffer2HistoryClock: 0,
        App: { DeltaTime: 0 }, round: Math.round,
    });
}
function update(state, values, dt) {
    state.SpecBandArray = sized(values);
    state.App.DeltaTime = dt;
    vm.runInContext(js, state);
    // Model the two R32F GPU passes: overwrite one row, retain other rows,
    // clear unused rows on the first capture, then copy to the read target.
    if (state.AudioBuffer2HistoryCapture) {
        if (state.AudioBuffer2HistoryCount === 1) state.AudioBuffer2History.values = [];
        for (let bin = 0; bin < values.length; bin++) {
            state.AudioBuffer2History.values[bin + values.length * state.AudioBuffer2HistoryHead] = state.AudioBuffer2[bin];
        }
        state.AudioBuffer2HistoryCapture = 0;
    }
}
function read(state, bin, age) {
    if (age >= state.AudioBuffer2HistoryCount) return 0;
    const row = (state.AudioBuffer2HistoryHead - age + 3) % 3;
    return state.AudioBuffer2History.values[bin + row * state.AudioBuffer2HistoryBins];
}
const state = instance();
update(state, [1, 10], 0);
assert.deepEqual([read(state, 0, 0), read(state, 1, 0), read(state, 0, 1)], [1, 10, 0]);
update(state, [2, 20], 0.04);
assert.equal(read(state, 0, 0), 1);
assert.equal(state.AudioBuffer2[0], 2); // One-argument view stays current.
update(state, [3, 30], 0.06);
assert.deepEqual([read(state, 0, 0), read(state, 0, 1), read(state, 1, 1)], [3, 1, 10]);
update(state, [4, 40], 0.1);
update(state, [5, 50], 0.1);
assert.equal(state.AudioBuffer2HistoryCount, 3);
assert.deepEqual([read(state, 0, 0), read(state, 0, 1), read(state, 0, 2)], [5, 4, 3]);
update(state, [6, 60], 5); // A stall captures once, with no fabricated frames.
assert.deepEqual([read(state, 1, 0), read(state, 1, 1), read(state, 1, 2)], [60, 50, 40]);
update(state, [7, 70], 0); // Paused time does not advance history.
assert.equal(read(state, 0, 0), 6);
update(state, [8, 80, 800], 0.1); // Host FFT-size changes reset old history.
assert.equal(state.AudioBuffer2HistoryCount, 1);
assert.deepEqual([read(state, 2, 0), read(state, 0, 1)], [800, 0]);
update(state, [], 0.1);
assert.equal(state.AudioBuffer2HistoryCount, 0);
update(state, [9, 90], 0.1);
assert.equal(read(state, 1, 0), 90);
state.AudioBuffer2HistoryCount = 0; // Graphics-context recreation.
state.AudioBuffer2HistoryClock = 0;
update(state, [10, 100], 0);
assert.equal(read(state, 1, 0), 100);
assert.equal(read(state, 1, 1), 0);
const otherInstance = instance();
update(otherInstance, [100, 1000], 0.1);
assert.equal(read(state, 1, 0), 100);
assert.equal(read(otherInstance, 1, 0), 1000);
console.log('audio history tests passed');
