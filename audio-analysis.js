// Small GLSL-aware call-graph analysis for semantic audio helper functions.
function analyzeAudioMarkers(source) {
    const cleaned = source
        .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length));
    const tokens = Array.from(cleaned.matchAll(/[A-Za-z_]\w*|[{}()]/g), match => match[0]);
    const functions = new Map();

    for (let i = 1; i < tokens.length - 2; i++) {
        if (!/^[A-Za-z_]/.test(tokens[i]) || tokens[i + 1] !== '(') continue;
        let parenDepth = 1;
        let cursor = i + 2;
        for (; cursor < tokens.length && parenDepth; cursor++) {
            if (tokens[cursor] === '(') parenDepth++;
            else if (tokens[cursor] === ')') parenDepth--;
        }
        if (parenDepth || tokens[cursor] !== '{') continue;

        let braceDepth = 1;
        const bodyStart = cursor + 1;
        cursor = bodyStart;
        for (; cursor < tokens.length && braceDepth; cursor++) {
            if (tokens[cursor] === '{') braceDepth++;
            else if (tokens[cursor] === '}') braceDepth--;
        }
        if (braceDepth) continue;

        const calls = new Set();
        for (let bodyCursor = bodyStart; bodyCursor < cursor - 1; bodyCursor++) {
            if (/^[A-Za-z_]/.test(tokens[bodyCursor]) && tokens[bodyCursor + 1] === '(') {
                calls.add(tokens[bodyCursor]);
            }
        }
        functions.set(tokens[i], calls);
        i = cursor - 1;
    }

    const reachableFunctions = new Set();
    const reachableCalls = new Set();
    const pending = ['mainImage', 'main'].filter(name => functions.has(name));
    while (pending.length) {
        const name = pending.pop();
        if (reachableFunctions.has(name)) continue;
        reachableFunctions.add(name);
        // Buffer helper bodies are ShaderToy fallbacks, not ZGE processing
        // instructions. Record the call to the marker, but do not traverse the
        // fallback (which commonly delegates to AudioFFT).
        if (/^AudioBuffer(?:[1-9]\d*)?$/.test(name)) continue;
        for (const called of functions.get(name) || []) {
            reachableCalls.add(called);
            if (!reachableFunctions.has(called)) pending.push(called);
        }
    }
    const numberedBuffers = Array.from(reachableCalls)
        .map(name => /^AudioBuffer([1-9]\d*)$/.exec(name))
        .filter(Boolean)
        .map(match => match[1])
        .sort((a, b) => a.length - b.length || a.localeCompare(b));

    const declarations = new Map();
    const historySettings = new Map();
    const historyPattern = /\b(\w+)\s+AudioBuffer([1-9]\d*)History(Frames|Interval)\s*=\s*([^;]+);/g;
    for (const match of cleaned.matchAll(historyPattern)) {
        if (!historySettings.has(match[2])) historySettings.set(match[2], {});
        const settings = historySettings.get(match[2]);
        const property = match[3].toLowerCase();
        const value = match[4].trim();
        const validLiteral = property === 'frames' ? /^[+-]?\d+$/.test(value) : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
        settings[property] = !Object.hasOwn(settings, property) && validLiteral && match[1] === (property === 'frames' ? 'int' : 'float') ? Number(value) : NaN;
    }
    const declarationPattern = /\b(?:const\s+)?(?:int|float)\s+AudioBuffer([1-9]\d*)(Mode|Source)\s*=\s*(-?\d+(?:\.0*)?)\s*;/g;
    let declaration;
    while ((declaration = declarationPattern.exec(cleaned)) !== null) {
        const [, id, property, value] = declaration;
        if (!declarations.has(id)) declarations.set(id, { id });
        declarations.get(id)[property.toLowerCase()] = Number(value);
    }
    // Explicit bindings avoid assigning semantics to buffer numbers or labels.
    const bindingPattern = /^\s*\/\/\s*(?:Audio)?Buffer\s*([1-9]\d*)\s+uses\s+ZGE(\w+)\s*\/\s*ZGE(\w+)\s*\.?\s*$/gm;
    for (const binding of source.matchAll(bindingPattern)) {
        const config = declarations.get(binding[1]);
        if (config && config.mode === 1) {
            config.attackParameter = binding[2];
            config.decayParameter = binding[3];
        }
    }

    const errors = [];
    const orderedBuffers = [];
    const visiting = new Set();
    const visited = new Set();
    function visit(id, path) {
        if (visited.has(id)) return;
        if (visiting.has(id)) {
            errors.push(`Audio buffer dependency cycle: ${path.concat(id).map(value => `AudioBuffer${value}`).join(' -> ')}`);
            return;
        }
        const config = declarations.get(id);
        if (!config || !Number.isInteger(config.mode) || !Number.isInteger(config.source)) {
            errors.push(`AudioBuffer${id} requires integer AudioBuffer${id}Mode and AudioBuffer${id}Source declarations.`);
            return;
        }
        if (![0, 1, 2, 3, 4, 5].includes(config.mode)) {
            errors.push(`Unsupported audio buffer mode: AudioBuffer${id}Mode=${config.mode}.`);
        }
        if (config.mode !== 5 && new RegExp(`\\bfloat\\s+AudioBuffer${id}\\s*\\(\\s*float\\s+\\w+\\s*,\\s*float\\s+\\w+\\s*\\)`).test(cleaned)) {
            errors.push(`The two-argument AudioBuffer${id}(freq, age) helper requires mode 5 (HISTORY).`);
        }
        if (config.mode === 5) {
            const settings = historySettings.get(id) || {};
            config.historyFrames = settings.frames ?? 128;
            config.historyInterval = settings.interval ?? (1 / 30);
            if (!Number.isInteger(config.historyFrames) || config.historyFrames < 2 || config.historyFrames > 2048) {
                errors.push(`AudioBuffer${id}HistoryFrames must be an int literal from 2 to 2048.`);
            }
            if (!Number.isFinite(config.historyInterval) || config.historyInterval < 0.001 || config.historyInterval > 60) {
                errors.push(`AudioBuffer${id}HistoryInterval must be a float literal from 0.001 to 60 seconds.`);
            }
        }
        visiting.add(id);
        if (config.source < 0) {
            errors.push(`AudioBuffer${id}Source must be 0 (raw FFT) or a positive buffer number.`);
        } else if (config.source > 0) {
            visit(String(config.source), path.concat(id));
        }
        visiting.delete(id);
        visited.add(id);
        orderedBuffers.push(config);
    }
    numberedBuffers.forEach(id => visit(id, []));

    return {
        usesAudioFFT: reachableCalls.has('AudioFFT'),
        usesLegacyAudioBuffer: reachableCalls.has('AudioBuffer'),
        numberedBuffers,
        orderedBuffers,
        errors: Array.from(new Set(errors)),
    };
}

