(function (root) {
    const SOURCE_NAMES = Object.freeze({
        feedback: 'Feedback',
        bitmap1: 'Image Src',
        audio_spectrum: 'FFT',
        text_overlay: 'Text',
    });

    function normalizeSource(value) {
        const normalized = value.trim().toLowerCase().replace(/[\s_()-]+/g, '');
        if (normalized === 'feedback') return 'feedback';
        if (normalized === 'imagesrc' || normalized === 'imagesource') return 'bitmap1';
        if (['fft', 'audiofft', 'audiospectrum', 'audiospectrumfft'].includes(normalized)) return 'audio_spectrum';
        if (['text', 'textrender', 'textoverlay'].includes(normalized)) return 'text_overlay';
        return null;
    }

    // Ignore documentation inside block comments while retaining line numbers.
    // Consume line comments intact so a /* inside a directive does not open a block.
    function directiveSource(source) {
        return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
            comment => comment.startsWith('/*') ? comment.replace(/[^\r\n]/g, ' ') : comment);
    }

    function parseIChannelMappings(source) {
        const assignments = new Map();
        const warnings = [];
        const errors = [];
        const directivePattern = /^\s*\/\/\s*iChannel(\d+)\s*:\s*(.*?)\s*$/i;

        directiveSource(source).split(/\r?\n/).forEach((line, lineIndex) => {
            const match = line.match(directivePattern);
            if (!match) return;

            const channel = Number(match[1]);
            if (!/^[0-3]$/.test(match[1])) {
                errors.push(`Invalid iChannel${match[1]} on line ${lineIndex + 1}; use iChannel0 through iChannel3.`);
                return;
            }
            const value = match[2].split('//')[0].trim();
            const selectedSource = normalizeSource(value);
            if (!selectedSource) {
                errors.push(`Invalid iChannel${channel} source "${value}" on line ${lineIndex + 1}; use Feedback, ImageSrc (Image Src), FFT, or Text.`);
                return;
            }
            if (assignments.has(channel)) {
                errors.push(`iChannel${channel} is assigned more than once.`);
                return;
            }
            assignments.set(channel, selectedSource);
        });

        for (const source of ['feedback', 'text_overlay']) {
            const channels = Array.from(assignments.entries())
                .filter(([, selectedSource]) => selectedSource === source)
                .map(([channel]) => `iChannel${channel}`);
            if (channels.length > 1) errors.push(`Only one iChannel can use ${sourceLabel(source)}; comments assign ${channels.join(', ')}.`);
        }

        return { assignments, warnings, errors };
    }

    function resolveIChannelMappings(source, textOverlayApi) {
        const result = parseIChannelMappings(source);
        let textOverlay = textOverlayApi.parseTextOverlay(directiveSource(source));
        const textChannels = [...result.assignments].filter(([, value]) => value === 'text_overlay').map(([channel]) => channel);
        if (!textOverlay && textChannels.length === 1) {
            textOverlay = textOverlayApi.parseTextOverlay(`// ZGETextOverlay: output=iChannel${textChannels[0]}`);
        }
        if (textOverlay) {
            const textChannel = textOverlayApi.outputChannel(textOverlay.options);
            for (const channel of textChannels) {
                if (channel !== textChannel) result.errors.push(`iChannel${channel}: Text conflicts with ZGETextOverlay output=${textOverlay.options.output}; use the same channel in both comments.`);
            }
            const selected = result.assignments.get(textChannel);
            if (selected && selected !== 'text_overlay') {
                result.errors.push(`iChannel${textChannel} is reserved by ZGETextOverlay and cannot also use ${sourceLabel(selected)}.`);
            }
        }
        return { ...result, textOverlay };
    }

    function sourceLabel(selectedSource) {
        return SOURCE_NAMES[selectedSource] || selectedSource;
    }

    const api = { parseIChannelMappings, resolveIChannelMappings, sourceLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.IChannelMapping = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
