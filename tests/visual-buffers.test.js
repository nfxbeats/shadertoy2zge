const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { converter } = require('./audio-input-conversion.test.js');
const VisualBuffers = require('../visual-buffers.js');

const clock = `// ZGEContainer: 1
// ZGEBegin: Common
// Title: Visual clock test
// Author: NFX
float ZGESize = 0.5;
float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;
float ZGESpeed = 0.35;
// ZGEEnd: Common
// ZGEBegin: BufferA
// ZGETarget: size=1x1 format=RGBA32F filter=nearest wrap=clamp
// ZGEInitial: 0,0,0,1
// ZGEInput: iChannel0=BufferA.previous
void mainImage(out vec4 c,in vec2 p){
float t=0.0;
if(iFrame>0) t=texture(iChannel0,vec2(0.5)).r+iTimeDelta*clamp(ZGESpeed,0.0,1.0)*0.85;
c=vec4(t,-2.0,3.0,1.0);
}
// ZGEEnd: BufferA
// ZGEBegin: Image
// ZGEInput: iChannel0=BufferA.current
void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec2(0.5));}
// ZGEEnd: Image
`;
// A permanent mixed-resolution regression fixture: copying the 1x1 state
// must not leave that size active when copying the spatial paint state.
const twoBuffers = clock.replace('// ZGEBegin: Image', `// ZGEBegin: BufferB
// ZGETarget: size=viewport format=RGBA32F filter=linear wrap=clamp
// ZGEInitial: 0,0,0,-1
// ZGEInput: iChannel0=BufferB.previous
// ZGEInput: iChannel1=BufferA.current
void mainImage(out vec4 c,in vec2 p){
vec2 uv=p/iResolution;
vec4 previous=texture(iChannel0,uv);
c=vec4(texture(iChannel1,vec2(0.5)).r,
       iFrame==0?uv.x:previous.g+iTimeDelta,
       uv.y,12345.0);
}
// ZGEEnd: BufferB
// ZGEBegin: Image`).replace('// ZGEInput: iChannel0=BufferA.current', '// ZGEInput: iChannel0=BufferB.current');
const threeBuffers = twoBuffers.replace('// ZGEEnd: Common', `
vec4 helperRead(sampler2D source,vec2 uv){return texture(source,uv);}
vec4 nestedRead(sampler2D source,vec2 uv){return helperRead(source,uv);}
// ZGEEnd: Common`).replace('// ZGEBegin: Image', `// ZGEBegin: BufferC
// ZGETarget: size=viewport format=RGBA32F filter=linear wrap=clamp
// ZGEInitial: 0,0,0,0
// ZGEInput: iChannel0=BufferC.previous
// ZGEInput: iChannel1=BufferB.previous
// ZGEInput: iChannel3=BufferA.current
void mainImage(out vec4 c,in vec2 p){
vec2 uv=p/iResolution;
c=vec4(nestedRead(iChannel1,uv).gb,helperRead(iChannel3,vec2(0.5)).r,12345.0);
}
// ZGEEnd: BufferC
// ZGEBegin: Image`);
async function convert(source = clock, template = 'basic_130') {
    const elements = converter();
    elements.get('templateSelect').value = `templates/${template}.zgeproj`;
    elements.get('inputCode').value = source;
    elements.get('inputCode').listeners.input();
    await elements.get('convertButton').listeners.click();
    const output = elements.get('outputCode').value;
    assert.ok(output, elements.get('notification').children.map(c => c.textContent).join('\n'));
    return output;
}
// Execute the actual emitted ZGE scheduling expression, replacing only native
// render commands with event collectors. GPU tests consume these same events.
function schedule(xml, updates) {
    const render = xml.match(/<OnRender>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>/)[1]
        .replace(/@SetRenderTarget\(RenderTarget : (\w+)\);/g, (_, n) => `setTarget(${n === 'null' ? 'null' : JSON.stringify(n)});`)
        .replace(/@UseMaterial\(Material : (\w+)\);/g, (_, n) => `useMaterial(${JSON.stringify(n)});`)
        .replace(/@RenderSprite\(\);/g, 'draw();');
    const variables = {};
    for (const m of xml.matchAll(/<(Variable|RenderTarget) Name="([^"]+)"([^>]*)\/>/g)) {
        variables[m[2]] = m[1] === 'RenderTarget' ? {
            CustomWidth: +(m[3].match(/CustomWidth="(\d+)"/) || [0, 0])[1],
            CustomHeight: +(m[3].match(/CustomHeight="(\d+)"/) || [0, 0])[1],
        } : 0;
    }
    const frames = []; let events, target, material;
    // Do not supply GLSL math functions here: ZGE's expression language does
    // not provide max/min, even though the fragment shaders do.
    const state = vm.createContext({ ...variables, App: { DeltaTime: 0, ViewportRatio: 3 }, app: { ViewportWidth: 64, ViewportHeight: 36 },
        vector2: (X, Y) => ({ X, Y }), setTarget: n => { target = n; }, useMaterial: n => { material = n; },
        draw() { events.push({ target, material, values: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k, v]) => typeof v !== 'function')))) }); },
    });
    for (const update of updates) {
        state.App.DeltaTime = update.dt;
        state.app.ViewportWidth = update.width || 64; state.app.ViewportHeight = update.height || 36;
        state.uResolution = state.vector2(state.app.ViewportWidth, state.app.ViewportHeight);
        state.uViewport = state.vector2(0, 0); state.uMouse = [0, 0, 0, 0]; state.uTime = 0;
        if (update.reset) vm.runInContext(xml.match(/void OnGLContextChange\(\)\{([^}]*)\}/)[1], state);
        events = []; vm.runInContext(render, state); frames.push(events);
    }
    return frames;
}
async function run() {
    assert.equal(VisualBuffers.parse('void mainImage(){}'), null);
    for (const [source, pattern] of [
        [clock.replace('ZGEContainer: 1', 'ZGEContainer: 2'), /first line/],
        [clock.replace('iChannel0=BufferA.previous', 'iChannel0=BufferA.current'), /dependency/],
        [clock.replace('iChannel0=BufferA.current', 'iChannel0=BufferB.current'), /Missing buffer/],
        [clock.replace('// ZGEInput: iChannel0=BufferA.previous', ''), /missing iChannel0/],
        [clock.replace('format=RGBA32F', 'format=RGBA16F'), /target/],
        [clock.replace('BufferA.previous', 'audio_spectrum'), /only Buffer/],
        [clock.replace('// ZGEEnd: Image', '// ZGEEnd: BufferA'), /Mismatched/],
    ]) assert.throws(() => VisualBuffers.parse(source), pattern);
    for (const template of ['basic', 'basic_120', 'basic_130']) {
        const xml = await convert(clock, template);
        assert.equal((xml.match(/<RenderTarget /g) || []).length, 2);
        assert.equal((xml.match(/InternalFormat="2"/g) || []).length, 2);
        assert.equal((xml.match(/<Array Name="Parameters"/g) || []).length, 1);
        assert.doesNotMatch(xml, /iChannel0|RGBA16|ZGEContainer|ZGEBegin/);
        assert.match(xml, /VariableName="ZGESpeed" ValuePropRef="Parameters\[3\]"/);
        // Native ZGE skips int VariableRef uploads. Use its float expression
        // uploader, then restore integer iFrame semantics inside GLSL.
        assert.doesNotMatch(xml, /uniform int iFrame|VariableName="iFrame" VariableRef=/);
        assert.match(xml, /VariableName="visualFrameValue" ValuePropRef="VisualBufferAFrame"/);
        assert.match(xml, /#define iFrame int\(visualFrameValue\)/);
        const frames = schedule(xml, [{ dt: 0.1 }, { dt: 0.1 }, { dt: 0 }, { dt: 0.1, width: 128 }, { dt: 0.1, reset: true }]);
        assert.deepEqual(frames.map(f => f.length), [5, 3, 3, 3, 5]);
        for (const frame of frames) for (const event of frame) {
            assert.equal(event.values.App.ViewportRatio, event.target ? 0 : 3, 'Offscreen writes must bypass display letterboxing');
        }
        assert.equal(frames[0][2].values.VisualBufferADelta, 0);
        assert.equal(frames[1][0].values.VisualBufferAFrame, 1);
        assert.equal(frames[2][0].values.VisualBufferADelta, 0);
        assert.equal(frames[3][0].values.VisualBufferAFrame, 3); // Fixed-size clock survives resize.
        assert.equal(frames[4][2].values.VisualBufferAFrame, 0);
        const negative = schedule(xml, [{ dt: 0.1 }, { dt: -0.1 }]);
        assert.equal(negative[1][0].values.VisualBufferADelta, 0);
        assert.equal(negative[1].find(e => e.material === 'mCanvas').values.VisualImageDelta, 0);
        const expression = xml.match(/<OnRender>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>/)[1];
        assert.doesNotMatch(expression, /\b(?:max|min|clamp)\s*\(/);
        assert.equal(frames[0][3].material, 'mCanvas');
        assert.ok(frames[0].slice(4).every(e => e.target.includes('previous')));
        const viewport = await convert(clock.replace('size=1x1', 'size=viewport'), template);
        const resized = schedule(viewport, [{ dt: 0.1 }, { dt: 0.1, width: 128 }]);
        assert.equal(resized[1].length, 5);
        assert.equal(resized[1][2].values.VisualBufferAFrame, 0);
        const mixed = await convert(twoBuffers, template);
        assert.match(mixed, /Name="VisualBufferACopy0Material" Shader="VisualBufferACopyShader"/);
        assert.match(mixed, /Name="VisualBufferBCopy0Material" Shader="VisualBufferBCopyShader"/);
        assert.match(mixed, /VariableName="visualSize" VariableRef="VisualBufferBSize"/);
        assert.doesNotMatch(mixed, /VisualCopySize|Name="VisualCopyShader"/);
        const helpers = await convert(threeBuffers, template);
        assert.match(helpers, /vec4 helperRead\(int source/);
        assert.match(helpers, /vec4 nestedRead\(int source/);
        assert.match(helpers, /nestedRead\(1,uv\)/);
        for (const material of helpers.matchAll(/<Material\b[^>]*>[\s\S]*?<\/Material>/g)) {
            assert.ok((material[0].match(/<MaterialTexture\b/g) || []).length <= 3);
        }
    }
    // Regression: after a successful conversion, a bad container must not expose
    // the previous project as the current result.
    const elements = converter();
    elements.get('inputCode').value = clock.replace('ZGEContainer: 1', 'ZGEContainer: 99');
    elements.get('outputCode').value = 'old project';
    await elements.get('convertButton').listeners.click();
    assert.equal(elements.get('outputCode').value, '');
    const acrylic = path.join(__dirname, '../samples/acrylic.txt');
    if (fs.existsSync(acrylic)) {
        for (const template of ['basic', 'basic_120', 'basic_130']) await convert(fs.readFileSync(acrylic, 'utf8'), template);
    }
    console.log('visual buffer conversion and scheduling tests passed');
}
module.exports = { clock, twoBuffers, threeBuffers, convert, schedule };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
