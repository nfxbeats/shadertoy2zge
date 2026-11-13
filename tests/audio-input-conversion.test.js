const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real converter click handler against each shipped template.
function converter() {
    const elements = new Map();
    function element(tag = 'div') {
        const classes = new Set();
        return {
            tag, style: {}, children: [], listeners: {}, value: '', innerHTML: '',
            set id(value) { this.identifier = value; elements.set(value, this); },
            get id() { return this.identifier; },
            classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
            appendChild(child) {
                this.children.push(child);
                if (this.tag === 'select' && this.children.length === 1) this.value = child.value;
            },
            addEventListener(name, callback) { this.listeners[name] = callback; },
            querySelectorAll() { return this.children; },
            setAttribute(name, value) { this[name] = value; },
        };
    }
    for (const id of ['inputCode', 'ichannelConfig', 'templateSelect', 'convertButton', 'outputCode', 'notification', 'outputActions']) {
        element(id === 'templateSelect' ? 'select' : 'div').id = id;
    }
    const context = vm.createContext({
        document: { getElementById: id => elements.get(id), createElement: element, querySelector: selector => elements.get(selector.slice(1)) },
        ...require('../audio-analysis.js'),
        TextOverlay: require('../text-overlay.js'), IChannelMapping: require('../ichannel-mapping.js'),
        VisualBuffers: require('../visual-buffers.js'),
        Tempo: require('../tempo.js'),
        pako: require('../pako.min.js'), console,
        setTimeout() { return 1; }, clearTimeout() {},
        fetch: async filename => ({ ok: true, text: async () => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8').replace(/\r\n/g, '\n') }),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), context);
    return elements;
}

async function run() {
    for (const template of ['basic', 'basic_120', 'basic_130']) {
        for (const waveform of [false, true]) {
            const elements = converter();
            assert.ok(elements.get('ichannel2Source').children.some(option => option.value === 'audio_waveform' && option.textContent.includes('AudioArray')));
            elements.get('templateSelect').value = `templates/${template}.zgeproj`;
            elements.get('inputCode').value = '// Title: Audio binding test\n// Author: NFX\nfloat ZGESize=0.5;\nfloat ZGEPositionX=0.5;\nfloat ZGEPositionY=0.5;\nvoid mainImage(out vec4 color,in vec2 pixel){color=texture(iChannel2,vec2(0.5,0.0))+texture(iChannel1,vec2(0.5,0.0))+texture(iChannel0,vec2(0.5));}';
            elements.get('inputCode').listeners.input();
            elements.get('ichannel2Source').value = waveform ? 'audio_waveform' : 'audio_spectrum';
            elements.get('ichannel1Source').value = 'audio_spectrum';
            elements.get('ichannel0Source').value = 'feedback';
            await elements.get('convertButton').listeners.click();
            const output = elements.get('outputCode').value;
            assert.ok(output.length > 0, elements.get('notification').children.map(child => child.textContent).join('\n'));
            assert.ok(output.includes(`<ShaderVariable VariableName="iChannel2" ValueArrayRef="${waveform ? 'AudioArray' : 'SpecBandArray'}"/>`));
            assert.ok(output.includes('<ShaderVariable VariableName="iChannel1" ValueArrayRef="SpecBandArray"/>'));
            assert.equal((output.match(/<Array Name="SpecBandArray"\//g) || []).length, 1);
            assert.equal((output.match(/<Array Name="AudioArray"\//g) || []).length, waveform ? 1 : 0);
            assert.ok(output.includes('uniform sampler2D iChannel2;'));
            assert.doesNotMatch(output, /#define iChannel[12] tex/);
            assert.doesNotMatch(output, /<MaterialTexture[^>]*(?:AudioArray|iChannel[12])/);
            assert.ok(output.includes('<MaterialTexture Name="FeedbackMaterialTexture"'));
        }
        const elements = converter();
        elements.get('templateSelect').value = `templates/${template}.zgeproj`;
        elements.get('inputCode').value = `// Title: Spectrum history test
// Author: NFX
float ZGESize = 0.5;
float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;
int AudioBuffer1Mode = 0;
int AudioBuffer1Source = 0;
int AudioBuffer2Mode = 5;
int AudioBuffer2Source = 1;
int AudioBuffer2HistoryFrames = 16;
float AudioBuffer2HistoryInterval = 0.1;
float AudioFFT(float freq) { return texture(iChannel2, vec2(freq,0.0)).r; }
float AudioBuffer1(float freq) { return AudioFFT(freq); }
float AudioBuffer2(float freq) { return AudioFFT(freq); }
float AudioBuffer2(float freq, float age) { return AudioFFT(freq); }
void mainImage(out vec4 color,in vec2 pixel) {
    color = vec4(AudioBuffer2(0.5, 3.0) + AudioBuffer2(0.2) + AudioFFT(0.1));
}`;
        elements.get('inputCode').listeners.input();
        // Waveform selection must not redirect semantic FFT/history helpers.
        elements.get('ichannel2Source').value = 'audio_waveform';
        await elements.get('convertButton').listeners.click();
        const output = elements.get('outputCode').value;
        assert.ok(output.length > 0);
        assert.match(output, /<RenderTarget Name="AudioBuffer2HistoryTarget"[^>]*InternalFormat="2"/);
        assert.match(output, /<MaterialTexture Name="AudioBuffer2HistoryTexture" RenderTarget="AudioBuffer2HistoryTarget"/);
        for (const property of ['Head', 'Count']) {
            assert.ok(output.includes(`<Variable Name="AudioBuffer2History${property}"/>`));
            assert.ok(output.includes(`VariableName="AudioBuffer2History${property}" ValuePropRef="AudioBuffer2History${property}"`));
        }
        assert.match(output, /uniform float AudioBuffer2HistoryHead;/);
        assert.match(output, /#define AudioBuffer2HistorySampler tex1/);
        assert.match(output, /historyAge >= AudioBuffer2HistoryCount/);
        assert.match(output, /texture2D\(AudioBuffer2HistorySampler, vec2\(clamp\(freq, 0.0, 1.0\), \(historyRow \+ 0.5\) \/ 16.0\)\)/);
        assert.match(output, /texture2D\(AudioBuffer2Sampler,/);
        assert.ok(output.indexOf('audioCurrent1 = SpecBandArray') < output.indexOf('AudioBuffer2HistoryCapture = 1'));
        assert.match(output, /VariableName="currentSpectrum" ValueArrayRef="AudioBuffer2"/);
        assert.match(output, /if\(floor\(gl_FragCoord.y\)==historyHead\) value=texture2D\(currentSpectrum,/);
        assert.match(output, /else if\(historyCount>1.0\) value=texture2D\(tex1,uv\).r/);
        assert.ok(output.indexOf('Capture spectrum history 2') < output.indexOf('<UseMaterial Material="mCanvas"'));
        assert.match(output, /OnGLContextChange\(\)\{AudioBuffer2HistoryCount=0/);
        assert.match(output, /VariableName="AudioFFTSampler" ValueArrayRef="SpecBandArray"/);
        assert.match(output, /VariableName="iChannel2" ValueArrayRef="AudioArray"/);

        // Material textures stay contiguous when array-backed channels coexist
        // with feedback, an internal bitmap, and the internal history target.
        elements.get('inputCode').value = elements.get('inputCode').value.replace(
            'AudioFFT(0.1));', 'AudioFFT(0.1)) + texture(iChannel0, vec2(0.5)) + texture(iChannel3, vec2(0.5));');
        elements.get('inputCode').listeners.input();
        elements.get('ichannel0Source').value = 'feedback';
        elements.get('ichannel3Source').value = 'internal';
        await elements.get('convertButton').listeners.click();
        const mixedOutput = elements.get('outputCode').value;
        assert.match(mixedOutput, /#define iChannel0 tex1/);
        assert.match(mixedOutput, /#define iChannel3 tex2/);
        assert.match(mixedOutput, /#define AudioBuffer2HistorySampler tex3/);
        assert.doesNotMatch(mixedOutput, /#define iChannel2 tex/);

        // Text overlay and audio history must share one graphics-context reset
        // callback, retaining initialization/reset behavior for both systems.
        elements.get('inputCode').value = elements.get('inputCode').value
            .replace('texture(iChannel3, vec2(0.5))', 'texture(iChannel1, vec2(0.5))')
            .replace('// Author: NFX', '// Author: NFX\n// ZGETextOverlay: output=iChannel3');
        elements.get('inputCode').listeners.input();
        elements.get('ichannel1Source').value = 'internal';
        await elements.get('convertButton').listeners.click();
        const textOutput = elements.get('outputCode').value;
        assert.equal((textOutput.match(/void OnGLContextChange\(/g) || []).length, 1);
        assert.match(textOutput, /OnGLContextChange\(\) \{AudioBuffer2HistoryCount=0;[^}]*textOverlayInitNanoVG\(\)/);
    }
    console.log('audio input conversion tests passed');
}
module.exports = { converter };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
