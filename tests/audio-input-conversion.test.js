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
    }
    console.log('audio input conversion tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
