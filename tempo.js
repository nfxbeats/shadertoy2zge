// Portable ShaderToy musical clock -> FL Studio transport position.
(function (root) {
    function maskComments(source) {
        return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
            comment => comment.replace(/[^\r\n]/g, ' '));
    }

    function convert(source) {
        // Block comments may contain documentation examples, not directives.
        const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g,
            comment => comment.replace(/[^\r\n]/g, ' '));
        const directives = [...withoutBlocks.matchAll(/^\s*\/\/\s*ZGETempo\b([^\r\n]*)/gm)];
        if (!directives.length) return null;
        if (directives.length !== 1) throw new Error('Use exactly one ZGETempo directive per shader (or in Common).');
        const options = { version: '1', source: 'host', fallbackBpm: '120' };
        const text = directives[0][1].trim();
        if (text && !text.startsWith(':')) throw new Error('ZGETempo options must follow a colon.');
        const seen = new Set();
        for (const token of text.replace(/^:/, '').trim().split(/\s+/).filter(Boolean)) {
            const pair = /^(version|source|fallbackBpm)=([^\s=]+)$/.exec(token);
            if (!pair || seen.has(pair[1])) throw new Error(`Invalid or duplicate ZGETempo option: ${token}`);
            seen.add(pair[1]);
            options[pair[1]] = pair[2];
        }
        if (options.version !== '1') throw new Error('ZGETempo supports only version=1.');
        if (options.source !== 'host') throw new Error('ZGETempo supports only source=host.');
        if (!/^\d+(?:\.\d+)?$/.test(options.fallbackBpm) || !Number.isFinite(Number(options.fallbackBpm)) || Number(options.fallbackBpm) <= 0) {
            throw new Error('ZGETempo fallbackBpm must be a positive finite number.');
        }
        const clean = maskComments(source);
        if (/\btempoHostBeats\b/.test(clean)) throw new Error('tempoHostBeats is reserved for the converter.');
        const helpers = [...clean.matchAll(/\bfloat\s+TempoBeats\s*\(\s*(?:void\s*)?\)\s*\{/g)];
        if (helpers.length !== 1) throw new Error('ZGETempo requires exactly one float TempoBeats() fallback definition.');
        const helper = helpers[0];
        let end = helper.index + helper[0].length;
        let depth = 1;
        for (; end < clean.length && depth; end++) {
            if (clean[end] === '{') depth++;
            else if (clean[end] === '}') depth--;
        }
        if (depth) throw new Error('Unclosed TempoBeats() fallback body.');
        let result = source.slice(0, helper.index)
            + 'uniform float tempoHostBeats;\nfloat TempoBeats()\n{\n    return max(tempoHostBeats, 0.0);\n}'
            + source.slice(end);
        // GLSL 120 (and the unversioned template) has no integer clamp overload.
        // Match the prescribed listIndex helper without changing the source file.
        if (!/^\s*#version\s+(?:1[3-9]0|[2-9]\d\d)\b/m.test(source)) {
            const masked = maskComments(result);
            const replacements = [...masked.matchAll(/\breturn\s+clamp\(\s*idx\s*,\s*0\s*,\s*itemCount\s*-\s*1\s*\)\s*;/g)];
            for (const match of replacements.reverse()) result = result.slice(0, match.index)
                + 'return int(clamp(float(idx), 0.0, float(itemCount - 1)));'
                + result.slice(match.index + match[0].length);
        }
        return result;
    }

    function inject(xml) {
        let enabled = false;
        xml = xml.replace(/<Shader\b[^>]*>[\s\S]*?<\/Shader>/g, shader => {
            let converted = false;
            shader = shader.replace(/(<FragmentShaderSource>\s*<!\[CDATA\[)([\s\S]*?)(\]\]>\s*<\/FragmentShaderSource>)/,
                (whole, start, source, end) => {
                    const result = convert(source);
                    if (result === null) return whole;
                    converted = enabled = true;
                    return start + result + end;
                });
            if (!converted) return shader;
            if (!shader.includes('</UniformVariables>')) throw new Error('Tempo shader has no uniform bindings.');
            return shader.replace('</UniformVariables>', '<ShaderVariable VariableName="tempoHostBeats" VariableRef="SongPositionInBeats"/></UniformVariables>');
        });
        if (enabled && !/<Variable\b[^>]*\bName="SongPositionInBeats"/.test(xml)) {
            xml = xml.replace('</Content>', '<Variable Name="SongPositionInBeats"/></Content>');
        }
        return xml;
    }

    const api = { convert, inject };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.Tempo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
