const assert = require('node:assert/strict');
const { parseIChannelMappings, resolveIChannelMappings, sourceLabel } = require('../ichannel-mapping.js');

const empty = parseIChannelMappings('void mainImage() {}');
assert.equal(empty.assignments.size, 0);
assert.deepEqual(empty.errors, []);

const mapped = parseIChannelMappings(`
// iChannel0: Feedback
// iChannel1: Image Src
`);
assert.equal(mapped.assignments.get(0), 'feedback');
assert.equal(mapped.assignments.get(1), 'bitmap1');
assert.deepEqual(mapped.errors, []);
assert.equal(sourceLabel('bitmap1'), 'Image Src');

const aliases = parseIChannelMappings('// ichannel2: image source');
assert.equal(aliases.assignments.get(2), 'bitmap1');

const invalid = parseIChannelMappings('// iChannel0: Camera');
assert.match(invalid.errors[0], /use Feedback, ImageSrc.*FFT, or Text/);

const duplicate = parseIChannelMappings('// iChannel1: Feedback\n// iChannel1: Image Src');
assert.match(duplicate.errors[0], /assigned more than once/);

const twoFeedback = parseIChannelMappings('// iChannel0: Feedback\n// iChannel3: Feedback');
assert.match(twoFeedback.errors[0], /Only one iChannel/);


const TextOverlay = require('../text-overlay.js');
for (const alias of ['ImageSrc', 'IMAGE SRC', 'image_source', 'image-source']) {
    assert.equal(parseIChannelMappings(`// iChannel1: ${alias}`).assignments.get(1), 'bitmap1');
}
for (const alias of ['FFT', 'AudioFFT', 'Audio Spectrum', 'Audio Spectrum (FFT)']) {
    assert.equal(parseIChannelMappings(`// iChannel2: ${alias}`).assignments.get(2), 'audio_spectrum');
}
for (const alias of ['Text', 'Text Render', 'TextOverlay']) {
    assert.equal(parseIChannelMappings(`// iChannel3: ${alias}`).assignments.get(3), 'text_overlay');
}
assert.equal(parseIChannelMappings('// iChannel0: Feedback // background').assignments.get(0), 'feedback');
assert.equal(parseIChannelMappings('/*\n// iChannel0: Feedback\n*/').assignments.size, 0);
assert.equal(parseIChannelMappings('void f() {} // iChannel0: Feedback').assignments.size, 0);
for (const channel of ['4', '99', '01']) assert.match(parseIChannelMappings(`// iChannel${channel}: FFT`).errors[0], /use iChannel0 through iChannel3/);
assert.match(parseIChannelMappings('// iChannel0: Text\n// iChannel3: Text').errors[0], /Only one iChannel can use Text/);
const implicit = resolveIChannelMappings('// iChannel3: Text', TextOverlay);
assert.deepEqual(implicit.errors, []);
assert.equal(implicit.textOverlay.options.output, 'ichannel3');
assert.equal(implicit.textOverlay.options.value, 'none');
const custom = resolveIChannelMappings('// iChannel1: Text\n// ZGETextOverlay: output=iChannel1 value=timer position=text size=.3', TextOverlay);
assert.deepEqual(custom.errors, []);
assert.equal(custom.textOverlay.options.value, 'timer');
assert.equal(custom.textOverlay.options.size, .3);
assert.match(resolveIChannelMappings('// iChannel1: Text\n// ZGETextOverlay: output=iChannel3', TextOverlay).errors[0], /conflicts with ZGETextOverlay/);
assert.match(resolveIChannelMappings('// iChannel3: FFT\n// ZGETextOverlay', TextOverlay).errors[0], /reserved by ZGETextOverlay/);
assert.match(resolveIChannelMappings('// iChannel3: Text\n// ZGETextOverlay: output=overlay', TextOverlay).errors[0], /conflicts/);
assert.equal(resolveIChannelMappings('/*\n// ZGETextOverlay\n// iChannel3: Text\n*/', TextOverlay).textOverlay, null);

