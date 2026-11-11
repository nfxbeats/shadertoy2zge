(function (root) {
    'use strict';
    const clean = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    function parse(source) {
        if (!/^\s*\/\/\s*ZGEContainer\b/m.test(source)) return null;
        const lines = source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
        if (lines[0] !== '// ZGEContainer: 1') throw new Error('Expected // ZGEContainer: 1 on the first line.');
        const sections = []; let active = null;
        for (const line of lines.slice(1)) {
            const begin = line.match(/^\/\/ ZGEBegin: (Common|Buffer[A-D]|Image)$/);
            const end = line.match(/^\/\/ ZGEEnd: (Common|Buffer[A-D]|Image)$/);
            if (begin) {
                if (active || sections.some(s => s.name === begin[1])) throw new Error('Nested or duplicate container section.');
                active = { name: begin[1], lines: [], inputs: [] }; sections.push(active);
            } else if (end) {
                if (!active || active.name !== end[1]) throw new Error('Mismatched container end marker.');
                active = null;
            } else if (active) active.lines.push(line);
            else if (line.trim()) throw new Error('Unexpected text outside container sections.');
        }
        if (active || sections[0]?.name !== 'Common' || sections.at(-1)?.name !== 'Image' || sections.length < 3) throw new Error('Container needs Common, at least one Buffer, and Image sections.');
        const common = sections[0]; const passes = sections.slice(1); const buffers = passes.slice(0, -1);
        if (buffers.some(p => !/^Buffer[A-D]$/.test(p.name))) throw new Error('Image must be the final pass.');
        for (const section of sections) {
            section.code = section.lines.filter(line => !/^\/\/ ZGE(?:Input|Target|Initial):/.test(line)).join('\n');
            const code = clean(section.code);
            if ((code.match(/\bvoid\s+mainImage\s*\(/g) || []).length !== (section === common ? 0 : 1)) throw new Error(`${section.name}: expected ${section === common ? 'no' : 'one'} mainImage entry point.`);
            if (section !== common && /\b(?:float|bool)\s+ZGE\w+\s*=/.test(code)) throw new Error('Declare all ZGE controls in Common.');
            if (/\biChannelResolution\b|\btexelFetch\s*\(|\btextureSize\s*\(/.test(code)) throw new Error('Containers require normalized texture() sampling; channel-resolution queries are unsupported.');
            if (/\bAudio(?:FFT|Buffer\d*)\s*\(|ZGETextOverlay|^\s*\/\/\s*iChannel[0-3]\s*:/m.test(section.code)) throw new Error('This initial container implementation supports visual-buffer inputs only; audio, text and global channel directives are not supported in containers yet.');
            for (const line of section.lines) {
                if (/^\/\/ ZGE(?:Input|Target|Initial):/.test(line) && section === common) throw new Error('Pass metadata is not allowed in Common.');
                if (line.startsWith('// ZGEInput:')) {
                    const m = line.match(/^\/\/ ZGEInput: iChannel([0-3])=(Buffer[A-D])\.(previous|current)$/);
                    if (!m) throw new Error(`${section.name}: only BufferA..D.previous/current inputs are supported in this release.`);
                    if (section.inputs.some(i => i.channel === +m[1])) throw new Error(`${section.name}: duplicate channel mapping.`);
                    section.inputs.push({ channel: +m[1], buffer: m[2], age: m[3] });
                } else if (line.startsWith('// ZGETarget:')) {
                    const m = line.match(/^\/\/ ZGETarget: size=(viewport|[1-9]\d*x[1-9]\d*) format=(RGBA32F|RGBA8) filter=(nearest|linear) wrap=(clamp|repeat)$/);
                    if (!m || section.target) throw new Error(`${section.name}: invalid or duplicate target declaration.`);
                    section.target = { size: m[1], format: m[2], filter: m[3], wrap: m[4] };
                } else if (line.startsWith('// ZGEInitial:')) {
                    if (section.initial) throw new Error(`${section.name}: duplicate initial state.`);
                    section.initial = line.slice('// ZGEInitial:'.length).trim().split(',').map(value => {
                        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) throw new Error('Initial RGBA values must be numeric literals.');
                        return Number(value);
                    });
                    if (section.initial.length !== 4 || !section.initial.every(v => Number.isFinite(Math.fround(v)))) throw new Error('Initial state needs four finite, representable 32-bit RGBA values.');
                } else if (/^\s*\/\/\s*ZGE(?:Container|Begin|End|Input|Target|Initial)\b/.test(line)) throw new Error('Malformed container directive.');
            }
        }
        const controlNames = [...clean(common.code).matchAll(/\b(?:float|bool)\s+(ZGE\w+)\s*=/g)].map(m => m[1]);
        if (new Set(controlNames).size !== controlNames.length) throw new Error('Duplicate ZGE parameter in Common.');
        for (const pass of passes) {
            if (pass.name === 'Image' ? pass.target || pass.initial : !pass.target || !pass.initial) throw new Error(`${pass.name}: target and initial state are required only on Buffer passes.`);
            if (pass.target?.format === 'RGBA8' && pass.initial.some(v => v < 0 || v > 1)) throw new Error('RGBA8 initial state must be in 0..1.');
            const used = new Set([...clean(common.code + '\n' + pass.code).matchAll(/\biChannel([0-3])\b/g)].map(m => +m[1]));
            for (const channel of used) if (!pass.inputs.some(i => i.channel === channel)) throw new Error(`${pass.name}: missing iChannel${channel} input mapping (including Common helper reads).`);
            for (const input of pass.inputs) {
                const index = buffers.findIndex(b => b.name === input.buffer);
                if (index < 0) throw new Error(`Missing buffer ${input.buffer}.`);
                if (input.age === 'current' && index >= passes.indexOf(pass)) throw new Error(`${pass.name}: forward/self current-frame dependency.`);
            }
        }
        return { common: common.code, passes, buffers, image: passes.at(-1) };
    }

    // Pack logical RGBA32F into four quadrants of one native R32F texture.
    // This preserves full precision while keeping each logical channel to one
    // texture unit (ZGE automatically binds only tex1..tex8).
    function inject(xml, container, parameters) {
        const main = xml.match(/<Shader Name="MainShader"[^>]*>[\s\S]*?<\/Shader>/)[0];
        const version = (main.match(/#version\s+\d+/) || [''])[0];
        const vertex = `${version}\nvoid main(){vec4 v=gl_Vertex;v.xy*=2.0;gl_Position=v;}`;
        const parameterUniforms = parameters.map(p => `uniform float ZGE${p.id};`).join('\n');
        const parameterBindings = (main.match(/<ShaderVariable\b[^>]*VariableName="ZGE[^>]*\/>/g) || []).map(s => s.replace(/ Name="[^"]*"/, '')).join('\n');
        const common = container.common.replace(/^\s*(?:float|bool)\s+ZGE\w+\s*=[^;]*;[^\n]*/gm, '');
        const id = (buffer, age, component) => `Visual${buffer}${age}${component}`;
        const packed = buffer => buffer.target.format === 'RGBA32F';
        const count = () => 1;
        const glslFloat = value => /[.eE]/.test(String(value)) ? String(value) : `${value}.0`;
        let content = ''; let before = 'VisualViewportSize=vector2(app.ViewportWidth,app.ViewportHeight);\nVisualViewportRatio=App.ViewportRatio;App.ViewportRatio=0;\n'; let after = '';
        const draw = (target, material) => `@SetRenderTarget(RenderTarget : ${target});\n@UseMaterial(Material : ${material});\n@RenderSprite();\n`;
        function shader(name, fragment, bindings = '') {
            content += `<Shader Name="${name}" UpdateVarsOnEachUse="255"><VertexShaderSource><![CDATA[${vertex}]]></VertexShaderSource><FragmentShaderSource><![CDATA[${version}\n${fragment}]]></FragmentShaderSource><UniformVariables>${bindings}</UniformVariables></Shader>\n`;
        }
        function material(name, shaderName, textures = '', image = false) {
            return `<Material Name="${name}" Shader="${shaderName}" ZBuffer="0"${image ? '' : ' Blend="0"'}><Textures>${textures}</Textures></Material>\n`;
        }
        content += '<Variable Name="VisualViewportSize" Type="6"/>\n<Variable Name="VisualViewportRatio" Type="1"/>\n<Variable Name="VisualImageFrame" Type="1"/>\n<Variable Name="VisualImageDelta"/>\n';
        for (const buffer of container.buffers) {
            const name = `Visual${buffer.name}`;
            const viewport = buffer.target.size === 'viewport';
            const [w, h] = viewport ? ['VisualViewportSize.X', 'VisualViewportSize.Y'] : buffer.target.size.split('x');
            content += `<Variable Name="${name}Ready"/><Variable Name="${name}Frame" Type="1"/><Variable Name="${name}Delta"/><Variable Name="${name}Size" Type="6"/>\n`;
            // ZGE only calls UseShader when the material's shader changes.
            // A shared copy shader can retain a preceding buffer's dimensions,
            // even with UpdateVarsOnEachUse. Bind a distinct shader per buffer.
            shader(`${name}CopyShader`, `uniform sampler2D tex1;uniform vec2 visualSize;void main(){gl_FragColor=texture2D(tex1,gl_FragCoord.xy/(visualSize*${packed(buffer) ? '2.0' : '1.0'}));}`, `<ShaderVariable VariableName="visualSize" VariableRef="${name}Size"/>`);
            before += `${name}Size=vector2(${w},${h});\n${name}Delta=App.DeltaTime;\nif(${name}Delta<0) ${name}Delta=0;\n`;
            if (viewport) before += `if(${name}Size.X*${packed(buffer) ? 2 : 1} != ${id(buffer.name, 'current', 0)}.CustomWidth || ${name}Size.Y*${packed(buffer) ? 2 : 1} != ${id(buffer.name, 'current', 0)}.CustomHeight) ${name}Ready=0;\n`;
            before += `if(${name}Ready==0){\n${name}Frame=0;${name}Delta=0;\n`;
            for (let c = 0; c < count(buffer); c++) {
                const initial = `vec4(${buffer.initial.map(glslFloat).join(',')})`;
                const selectComponent = value => `vec2 quadrant=floor(gl_FragCoord.xy/visualSize);float component=quadrant.x+2.0*quadrant.y;vec4 value=${value};gl_FragColor=vec4(component<0.5?value.r:(component<1.5?value.g:(component<2.5?value.b:value.a)),0.0,0.0,1.0);`;
                shader(`${name}Init${c}Shader`, `uniform vec2 visualSize;void main(){${packed(buffer) ? selectComponent(initial) : `gl_FragColor=${initial};`}}`, `<ShaderVariable VariableName="visualSize" VariableRef="${name}Size"/>`);
                content += material(`${name}Init${c}Material`, `${name}Init${c}Shader`);
                for (const age of ['previous', 'current']) {
                    const target = id(buffer.name, age, c);
                    content += `<RenderTarget Name="${target}" Width="0" Height="0" CustomWidth="${viewport ? 1 : Number(w) * (packed(buffer) ? 2 : 1)}" CustomHeight="${viewport ? 1 : Number(h) * (packed(buffer) ? 2 : 1)}" ClearBeforeUse="0" AutoPowerOfTwo="0" Filter="${buffer.target.filter === 'nearest' ? 1 : 0}" InternalFormat="${packed(buffer) ? 2 : 0}" UseMultiSample="0"/>\n`;
                    if (viewport) before += `${target}.CustomWidth=${name}Size.X*${packed(buffer) ? 2 : 1};${target}.CustomHeight=${name}Size.Y*${packed(buffer) ? 2 : 1};\n`;
                    before += draw(target, `${name}Init${c}Material`);
                }
                content += material(`${name}Copy${c}Material`, `${name}CopyShader`, `<MaterialTexture RenderTarget="${id(buffer.name, 'current', c)}" TexCoords="1" TextureWrapMode="2"/>`);
                after += draw(id(buffer.name, 'previous', c), `${name}Copy${c}Material`);
            }
            before += `${name}Ready=1;\n}\n`;
        }
        let render = before;
        for (const pass of container.passes) {
            const image = pass.name === 'Image'; const name = `Visual${pass.name}`;
            let uniforms = ''; let readers = ''; let textures = ''; let slot = 0; let sourceBindings = ''; let dispatch = '';
            let code = common + '\n' + pass.code;
            for (const input of pass.inputs) {
                const source = container.buffers.find(b => b.name === input.buffer);
                const samplers = [];
                for (let c = 0; c < count(source); c++) {
                    slot++; const sampler = `tex${slot}`; samplers.push(sampler);
                    uniforms += `uniform sampler2D ${sampler};\n`;
                    textures += `<MaterialTexture RenderTarget="${id(input.buffer, input.age, c)}" TexCoords="1" TextureSlot="${slot - 1}" TextureWrapMode="${source.target.wrap === 'repeat' ? 1 : 2}"/>`;
                }
                const readName = `VisualRead${input.channel}`;
                if (packed(source)) {
                    const sizeName = `visualSourceSize${input.channel}`;
                    uniforms += `uniform vec2 ${sizeName};\n`;
                    sourceBindings += `<ShaderVariable VariableName="${sizeName}" VariableRef="Visual${input.buffer}Size"/>`;
                    const sampler = samplers[0];
                    const taps = ['vec2(0.0,0.0)', 'vec2(1.0,0.0)', 'vec2(0.0,1.0)', 'vec2(1.0,1.0)'];
                    const tap = uv => `vec4(${taps.map(offset => `texture2D(${sampler},((${uv})+${offset})*0.5).r`).join(',')})`;
                    if (source.target.wrap === 'repeat' && source.target.filter === 'linear') {
                        // Hardware wrapping must not cross quadrant/component seams.
                        // Interpolate wrapped logical texel centers explicitly.
                        readers += `vec4 ${readName}Tap(vec2 pixel){vec2 uv=(mod(pixel,${sizeName})+0.5)/${sizeName};return ${tap('uv')};}\n`;
                        readers += `vec4 ${readName}(vec2 uv){vec2 p=fract(uv)*${sizeName}-0.5;vec2 base=floor(p);vec2 f=fract(p);return mix(mix(${readName}Tap(base),${readName}Tap(base+vec2(1.0,0.0)),f.x),mix(${readName}Tap(base+vec2(0.0,1.0)),${readName}Tap(base+vec2(1.0,1.0)),f.x),f.y);}\n`;
                    } else {
                        const coordinates = source.target.wrap === 'repeat' ? 'fract(uv)' : `clamp(uv,0.5/${sizeName},vec2(1.0)-0.5/${sizeName})`;
                        readers += `vec4 ${readName}(vec2 uv){uv=${coordinates};return ${tap('uv')};}\n`;
                    }
                } else readers += `vec4 ${readName}(vec2 uv){return texture2D(${samplers[0]},uv);}\n`;
                dispatch += `if(channel==${input.channel}) return ${readName}(uv);`;
            }
            readers += `vec4 VisualTexture(int channel,vec2 uv){${dispatch}return vec4(0.0);}\n`;
            // Lower logical sampler arguments to channel IDs, including helper
            // chains in Common. Actual packed samplers stay in VisualReadN.
            // Preserve comments verbatim rather than rewriting their identifiers.
            code = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\b(?:sampler2D|texture2D|texture|iChannel[0-3])\b/g, token => {
                if (token.startsWith('/')) return token;
                if (token === 'sampler2D') return 'int';
                if (/^iChannel/.test(token)) return token.slice(-1);
                return 'VisualTexture';
            });
            for (const p of parameters.filter(p => p.type === 'bool')) code = code.replace(new RegExp(`\\bZGE${p.id}\\b`, 'g'), `(ZGE${p.id} > 0.5)`);
            // ZGE uploads ValuePropRef as float and skips integer VariableRef.
            // Transport the frame count as float, retaining GLSL integer semantics.
            const bindings = sourceBindings + parameterBindings + `<ShaderVariable VariableName="iTime" VariableRef="uTime"/><ShaderVariable VariableName="iMouse" VariableRef="uMouse"/><ShaderVariable VariableName="iResolution" VariableRef="${image ? 'uResolution' : name + 'Size'}"/><ShaderVariable VariableName="visualFrameValue" ValuePropRef="${name}Frame"/><ShaderVariable VariableName="iTimeDelta" VariableRef="${name}Delta"/>` + (image ? '<ShaderVariable VariableName="iViewport" VariableRef="uViewport"/>' : '');
            // Translate the system prompt's standard listIndex clamp for GLSL
            // 120, which lacks an integer clamp overload. Keep source untouched.
            if (version === '#version 120' && /\bint\s+listIndex\s*\(/.test(code)) code = code.replace(
                /\breturn\s+clamp\(\s*idx\s*,\s*0\s*,\s*itemCount\s*-\s*1\s*\)\s*;/g,
                'return int(clamp(float(idx), 0.0, float(itemCount - 1)));');
            const preamble = `${uniforms}${parameterUniforms}\nuniform vec2 iResolution;uniform float iTime,iTimeDelta,visualFrameValue;uniform vec4 iMouse;${image ? 'uniform vec2 iViewport;' : ''}\n#define iFrame int(visualFrameValue)\n${readers}${code}\n`;
            if (image) {
                // Leave the host-facing names stable for the existing editor and templates.
                const fragment = `${preamble}void main(){mainImage(gl_FragColor,gl_FragCoord.xy-iViewport);}`;
                xml = xml.replace(main, () => `<Shader Name="MainShader"><VertexShaderSource><![CDATA[${vertex}]]></VertexShaderSource><FragmentShaderSource><![CDATA[${version}\n${fragment}]]></FragmentShaderSource><UniformVariables>${bindings}</UniformVariables></Shader>`);
                xml = xml.replace(/<Material Name="mCanvas"[\s\S]*?<\/Material>/, material('mCanvas', 'MainShader', textures, true));
            } else {
                for (let c = 0; c < count(pass); c++) {
                    const fragment = packed(pass)
                        ? `${preamble}void main(){vec2 pixel=mod(gl_FragCoord.xy,iResolution);vec4 result;mainImage(result,pixel);vec2 quadrant=floor(gl_FragCoord.xy/iResolution);float component=quadrant.x+2.0*quadrant.y;gl_FragColor=vec4(component<0.5?result.r:(component<1.5?result.g:(component<2.5?result.b:result.a)),0.0,0.0,1.0);}`
                        : `${preamble}void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}`;
                    shader(`${name}Write${c}Shader`, fragment, bindings);
                    content += material(`${name}Write${c}Material`, `${name}Write${c}Shader`, textures);
                    render += draw(id(pass.name, 'current', c), `${name}Write${c}Material`);
                }
            }
        }
        // Native render targets inherit the application's display aspect ratio.
        // Full-window mode is required offscreen or a 2x2 clock atlas can be
        // letterboxed to 2x1, dropping its B/A component quadrants.
        render += 'App.ViewportRatio=VisualViewportRatio;\n@SetRenderTarget(RenderTarget : null);\nVisualImageDelta=App.DeltaTime;if(VisualImageDelta<0) VisualImageDelta=0;if(VisualImageFrame==0) VisualImageDelta=0;\n@UseMaterial(Material : mCanvas);\n@RenderSprite();\n';
        render += 'App.ViewportRatio=0;\n' + after + 'App.ViewportRatio=VisualViewportRatio;\n@SetRenderTarget(RenderTarget : null);\nVisualImageFrame++;\n' + container.buffers.map(b => `Visual${b.name}Frame++;`).join('\n');
        xml = xml.replace(/<OnRender>[\s\S]*?<\/OnRender>/, `<OnRender><ZExpression Comment="Render persistent visual passes"><Expression><![CDATA[${render}]]></Expression></ZExpression></OnRender>`);
        const reset = 'VisualImageFrame=0;' + container.buffers.map(b => `Visual${b.name}Ready=0;Visual${b.name}Frame=0;`).join('');
        content += `<ZLibrary Comment="Reset visual state on graphics context recreation"><Source><![CDATA[void OnGLContextChange(){${reset}}]]></Source></ZLibrary>`;
        return xml.replace('</Content>', content + '</Content>');
    }
    const api = { parse, inject };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.VisualBuffers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
