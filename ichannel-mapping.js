(function (root) {
    const SOURCE_NAMES = Object.freeze({
        feedback: 'Feedback',
        bitmap1: 'Image Src',
    });

    function normalizeSource(value) {
        const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
        if (normalized === 'feedback') return 'feedback';
        if (normalized === 'image src' || normalized === 'image source') return 'bitmap1';
        return null;
    }

    function parseIChannelMappings(source) {
        const assignments = new Map();
        const warnings = [];
        const errors = [];
        const directivePattern = /^\s*\/\/\s*iChannel([0-3])\s*:\s*(.*?)\s*$/i;

        source.split(/\r?\n/).forEach((line, lineIndex) => {
            const match = line.match(directivePattern);
            if (!match) return;

            const channel = Number(match[1]);
            const selectedSource = normalizeSource(match[2]);
            if (!selectedSource) {
                errors.push(`Invalid iChannel${channel} source "${match[2]}" on line ${lineIndex + 1}; use Feedback or Image Src.`);
                return;
            }
            if (assignments.has(channel)) {
                errors.push(`iChannel${channel} is assigned more than once.`);
                return;
            }
            assignments.set(channel, selectedSource);
        });

        const feedbackChannels = Array.from(assignments.entries())
            .filter(([, selectedSource]) => selectedSource === 'feedback')
            .map(([channel]) => `iChannel${channel}`);
        if (feedbackChannels.length > 1) {
            errors.push(`Only one iChannel can use Feedback; comments assign ${feedbackChannels.join(', ')}.`);
        }

        return { assignments, warnings, errors };
    }

    function sourceLabel(selectedSource) {
        return SOURCE_NAMES[selectedSource] || selectedSource;
    }

    const api = { parseIChannelMappings, sourceLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.IChannelMapping = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
