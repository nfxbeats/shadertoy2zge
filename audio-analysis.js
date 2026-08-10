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
    const declarationPattern = /\b(?:const\s+)?(?:int|float)\s+AudioBuffer([1-9]\d*)(Mode|Source)\s*=\s*(-?\d+(?:\.0*)?)\s*;/g;
    let declaration;
    while ((declaration = declarationPattern.exec(cleaned)) !== null) {
        const [, id, property, value] = declaration;
        if (!declarations.has(id)) declarations.set(id, { id });
        declarations.get(id)[property.toLowerCase()] = Number(value);
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
        if (![0, 1, 2, 3].includes(config.mode)) {
            errors.push(`Unsupported audio buffer mode: AudioBuffer${id}Mode=${config.mode}.`);
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
    const usesAttackDecay = configuredBuffers.some(buffer => buffer.mode === 1);
    const coefficientSetup = usesAttackDecay
        ? `float audioAttackCoeff = ${attack} < 0.0000001 ? 0.0 : exp(-1.0 / (clamp(App.FpsCounter, 15, 60) * ${attack} * 0.001));\nfloat audioDecayCoeff = ${decay} < 0.0000001 ? 0.0 : exp(-1.0 / (clamp(App.FpsCounter, 15, 60) * ${decay} * 0.001));\n`
        : '';
    const updates = configuredBuffers.map(buffer => {
        const suffix = buffer.id;
        const uniqueSuffix = suffix || 'Legacy';
        const arrayName = `AudioBuffer${suffix}`;
        const sourceName = buffer.source === 0 ? 'SpecBandArray' : `AudioBuffer${buffer.source}`;
        let assignValue = `audioCurrent${uniqueSuffix}`;
        let smoothingLines = '';
        if (buffer.mode === 1) {
            smoothingLines = `    float audioPrevious${uniqueSuffix} = ${arrayName}[audioBin${uniqueSuffix}];\n    float audioCoeff${uniqueSuffix} = abs(audioCurrent${uniqueSuffix}) > abs(audioPrevious${uniqueSuffix}) ? audioAttackCoeff : audioDecayCoeff;\n`;
            assignValue = `audioCoeff${uniqueSuffix} * (audioPrevious${uniqueSuffix} - audioCurrent${uniqueSuffix}) + audioCurrent${uniqueSuffix}`;
        } else if (buffer.mode === 2) {
            smoothingLines = `    float audioPrevious${uniqueSuffix} = ${arrayName}[audioBin${uniqueSuffix}];\n`;
            const decayedPeak = `audioPrevious${uniqueSuffix} - (${peakDecay}) * App.DeltaTime`;
            assignValue = `audioCurrent${uniqueSuffix} > ${decayedPeak} ? audioCurrent${uniqueSuffix} : ${decayedPeak}`;
        } else if (buffer.mode === 3) {
            smoothingLines = `    float audioPrevious${uniqueSuffix} = ${arrayName}[audioBin${uniqueSuffix}];\n`;
            const decayedTrail = `audioPrevious${uniqueSuffix} * exp(-(${trailsDecay}) * App.DeltaTime)`;
            assignValue = `audioCurrent${uniqueSuffix} > ${decayedTrail} ? audioCurrent${uniqueSuffix} : ${decayedTrail}`;
        }
        return `if (${arrayName}.SizeDim1 != ${sourceName}.SizeDim1) ${arrayName}.SizeDim1 = ${sourceName}.SizeDim1;\nfor (int audioBin${uniqueSuffix} = 0; audioBin${uniqueSuffix} < ${sourceName}.SizeDim1; audioBin${uniqueSuffix}++) {\n    float audioCurrent${uniqueSuffix} = ${sourceName}[audioBin${uniqueSuffix}];\n${smoothingLines}    ${arrayName}[audioBin${uniqueSuffix}] = ${assignValue};\n}`;
    }).join('\n');
    return `\n// Converter-managed independent persistent FFT states.\n${coefficientSetup}${updates}\n`;
}

function validateAudioBufferParameters(configuredBuffers, parameterIds) {
    const available = new Set(parameterIds);
    const requirements = [
        { mode: 1, ids: ['Attack', 'Decay'] },
        { mode: 2, ids: ['PeakDecay'] },
        { mode: 3, ids: ['TrailDecay'] },
    ];
    const errors = [];
    for (const requirement of requirements) {
        if (!configuredBuffers.some(buffer => buffer.mode === requirement.mode)) continue;
        const missing = requirement.ids.filter(id => !available.has(id));
        if (missing.length) errors.push(`Audio buffer mode ${requirement.mode} requires ${missing.map(id => `ZGE${id}`).join(' and ')}.`);
    }
    return errors;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { analyzeAudioMarkers, buildAudioBufferUpdateCode, validateAudioBufferParameters };
}
