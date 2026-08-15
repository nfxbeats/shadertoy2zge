const assert = require('node:assert/strict');
const { parseTextOverlay, parameterDefaults, parameterLabels, buildTextOverlayXML, injectTextOverlayXML, outputChannel } = require('../text-overlay.js');

assert.equal(parseTextOverlay('void main() {}'), null);
const basic = parseTextOverlay('// ZGETextOverlay\nvoid main() {}');
assert.equal(basic.options.value, 'manual');
assert.equal(parameterLabels(basic.options).length, 10);
assert.equal(parameterLabels(basic.options)[0], 'Text line @separator');
assert.equal(parameterLabels(basic.options).filter(label => label.includes('@separator')).length, 1);
assert.deepEqual(parameterDefaults(basic.options), [0, 0, 0, 0.1, 1, 0, 0, 1, 0.5, 0.1]);

const configured = parseTextOverlay('// ZGETextOverlay: value=timer format="{line}: {value:0.0}" size=.2 hue=.5 saturation=.8 lightness=.6 x=.4 y=.3 align=right');
assert.equal(configured.options.value, 'timer');
assert.equal(configured.options.format, '{line}: {value:0.0}');
assert.equal(configured.options.align, 'right');
assert.deepEqual(parameterDefaults(configured.options).slice(3), [.2, 1, .5, .8, .6, .4, .3]);

const xml = buildTextOverlayXML(configured.options, 4);
assert.match(xml.onLoaded, /ParamsUpdateComboItems\(FLPluginHandle,LayerNr,6,/);
assert.match(xml.onLoaded, /FLPluginPath\+"Effects\\\\HUD\\\\fonts\\\\"/);
assert.match(xml.updateChild, /Parameters\[4\]/);
assert.doesNotMatch(xml.updateChild, /\b(?:min|max)\s*\(/);
assert.match(xml.updateChild, /textOverlayMinInt/);
assert.match(xml.updateChild, /textOverlayMaxInt/);
assert.match(xml.updateChild, /TextOverlayValue\+=App\.DeltaTime/);
assert.match(xml.updateChild, /TextOverlayLine \+ ": " \+ textOverlayFormatValue\(TextOverlayValue,1\)/);
assert.match(xml.renderChild, /Parameters\[7\].*Parameters\[7\].*App\.ViewportHeight/);
assert.match(xml.updateChild, /Parameters\[9\].*Parameters\[10\].*Parameters\[11\]/);
assert.match(xml.renderChild, /Parameters\[12\].*App\.ViewportWidth.*Parameters\[13\].*App\.ViewportHeight/);
assert.match(xml.renderChild, /Parameters\[8\]<1.*nvg_TextBox/);

const invalid = parseTextOverlay('// ZGETextOverlay: value=wat align=diagonal mystery=1');
assert.equal(invalid.options.value, 'manual');
assert.equal(invalid.options.align, 'center');
assert.equal(invalid.warnings.length, 3);

const noValue = parseTextOverlay('// ZGETextOverlay: value=none format="{line}{value}"');
const noValueXml = buildTextOverlayXML(noValue.options, 0);
assert.match(noValueXml.updateChild, /TextOverlayText=TextOverlayLine \+ ""/);
assert.doesNotMatch(noValueXml.updateChild + noValueXml.renderChild, /Parameters\[undefined\]/);
assert.doesNotMatch(parameterLabels(noValue.options).join('\n'), /Text value/);
assert.equal(parameterLabels(noValue.options).length, 9);

const channel = parseTextOverlay('// ZGETextOverlay: output=iChannel3 overlay=true');
assert.equal(outputChannel(channel.options), 3);
const channelXml = buildTextOverlayXML(channel.options, 0);
assert.match(channelXml.targetRenderChild, /RenderTarget : TextOverlayRenderTarget/);
assert.match(channelXml.overlayRenderChild, /Render text overlay/);
const baseProject = '<ZApplication><OnUpdate></OnUpdate><OnRender><RenderSprite/></OnRender><Content></Content></ZApplication>';
const injected = injectTextOverlayXML(baseProject, channel.options, 0);
assert.ok(injected.indexOf('Render text overlay target') < injected.indexOf('<RenderSprite/>'));
assert.match(injected, /<RenderTarget Name="TextOverlayRenderTarget" Width="0" Height="0" ClearBeforeUse="255" ClearColor="0 0 0 0"\/>/);
