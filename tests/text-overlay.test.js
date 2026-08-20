const assert = require('node:assert/strict');
const { parseTextOverlay, parameterDefaults, parameterLabels, buildTextOverlayXML, injectTextOverlayXML, outputChannel } = require('../text-overlay.js');

assert.equal(parseTextOverlay('void main() {}'), null);
const basic = parseTextOverlay('// ZGETextOverlay\nvoid main() {}');
assert.equal(basic.options.value, 'none');
assert.equal(basic.options.format, '{line}');
assert.equal(basic.options.output, 'ichannel3');
assert.equal(basic.options.position, 'scene');
assert.equal(parameterLabels(basic.options).length, 9);
assert.equal(parameterLabels(basic.options)[0], 'Text line @separator');
assert.equal(parameterLabels(basic.options).filter(label => label.includes('@separator')).length, 1);
assert.deepEqual(parameterDefaults(basic.options), [0, 0, 0.1, 1, 0, 1 / 3, 0, 0, 1]);

const configured = parseTextOverlay('// ZGETextOverlay: value=timer format="{line}: {value:0.0}" position=text output=overlay size=.2 hue=.5 saturation=.8 lightness=.6 x=.4 y=.3');
assert.equal(configured.options.value, 'timer');
assert.equal(configured.options.format, '{line}: {value:0.0}');
assert.deepEqual(parameterDefaults(configured.options).slice(3), [.2, 1, 0, 1 / 3, .5, .8, .6, .4, .3]);

const xml = buildTextOverlayXML(configured.options, 4);
assert.match(xml.onLoaded, /ParamsUpdateComboItems\(FLPluginHandle,LayerNr,6,/);
assert.match(xml.onLoaded, /FLPluginPath\+"Effects\\\\HUD\\\\fonts\\\\"/);
assert.match(xml.onLoaded, /void OnGLContextChange\(\) \{ textOverlayInitNanoVG\(\); \}/);
assert.match(xml.onLoaded, /void textOverlayInitNanoVG\(\).*TextOverlayFontId=-1;TextOverlayCurrentFont=-1/);
assert.match(xml.onLoaded, /textOverlayInitNanoVG\(\);/);
assert.match(xml.updateChild, /Parameters\[4\]/);
assert.doesNotMatch(xml.updateChild, /\b(?:min|max)\s*\(/);
assert.match(xml.updateChild, /textOverlayMinInt/);
assert.match(xml.updateChild, /textOverlayMaxInt/);
assert.match(xml.updateChild, /TextOverlayValue\+=App\.DeltaTime/);
assert.match(xml.updateChild, /TextOverlayLine \+ ": " \+ textOverlayFormatValue\(TextOverlayValue,1\)/);
assert.match(xml.renderChild, /Parameters\[7\].*Parameters\[7\].*App\.ViewportHeight/);
assert.match(xml.updateChild, /Parameters\[11\].*Parameters\[12\].*Parameters\[13\]/);
assert.match(xml.renderChild, /Parameters\[14\].*App\.ViewportWidth.*Parameters\[15\].*App\.ViewportHeight/);
assert.match(xml.renderChild, /float textRowWidth=Parameters\[8\]==1\?-1:Parameters\[8\]\*App\.ViewportWidth/);
assert.match(xml.renderChild, /textHAlign=.*Parameters\[10\]\*3/);
assert.match(xml.renderChild, /textAlign=textHAlign==0\?NVG_ALIGN_RIGHT:\(textHAlign==1\?NVG_ALIGN_CENTER:NVG_ALIGN_LEFT\)/);
assert.match(xml.renderChild, /textBoxX=textHAlign==0\?-textRowWidth:\(textHAlign==1\?-textRowWidth\*0\.5:0\)/);
assert.match(xml.renderChild, /Parameters\[9\]>0\.5 && textRowWidth>=0/);
assert.match(xml.renderChild, /nvg_MoveTo\(textBoxX,-textY\).*nvg_MoveTo\(textBoxX\+textRowWidth,-textY\)/);
assert.match(xml.onLoaded, /void nvg_StrokeColor.*void nvg_StrokeWidth.*void nvg_Stroke/);
assert.match(xml.renderChild, /nvg_SetContext\(TextOverlayContext\);nvg_SetViewport\(TextOverlayContext\);nvg_BeginFrame\(\)/);
assert.match(xml.renderChild, /nvg_Translate\(textX,textY\).*textRowWidth>=0.*nvg_TextBox\(textBoxX,0,textRowWidth/);
assert.doesNotMatch(xml.renderChild, /nvg_TextBox\(textX,textY/);
assert.doesNotMatch(xml.updateChild, /nvg_SetViewport/);
assert.match(xml.onClose, /nvg_SetContext\(TextOverlayContext\);nvg_Finish\(TextOverlayContext\);TextOverlayContext=null/);

const invalid = parseTextOverlay('// ZGETextOverlay: value=wat position=text align=diagonal mystery=1');
assert.equal(invalid.options.value, 'manual');
assert.equal(invalid.warnings.length, 3);

const noValue = parseTextOverlay('// ZGETextOverlay: value=none format="{line}{value}" position=text output=overlay');
const noValueXml = buildTextOverlayXML(noValue.options, 0);
assert.match(noValueXml.updateChild, /TextOverlayText=TextOverlayLine \+ ""/);
assert.doesNotMatch(noValueXml.updateChild + noValueXml.renderChild, /Parameters\[undefined\]/);
assert.doesNotMatch(parameterLabels(noValue.options).join('\n'), /Text value/);
assert.equal(parameterLabels(noValue.options).length, 11);

const scenePosition = parseTextOverlay('// ZGETextOverlay: value=none position=scene');
scenePosition.options.positionXParameter = 1;
scenePosition.options.positionYParameter = 2;
assert.doesNotMatch(parameterLabels(scenePosition.options).join('\n'), /Text [XY]/);
assert.equal(parameterLabels(scenePosition.options).length, 9);
const sceneXml = buildTextOverlayXML(scenePosition.options, 14);
assert.match(sceneXml.targetRenderChild, /float textX=Parameters\[1\]\*App\.ViewportWidth/);
assert.match(sceneXml.targetRenderChild, /float textY=Parameters\[2\]\*App\.ViewportHeight/);
assert.doesNotMatch(sceneXml.targetRenderChild, /Parameters\[undefined\]/);

const channel = parseTextOverlay('// ZGETextOverlay: output=iChannel3 position=text overlay=true');
assert.equal(outputChannel(channel.options), 3);
const channelXml = buildTextOverlayXML(channel.options, 0);
assert.match(channelXml.targetRenderChild, /RenderTarget : TextOverlayRenderTarget/);
assert.match(channelXml.overlayRenderChild, /Render text overlay/);
const baseProject = '<ZApplication><OnUpdate></OnUpdate><OnRender><RenderSprite/></OnRender><Content></Content></ZApplication>';
const injected = injectTextOverlayXML(baseProject, channel.options, 0);
assert.ok(injected.indexOf('Render text overlay target') < injected.indexOf('<RenderSprite/>'));
assert.match(injected, /<RenderTarget Name="TextOverlayRenderTarget" Width="0" Height="0" ClearBeforeUse="255" ClearColor="0 0 0 0"\/>/);
