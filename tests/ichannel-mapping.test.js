const assert = require('node:assert/strict');
const { parseIChannelMappings, sourceLabel } = require('../ichannel-mapping.js');

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
assert.match(invalid.errors[0], /use Feedback or Image Src/);

const duplicate = parseIChannelMappings('// iChannel1: Feedback\n// iChannel1: Image Src');
assert.match(duplicate.errors[0], /assigned more than once/);

const twoFeedback = parseIChannelMappings('// iChannel0: Feedback\n// iChannel3: Feedback');
assert.match(twoFeedback.errors[0], /Only one iChannel/);

console.log('ichannel-mapping tests passed');