function buildAudioBufferUpdateCode(configuredBuffers, processingExpressions) {
    const { attack, decay, peakDecay, trailsDecay } = processingExpressions;
    const updates = configuredBuffers.map(buffer => {
        const suffix = buffer.id;
        const uniqueSuffix = suffix || 'Legacy';
        const arrayName = `AudioBuffer${suffix}`;
        const sourceName = buffer.source === 0 ? 'SpecBandArray' : `AudioBuffer${buffer.source}`;
        let historyUpdate = '';
        if (buffer.mode === 5) {
            const frames = buffer.historyFrames;
            const interval = buffer.historyInterval;
            historyUpdate = `
// Capture actual spectra into a circular history; never fabricate missed frames.
${arrayName}HistoryCapture = 0;
if (${arrayName}HistoryBins != ${sourceName}.SizeDim1) {
    ${arrayName}HistoryBins = ${sourceName}.SizeDim1;
    ${arrayName}HistoryHead = 0;
    ${arrayName}HistoryCount = 0;
    ${arrayName}HistoryClock = 0;
    if (${sourceName}.SizeDim1 > 0) {
        ${arrayName}HistoryTarget.CustomWidth = ${sourceName}.SizeDim1;
        ${arrayName}HistoryPrevious.CustomWidth = ${sourceName}.SizeDim1;
    }
}
${arrayName}HistoryClock += App.DeltaTime;
if (${sourceName}.SizeDim1 > 0 && (${arrayName}HistoryCount == 0 || ${arrayName}HistoryClock >= ${interval})) {
    ${arrayName}HistoryHead = (round(${arrayName}HistoryHead) + 1) % ${frames};
    if (${arrayName}HistoryCount < ${frames}) ${arrayName}HistoryCount++;
    ${arrayName}HistoryClock = 0;
    ${arrayName}HistoryCapture = 1;
}
`;
        }
        let assignValue = `audioCurrent${uniqueSuffix}`;
        let smoothingLines = '';
        let coefficientSetup = '';
        if (buffer.mode === 1) {
            const controls = processingExpressions.buffers?.[suffix] || { attack, decay };
            coefficientSetup = `float audioAttackCoeff${uniqueSuffix} = ${controls.attack} < 0.0000001 ? 0.0 : exp(-1.0 / (clamp(App.FpsCounter, 15, 60) * ${controls.attack} * 0.001));\nfloat audioDecayCoeff${uniqueSuffix} = ${controls.decay} < 0.0000001 ? 0.0 : exp(-1.0 / (clamp(App.FpsCounter, 15, 60) * ${controls.decay} * 0.001));\n`;
            smoothingLines = `    float audioPrevious${uniqueSuffix} = ${arrayName}[audioBin${uniqueSuffix}];\n    float audioCoeff${uniqueSuffix} = abs(audioCurrent${uniqueSuffix}) > abs(audioPrevious${uniqueSuffix}) ? audioAttackCoeff${uniqueSuffix} : audioDecayCoeff${uniqueSuffix};\n`;
            assignValue = `audioCoeff${uniqueSuffix} * (audioPrevious${uniqueSuffix} - audioCurrent${uniqueSuffix}) + audioCurrent${uniqueSuffix}`;
        } else if (buffer.mode === 2) {
            smoothingLines = `    float audioPrevious${uniqueSuffix} = ${arrayName}[audioBin${uniqueSuffix}];\n`;
            const decayedPeak = `audioPrevious${uniqueSuffix} - (${peakDecay}) * App.DeltaTime`;
            assignValue = `audioCurrent${uniqueSuffix} > ${decayedPeak} ? audioCurrent${uniqueSuffix} : ${decayedPeak}`;
        } else if (buffer.mode === 3) {
            smoothingLines = `    float audioPrevious${uniqueSuffix} = ${arrayName}[audioBin${uniqueSuffix}];\n`;
            const decayedTrail = `audioPrevious${uniqueSuffix} * exp(-(${trailsDecay}) * App.DeltaTime)`;
            assignValue = `audioCurrent${uniqueSuffix} > ${decayedTrail} ? audioCurrent${uniqueSuffix} : ${decayedTrail}`;
        } else if (buffer.mode === 4) {
            // Accumulate positive source energy as unbounded travel, not an envelope.
            assignValue = `${arrayName}[audioBin${uniqueSuffix}] + (audioCurrent${uniqueSuffix} > 0.0 ? audioCurrent${uniqueSuffix} : 0.0) * App.DeltaTime`;
        }
        return `${coefficientSetup}if (${arrayName}.SizeDim1 != ${sourceName}.SizeDim1) ${arrayName}.SizeDim1 = ${sourceName}.SizeDim1;\nfor (int audioBin${uniqueSuffix} = 0; audioBin${uniqueSuffix} < ${sourceName}.SizeDim1; audioBin${uniqueSuffix}++) {\n    float audioCurrent${uniqueSuffix} = ${sourceName}[audioBin${uniqueSuffix}];\n${smoothingLines}    ${arrayName}[audioBin${uniqueSuffix}] = ${assignValue};\n}${historyUpdate}`;
    }).join('\n');
    return `\n// Converter-managed independent persistent FFT states.\n${updates}\n`;
}

