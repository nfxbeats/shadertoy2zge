(function (root) {
    const DEFAULTS = Object.freeze({
        value: 'none',
        format: '{line}',
        size: 0.1,
        rowwidth: 1,
        font: 0,
        hue: 0,
        saturation: 0,
        lightness: 1,
        x: 0.5,
        y: 0.1,
        output: 'ichannel3',
        overlay: false,
        position: 'scene',
    });

    const BASE_PARAMS = [
        ['Text line @separator', 'textLine', 0],
        ['Text value', 'textValue', 0],
        ['Font @list1000:', 'font', 0],
        ['Font size', 'size', 0.1],
        ['Row width', 'rowwidth', 1],
        ['Show guides @checkbox', 'showGuides', 0],
        ['Horizontal align @list: "Left", "Center", "Right"', 'halign', 1 / 3],
        ['Font hue', 'hue', 0],
        ['Font saturation', 'saturation', 0],
        ['Font lightness', 'lightness', 1],
        ['Text X', 'x', 0.5],
        ['Text Y', 'y', 0.1],
    ];

    function paramsForConfig(config) {
        let params = config && config.value === 'none'
            ? BASE_PARAMS.filter(([, key]) => key !== 'textValue')
            : BASE_PARAMS;
        if (config && config.position === 'scene') params = params.filter(([, key]) => key !== 'x' && key !== 'y');
        return params;
    }

    function clamp01(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
    }

    function parseTextOverlay(source) {
        const line = source.split(/\r?\n/).find(item => /^\s*\/\/\s*ZGETextOverlay\b/i.test(item));
        if (!line) return null;
        const colon = line.indexOf(':');
        const raw = colon < 0 ? '' : line.substring(colon + 1);
        const options = { ...DEFAULTS };
        const warnings = [];
        const known = new Set(Object.keys(DEFAULTS));
        const pattern = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g;
        let match;
        while ((match = pattern.exec(raw)) !== null) {
            const key = match[1].toLowerCase();
            let value = match[2];
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1).replace(/\\([\\"'])/g, '$1');
            }
            if (!known.has(key)) {
                warnings.push(`Unknown ZGETextOverlay option "${match[1]}".`);
                continue;
            }
            options[key] = value;
        }
        if (!['manual', 'timer', 'random', 'none'].includes(String(options.value).toLowerCase())) {
            warnings.push(`Invalid ZGETextOverlay value mode "${options.value}"; using manual.`);
            options.value = 'manual';
        }
        options.value = String(options.value).toLowerCase();
        options.position = String(options.position).toLowerCase();
        if (!['text', 'scene'].includes(options.position)) {
            warnings.push(`Invalid ZGETextOverlay position mode "${options.position}"; using text.`);
            options.position = 'text';
        }
        options.output = String(options.output).toLowerCase();
        if (options.output !== 'overlay' && !/^ichannel[0-3]$/.test(options.output)) {
            warnings.push(`Invalid ZGETextOverlay output "${options.output}"; using overlay.`);
            options.output = 'overlay';
        }
        if (typeof options.overlay === 'string') {
            if (!/^(true|false)$/i.test(options.overlay)) warnings.push(`Invalid ZGETextOverlay overlay value "${options.overlay}"; using false.`);
            options.overlay = /^true$/i.test(options.overlay);
        } else options.overlay = Boolean(options.overlay);
        for (const key of ['size', 'rowwidth', 'halign', 'showGuides', 'hue', 'saturation', 'lightness', 'x', 'y']) {
            options[key] = clamp01(options[key], DEFAULTS[key]);
        }
        options.font = clamp01(options.font, 0);
        options.format = String(options.format);
        return { options, warnings };
    }

    function parameterDefaults(config) {
        return paramsForConfig(config).map(([, key, fallback]) => clamp01(config[key], fallback));
    }

    function parameterLabels(config) {
        return paramsForConfig(config).map(([label]) => label);
    }

    function zgeString(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
    }

    function formatExpression(format, includeValue = true) {
        const tokens = String(format).split(/(\{line\}|\{value(?::0(?:\.0+)?)?\})/g).filter(Boolean);
        if (!tokens.length) return '""';
        return tokens.map(token => {
            if (token === '{line}') return 'TextOverlayLine';
            if (token.startsWith('{value')) {
                if (!includeValue) return '""';
                const decimalMatch = token.match(/\.([0]+)\}/);
                return `textOverlayFormatValue(TextOverlayValue,${decimalMatch ? decimalMatch[1].length : 0})`;
            }
            return `"${zgeString(token)}"`;
        }).join(' + ');
    }

    function buildTextOverlayXML(config, parameterStart) {
        const params = paramsForConfig(config);
        const p = Object.fromEntries(params.map(([, key], index) => [key, parameterStart + index]));
        const mode = { none: 0, manual: 1, timer: 2, random: 3 }[config.value];
        const formatted = formatExpression(config.format, config.value !== 'none');
        const channelOutput = /^ichannel[0-3]$/.test(config.output);
        const xParam = config.position === 'scene' ? config.positionXParameter : p.x;
        const yParam = config.position === 'scene' ? config.positionYParameter : p.y;
        const drawText = `if(TextOverlayContext!=null && TextOverlayFontId>=0){nvg_SetContext(TextOverlayContext);nvg_SetViewport(TextOverlayContext);nvg_BeginFrame();nvg_FontFaceId(TextOverlayFontId);nvg_FontSize(Parameters[${p.size}]*Parameters[${p.size}]*App.ViewportHeight);int textHAlign=textOverlayMinInt(2,textOverlayMaxInt(0,round(Parameters[${p.halign}]*3)));int textAlign=textHAlign==0?NVG_ALIGN_RIGHT:(textHAlign==1?NVG_ALIGN_CENTER:NVG_ALIGN_LEFT);nvg_TextAlign(textAlign|NVG_ALIGN_TOP);nvg_FillColor(TextOverlayColor.R,TextOverlayColor.G,TextOverlayColor.B,1);float textX=Parameters[${xParam}]*App.ViewportWidth;float textY=Parameters[${yParam}]*App.ViewportHeight;float textRowWidth=Parameters[${p.rowwidth}]==1?-1:Parameters[${p.rowwidth}]*App.ViewportWidth;float textBoxX=textHAlign==0?-textRowWidth:(textHAlign==1?-textRowWidth*0.5:0);nvg_Translate(textX,textY);if(textRowWidth>=0)nvg_TextBox(textBoxX,0,textRowWidth,TextOverlayText,null);else nvg_Text(0,0,TextOverlayText,null);if(Parameters[${p.showGuides}]>0.5 && textRowWidth>=0){nvg_BeginPath();nvg_MoveTo(textBoxX,-textY);nvg_LineTo(textBoxX,App.ViewportHeight-textY);nvg_MoveTo(textBoxX+textRowWidth,-textY);nvg_LineTo(textBoxX+textRowWidth,App.ViewportHeight-textY);nvg_StrokeColor(0.2,0.5,1,0.85);nvg_StrokeWidth(2);nvg_Stroke();}nvg_EndFrame();}`;
        const onLoaded = `  <OnLoaded>
    <ZExternalLibrary Comment="Text overlay vector graphics" ModuleName="ZgeNano" CallingConvention="1"><Source><![CDATA[
const int NVG_STENCIL_STROKES=2, NVG_ALIGN_LEFT=1, NVG_ALIGN_CENTER=2, NVG_ALIGN_RIGHT=4, NVG_ALIGN_TOP=8;
xptr nvg_Init(int flags) {} void nvg_SetContext(xptr context) {} void nvg_Finish(xptr context) {}
int nvg_SetViewport(xptr context) {} void nvg_BeginFrame() {} void nvg_EndFrame() {}
int nvg_CreateFontMem(string name,xptr data,int ndata,int freeData) {} int nvg_FindFont(string name) {}
void nvg_FontSize(float size) {} void nvg_TextAlign(int align) {} void nvg_FontFaceId(int font) {}
void nvg_Translate(float x,float y) {}
void nvg_BeginPath() {} void nvg_MoveTo(float x,float y) {} void nvg_LineTo(float x,float y) {}
void nvg_StrokeColor(float r,float g,float b,float a) {} void nvg_StrokeWidth(float size) {} void nvg_Stroke() {}
void nvg_FillColor(float r,float g,float b,float a) {} void nvg_Text(float x,float y,string str,string end) {}
void nvg_TextBox(float x,float y,float breakRowWidth,string str,string end) {}
]]></Source></ZExternalLibrary>
    <ZExternalLibrary ModuleName="ZGameEditor Visualizer"><Source><![CDATA[
void ParamsUpdateComboItems(xptr Handle,int Layer,int Param,string[] NewItems) {}
void ZgeVizGetFileNames(string path,string pattern,string[] list) {}
void ZgeVizFontGetContent(string FileName,ref xptr ContentMem,ref int ContentSize) {}
]]></Source></ZExternalLibrary>
    <ZLibrary Comment="Text overlay runtime"><Source><![CDATA[
xptr FLPluginHandle; int LayerNr; string FLPluginPath;
xptr TextOverlayContext; string TextOverlayFontDir, TextOverlayText, TextOverlayLine;
string[0] UserTextArray; string[0] TextOverlayFontFiles; int TextOverlayFontId=-1, TextOverlayCurrentFont=-1;
float TextOverlayValue, TextOverlayRandomClock; vec4 TextOverlayColor;
void textOverlayInitNanoVG() { TextOverlayContext=nvg_Init(NVG_STENCIL_STROKES);TextOverlayFontId=-1;TextOverlayCurrentFont=-1; }
void OnGLContextChange() { textOverlayInitNanoVG(); }
int textOverlayMinInt(int a,int b) { return a<b?a:b; }
int textOverlayMaxInt(int a,int b) { return a>b?a:b; }
float textOverlayHue(float p,float q,float t) { if(t<0)t+=1; if(t>1)t-=1; if(t<0.166667)return p+(q-p)*6*t; if(t<0.5)return q; if(t<0.666667)return p+(q-p)*(0.666667-t)*6; return p; }
void textOverlayHsl(float h,float s,float l,ref vec4 c) { float q=l<0.5?l*(1+s):l+s-l*s; float p=2*l-q; if(s==0){c.R=l;c.G=l;c.B=l;}else{c.R=textOverlayHue(p,q,h+0.333333);c.G=textOverlayHue(p,q,h);c.B=textOverlayHue(p,q,h-0.333333);} c.A=1; }
string textOverlayFormatValue(float value,int decimals) { int scale=1;for(int i=0;i<decimals;i++)scale*=10;int scaled=round(value*scale);int whole=scaled/scale;if(decimals==0)return intToStr(whole);int fraction=abs(scaled%scale);string tail=intToStr(fraction);while(length(tail)<decimals)tail="0"+tail;return intToStr(whole)+"."+tail; }
]]></Source></ZLibrary>
    <ZExpression Comment="Initialize text overlay"><Expression><![CDATA[
textOverlayInitNanoVG();
TextOverlayFontDir=MACOS ? FLPluginPath+"Effects/HUD/fonts/" : FLPluginPath+"Effects\\\\HUD\\\\fonts\\\\";
ZgeVizGetFileNames(TextOverlayFontDir,"*.ttf;*.zfo",TextOverlayFontFiles);
string[0] textOverlayNames; textOverlayNames.SizeDim1=TextOverlayFontFiles.SizeDim1;
for(int i=0;i<textOverlayNames.SizeDim1;i++) textOverlayNames[i]=subStr(TextOverlayFontFiles[i],0,length(TextOverlayFontFiles[i])-4);
ParamsUpdateComboItems(FLPluginHandle,LayerNr,${p.font},textOverlayNames);
]]></Expression></ZExpression>
  </OnLoaded>\n`;
        const updateChild = `    <ZExpression Comment="Update text overlay"><Expression><![CDATA[
int textOverlayLineCount=UserTextArray.SizeDim1;
TextOverlayLine=textOverlayLineCount>0 ? UserTextArray[textOverlayMinInt(textOverlayLineCount-1,round(Parameters[${p.textLine}]*(textOverlayLineCount-1)))] : "";
${mode === 1 ? `TextOverlayValue=Parameters[${p.textValue}]*1000;` : ''}
if(${mode}==2) TextOverlayValue+=App.DeltaTime;
if(${mode}==3) { TextOverlayRandomClock+=App.DeltaTime; if(TextOverlayRandomClock>=1){TextOverlayRandomClock=0;TextOverlayValue=random(0,1000);} }
TextOverlayText=${formatted};
int textOverlayFontCount=TextOverlayFontFiles.SizeDim1;
if(textOverlayFontCount>0) { int nextFont=textOverlayMinInt(textOverlayFontCount-1,textOverlayMaxInt(0,round(Parameters[${p.font}]*1000))); if(nextFont!=TextOverlayCurrentFont){TextOverlayCurrentFont=nextFont;string fn=TextOverlayFontFiles[nextFont];TextOverlayFontId=nvg_FindFont(fn);if(TextOverlayFontId<0){xptr mem;int bytes;ZgeVizFontGetContent(TextOverlayFontDir+fn,mem,bytes);TextOverlayFontId=nvg_CreateFontMem(fn,mem,bytes,0);}} }
textOverlayHsl(Parameters[${p.hue}],Parameters[${p.saturation}],Parameters[${p.lightness}],TextOverlayColor);
]]></Expression></ZExpression>\n`;
        const targetRenderChild = channelOutput ? `    <ZExpression Comment="Render text overlay target"><Expression><![CDATA[
@SetRenderTarget(RenderTarget : TextOverlayRenderTarget);
${drawText}
@SetRenderTarget(RenderTarget : null);
]]></Expression></ZExpression>\n` : '';
        const overlayRenderChild = (!channelOutput || config.overlay) ? `    <ZExpression Comment="Render text overlay"><Expression><![CDATA[
${drawText}
]]></Expression></ZExpression>\n` : '';
        const onClose = `  <OnClose><ZExpression Comment="Finish text overlay"><Expression><![CDATA[if(TextOverlayContext!=null){nvg_SetContext(TextOverlayContext);nvg_Finish(TextOverlayContext);TextOverlayContext=null;}TextOverlayFontId=-1;TextOverlayCurrentFont=-1;]]></Expression></ZExpression></OnClose>\n`;
        return { onLoaded, updateChild, targetRenderChild, overlayRenderChild, renderChild: overlayRenderChild, onClose };
    }

    function injectTextOverlayXML(xml, config, parameterStart) {
        const blocks = buildTextOverlayXML(config, parameterStart);
        xml = xml.replace(/(<ZApplication\b[^>]*>\s*)/, `$1${blocks.onLoaded}`);
        xml = xml.replace('</OnUpdate>', `${blocks.updateChild}  </OnUpdate>`);
        if (blocks.targetRenderChild) xml = xml.replace(/(<OnRender>\s*)/, `$1${blocks.targetRenderChild}`);
        if (blocks.overlayRenderChild) xml = xml.replace('</OnRender>', `${blocks.overlayRenderChild}  </OnRender>`);
        xml = xml.replace('<Content>', `${blocks.onClose}  <Content>`);
        if (outputChannel(config) !== null) {
            xml = xml.replace('</Content>', '    <RenderTarget Name="TextOverlayRenderTarget" Width="0" Height="0" ClearBeforeUse="255" ClearColor="0 0 0 0"/>\n  </Content>');
        }
        return xml;
    }

    function outputChannel(config) {
        const match = String(config.output).match(/^ichannel([0-3])$/);
        return match ? Number(match[1]) : null;
    }

    const api = { parseTextOverlay, parameterDefaults, parameterLabels, buildTextOverlayXML, injectTextOverlayXML, outputChannel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TextOverlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