const { converter } = require('./audio-input-conversion.test.js');
function shader(directives) {
    return `// Title: Channel mapping test
// Author: NFX
${directives}
float ZGESize = 0.5;
float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;
float AudioFFT(float freq) { return texture(iChannel2,vec2(freq,0.0)).r; }
void mainImage(out vec4 color,in vec2 pixel) {
    vec2 uv=pixel/iResolution.xy;
    color=texture(iChannel0,uv)+texture(iChannel1,uv)+vec4(AudioFFT(.1))+texture(iChannel3,uv);
}`;
}
async function run() {
    for (const template of ['basic', 'basic_120', 'basic_130']) {
        const e = converter();
        e.get('templateSelect').value = `templates/${template}.zgeproj`;
        async function convert(source, update = true) {
            e.get('inputCode').value = source;
            if (update) e.get('inputCode').listeners.input();
            await e.get('convertButton').listeners.click();
            return e.get('outputCode').value;
        }
        const all = '// iChannel0: Feedback\n// iChannel1: ImageSrc\n// iChannel2: FFT\n// iChannel3: Text';
        const xml = await convert(shader(all));
        assert.ok(xml.length > 0);
        for (const [channel, value] of ['feedback', 'bitmap1', 'audio_spectrum', 'text_overlay'].entries()) {
            assert.equal(e.get(`ichannel${channel}Source`).value, value);
            assert.equal(e.get(`ichannel${channel}Source`).disabled, true);
        }
        assert.match(xml, /VariableName="iChannel2" ValueArrayRef="SpecBandArray"/);
        assert.match(xml, /<MaterialTexture Name="FeedbackMaterialTexture"[^>]*TextureSlot="0"/);
        assert.match(xml, /<MaterialTexture Name="iChannel1" Texture="Bitmap1"[^>]*TextureSlot="1"/);
        assert.match(xml, /<MaterialTexture Name="TextOverlayMaterialTexture" RenderTarget="TextOverlayRenderTarget"[^>]*TextureSlot="2"/);
        assert.match(xml, /#define iChannel3 tex3/);
        assert.match(xml, /<RenderTarget Name="TextOverlayRenderTarget"/);
        assert.doesNotMatch(xml, /Parameters\[undefined\]/);
        const customized = await convert(shader(all + '\n// ZGETextOverlay: output=iChannel3 value=timer size=.3'));
        assert.ok(customized.length > 0);
        assert.match(customized, /TextOverlayValue\+=App.DeltaTime/);
        // Directives apply during conversion even if the UI input event was not fired.
        const moved = await convert(shader('// iChannel0: Text\n// iChannel1: Image Src\n// iChannel2: FFT\n// iChannel3: Feedback'), false);
        assert.ok(moved.length > 0);
        assert.match(moved, /#define iChannel3 tex1/);
        assert.match(moved, /#define iChannel0 tex2/);
        assert.match(moved, /#define iChannel1 tex3/);
        for (const invalid of [
            '// iChannel3: Text\n// ZGETextOverlay: output=iChannel1',
            '// iChannel3: FFT\n// ZGETextOverlay',
            '// iChannel3: Text\n// iChannel0: Text',
            '// iChannel0: Feedback\n// iChannel1: Feedback',
            '// iChannel4: FFT',
            '// iChannel0: Camera',
        ]) {
            e.get('outputCode').value = 'old project';
            assert.equal(await convert(shader(invalid)), '');
        }
        e.get('inputCode').value = shader('');
        e.get('inputCode').listeners.input();
        for (let i = 0; i < 4; i++) e.get(`ichannel${i}Source`).value = 'none';
        const manual = await convert(shader(''), false);
        assert.ok(manual.length > 0);
        for (let i = 0; i < 4; i++) assert.equal(e.get(`ichannel${i}Source`).disabled, false);
    }
    console.log('ichannel mapping parser, UI, and conversion tests passed (all templates)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