function validateAudioBufferParameters(configuredBuffers, parameterIds) {
    const available = new Set(parameterIds);
    const requirements = [
        { mode: 2, ids: ['PeakDecay'] },
        { mode: 3, ids: ['TrailDecay'] },
    ];
    const errors = [];
    for (const buffer of configuredBuffers.filter(buffer => buffer.mode === 1)) {
        const missing = [buffer.attackParameter || 'Attack', buffer.decayParameter || 'Decay']
            .filter(id => !available.has(id));
        if (missing.length) errors.push(`AudioBuffer${buffer.id} mode 1 requires ${missing.map(id => `ZGE${id}`).join(' and ')}.`);
    }
    for (const requirement of requirements) {
        if (!configuredBuffers.some(buffer => buffer.mode === requirement.mode)) continue;
        const missing = requirement.ids.filter(id => !available.has(id));
        if (missing.length) errors.push(`Audio buffer mode ${requirement.mode} requires ${missing.map(id => `ZGE${id}`).join(' and ')}.`);
    }
    return errors;
}

// ValueArrayRef textures are always one row in ZGE. Store history in native
// R32F targets instead, with distinct read/write targets to avoid GPU feedback.
function buildAudioHistoryResources(buffers) {
    let content = '', render = '';
    for (const buffer of buffers.filter(buffer => buffer.mode === 5)) {
        const name = `AudioBuffer${buffer.id}History`;
        const vertex = 'void main(){vec4 vertex=gl_Vertex;vertex.xy*=2.0;gl_Position=vertex;}';
        content += `
    <RenderTarget Name="${name}Target" CustomWidth="1" CustomHeight="${buffer.historyFrames}" ClearBeforeUse="0" Filter="1" InternalFormat="2"/>
    <RenderTarget Name="${name}Previous" CustomWidth="1" CustomHeight="${buffer.historyFrames}" ClearBeforeUse="0" Filter="1" InternalFormat="2"/>
    <Shader Name="${name}WriteShader"><VertexShaderSource><![CDATA[${vertex}]]></VertexShaderSource><FragmentShaderSource><![CDATA[
uniform sampler2D tex1, currentSpectrum;
uniform float historyHead, historyCount, historyBins;
void main(){
    vec2 uv=vec2(gl_FragCoord.x/historyBins,gl_FragCoord.y/${buffer.historyFrames}.0);
    float value=0.0;
    if(floor(gl_FragCoord.y)==historyHead) value=texture2D(currentSpectrum,vec2(uv.x,0.0)).r;
    else if(historyCount>1.0) value=texture2D(tex1,uv).r;
    gl_FragColor=vec4(value,0.0,0.0,1.0);
}]]></FragmentShaderSource><UniformVariables>
      <ShaderVariable VariableName="currentSpectrum" ValueArrayRef="AudioBuffer${buffer.id}"/>
      <ShaderVariable VariableName="historyHead" ValuePropRef="${name}Head"/>
      <ShaderVariable VariableName="historyCount" ValuePropRef="${name}Count"/>
      <ShaderVariable VariableName="historyBins" ValuePropRef="${name}Bins"/>
    </UniformVariables></Shader>
    <Shader Name="${name}CopyShader"><VertexShaderSource><![CDATA[${vertex}]]></VertexShaderSource><FragmentShaderSource><![CDATA[
uniform sampler2D tex1;
uniform float historyBins;
void main(){gl_FragColor=texture2D(tex1,vec2(gl_FragCoord.x/historyBins,gl_FragCoord.y/${buffer.historyFrames}.0));}
]]></FragmentShaderSource><UniformVariables><ShaderVariable VariableName="historyBins" ValuePropRef="${name}Bins"/></UniformVariables></Shader>
    <Material Name="${name}WriteMaterial" Shader="${name}WriteShader" ZBuffer="0" Blend="0"><Textures><MaterialTexture RenderTarget="${name}Previous" TexCoords="1"/></Textures></Material>
    <Material Name="${name}CopyMaterial" Shader="${name}CopyShader" ZBuffer="0" Blend="0"><Textures><MaterialTexture RenderTarget="${name}Target" TexCoords="1"/></Textures></Material>
`;
        for (const property of ['Head', 'Count', 'Clock', 'Bins', 'Capture']) content += `    <Variable Name="${name}${property}"/>\n`;
        render += `    <ZExpression Comment="Capture spectrum history ${buffer.id}"><Expression><![CDATA[
if (${name}Capture > 0.5 && ${name}Bins > 0) {
    @SetRenderTarget(RenderTarget : ${name}Target);
    @UseMaterial(Material : ${name}WriteMaterial);
    @RenderSprite();
    @SetRenderTarget(RenderTarget : ${name}Previous);
    @UseMaterial(Material : ${name}CopyMaterial);
    @RenderSprite();
    @SetRenderTarget(RenderTarget : null);
    ${name}Capture = 0;
}
]]></Expression></ZExpression>\n`;
    }
    return { content, render };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { analyzeAudioMarkers, buildAudioBufferUpdateCode, validateAudioBufferParameters, buildAudioHistoryResources };
}
