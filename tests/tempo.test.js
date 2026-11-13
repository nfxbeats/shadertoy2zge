const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Tempo = require('../tempo.js');
const { converter } = require('./audio-input-conversion.test.js');

const helper = 'float TempoBeats() { /* } */ if(iTime<0.0){return 0.0;} return iTime*2.0; }';
const source = '// ZGETempo: version=1 source=host fallbackBpm=120\n' + helper;
assert.equal(Tempo.convert(helper), null);
assert.equal(Tempo.convert('/*\n' + source + '\n*/'), null);
assert.match(Tempo.convert(source), /return max\(tempoHostBeats, 0.0\);/);
assert.doesNotMatch(Tempo.convert(source), /return iTime/);
assert.match(Tempo.convert('// ZGETempo\n' + helper), /uniform float tempoHostBeats;/);
for (const [before, after] of [['version=1', 'version=2'], ['source=host', 'source=fft'], ['fallbackBpm=120', 'fallbackBpm=0'], ['fallbackBpm=120', 'fallbackBpm=NaN'], ['fallbackBpm=120', 'fallbackBpm=120 typo=1']]) {
    assert.throws(() => Tempo.convert(source.replace(before, after)), /ZGETempo/);
}
assert.throws(() => Tempo.convert(source + '\n// ZGETempo'), /exactly one/);
assert.throws(() => Tempo.convert('// ZGETempo'), /fallback definition/);
assert.throws(() => Tempo.convert(source + '\n' + helper), /fallback definition/);
assert.throws(() => Tempo.convert(source + '\nfloat tempoHostBeats;'), /reserved/);

async function run() {
    const localSample = path.join(__dirname, '../samples/tempoanim.txt');
    const sample = fs.readFileSync(fs.existsSync(localSample) ? localSample : path.join(__dirname, 'fixtures/tempoanim.glsl'), 'utf8');
    for (const template of ['basic', 'basic_120', 'basic_130']) {
        const elements = converter();
        elements.get('templateSelect').value = `templates/${template}.zgeproj`;
        async function convert(code) {
            elements.get('inputCode').value = code;
            elements.get('inputCode').listeners.input();
            elements.get('ichannel0Source').value = 'bitmap1';
            await elements.get('convertButton').listeners.click();
            return elements.get('outputCode').value;
        }
        const output = await convert(sample);
        assert.ok(output.length > 0);
        assert.match(output, /VariableName="tempoHostBeats" VariableRef="SongPositionInBeats"/);
        assert.equal((output.match(/<Variable Name="SongPositionInBeats"\/>/g) || []).length, 1);
        assert.match(output, /return max\(tempoHostBeats, 0.0\);/);
        assert.match(output, /float cycleBeat = mod\(beats, triggerBeats\);/);
        assert.match(output, /float cycleTime = mod\(max\(iTime, 0.0\), cycleDuration\);/);
        const unchanged = await convert(sample.replace(/^\/\/ ZGETempo[^\n]*\n/m, ''));
        assert.doesNotMatch(unchanged, /tempoHostBeats|SongPositionInBeats/);
        assert.match(unchanged, /return iTime \* \(120.0 \/ 60.0\);/);
        assert.equal(await convert(sample.replace('version=1', 'version=9')), '');

        // Common code must receive the same host clock in every generated pass.
        const container = `// ZGEContainer: 1
// ZGEBegin: Common
${source}
// ZGEEnd: Common
// ZGEBegin: BufferA
// ZGETarget: size=1x1 format=RGBA32F filter=nearest wrap=clamp
// ZGEInitial: 0,0,0,0
void mainImage(out vec4 c,in vec2 p){c=vec4(TempoBeats());}
// ZGEEnd: BufferA
// ZGEBegin: Image
void mainImage(out vec4 c,in vec2 p){c=vec4(TempoBeats());}
// ZGEEnd: Image`;
        const multi = await convert(container);
        assert.ok(multi.length > 0);
        assert.equal((multi.match(/VariableName="tempoHostBeats"/g) || []).length, 2);
        assert.equal((multi.match(/<Variable Name="SongPositionInBeats"\/>/g) || []).length, 1);
    }
    console.log('tempo tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
