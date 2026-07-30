# Shadertoy to ZGameEditor converter. 
The goal of this web app is an easy, one-shot conversion of Shadertoy shaders to ZGameEditor project files. Just paste in your Shadertoy code and it should spit out a fully functional .zgeproj file.

For those unaware, [ZGameEditor](https://www.zgameeditor.org/) is an open-source game engine. And it's also been fully integrated as an [FL Studio plugin](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/ZGameEditor%20Visualizer.htm), a very powerful composer for audio visualization.

ZGameEditor provides a built-in language for creating games, visualizations and more. But it also supports GLSL shaders and can handle a lot of Shadertoy code out-of-the-box. This converter aims to greatly simplify porting of shaders.

There is an [Online Converter](https://nfxbeats.github.io/shadertoy2zge/) that is usable right now without the need to copy this repository code for immediate conversions.

## What it does currently
- Adds user provided Shadertoy code into the appropriate spot in a template.
- Ensures texture calls are replaced with ZGE's texture2D.
- Enables access to the current Feedback video texture.
- Enables access to Image Src drop-down texture.
- Enables access to audio spectrum FFT data for audio reactive shaders

## How to use
- Find a usable shadertoy shader such as this [LED Spectrum](https://www.shadertoy.com/view/NfVGD1).
- Copy the shadertoy code into the [online converter](https://nfxbeats.github.io/shadertoy2zge/)
- Set the appropriate GLSL version and iChannel sources
- Click Convert to convert the code
- Click Download ZGE Project to download the .zgeproj file.
- Place the .zgeproj file into a folder for ZGE effects 

Example Screenshot:

![Example usage](/converter-example.png)

### Finding your ZGE Folder
To use these ZGE Effects, you must copy them into the folder "**User Data Folder**\ZGameEditor Visualizer\Effects".

NOTE: The **"User Data Folder"** may differ depending on OS, username and custom settings.

You can find your User Data Folder in FL Studio under Options->File Settings. Look for the section labelled **"User Data Folder"**

For example my User Data Folder is "D:\ImageLineData" so my location would be "D:\ImageLineData\ZGameEditor Visualizer\Effects"

## Comment-Based Data Extraction
The converter extracts metadata from special comment lines in your shader code:

- **`// Title: [name]`** - Sets the project title (used in download filename)
- **`// Author: [name]`** - Sets the project author (stored in ZGE project metadata and use for credit on the Export dialog.)
- **`// Comment: [text]`** - Adds a comment to the shader component in ZGE MainShader (not visible, just stored)
- **`// ZGEdelta`** - Adds a Speed slider that controls animation speed

Example usage:
```
// Title: Rainbow Vortex
// Author: CreativeCoder
// Comment: A mesmerizing color-changing effect
// ZGEdelta
```
- Extracts any float variable declarations prefixed with ZGE (ex: ZGEtimeFactor, ZGEratio), adds them as uniforms and creates respective parameters to adjust their values.
- Extracts bool variable declarations prefixed with ZGE (ex: ZGEEnableEffect, ZGEInvert), adds them as float uniforms (0.0/1.0) and creates checkbox controls in ZGE.
- If keyword **ZGEdelta** is included in any comments, a Speed slider will be added that will adjust deltaTime so as to speed up or reverse time for graphic processing.
- Provides a download link of the resulting project via data uri.

## A note about iChannel Sources
ShaderToy allows for up to 4 textures to be used. These textures are called iChannel0, iChannel1, iChannel2, and iChannel3. 

FL Studio definitions:
- Feedback: This is the scene that the ZGE shader is layered above. You ShaderToy code should use this as a background layer.
- Image Src: This is the image source drop down on the ZGE layer properties.
- Audio Spectrum (FFT): Binds FL Studio's host-populated `SpecBandArray` directly to the selected `iChannel` as a shader texture. Shadertoy spectrum reads such as `texture(iChannel2, vec2(frequency, 0.0)).x` work without an intermediate bitmap. This source supplies the FFT spectrum row only; Shadertoy's waveform data row is not provided. See [AUDIO.md](AUDIO.md) for details on how to make audio reactive compatible shaders

You can define any valid iChannel source using the iChannel Source dropdown. A shader that demonstrates texture inputs can be seen here:
https://www.shadertoy.com/view/WXtcDf 

Audio Reactive Demo:
https://www.shadertoy.com/view/NfVGD1


## Extraction of float and bool variables

The tool will attempt to extract variables defined as floats or bools, with the prefix ZGE, in order to use them as uniforms that can be adjusted in ZGameEditor.

### Float Variables
For example:
```
float ZGEspeed = 2.0; // Range: 0.0, 4.0
float ZGErandomness = 0.5; // Range 0.0, 2.0
```

It extracts those variables at the float definitions, removing the respective lines from the shader code since those definitions will be added as uniforms instead. It then adds those variables as uniforms.

For example, it adds the above variables as uniforms in the shader code:
```
uniform float ZGEspeed;
uniform float ZGErandomness;
```

It then adds those variables as parameters in ZGameEditor along with formulas to normalize the slider values based on specified Ranges.

### Boolean Variables
For example:
```
bool ZGEInvertColors = true;
bool ZGEShowGrid = false;
```

Booleans are stored as floats (0.0 = false, 1.0 = true) and automatically receive a checkbox control in ZGE. Use them in shaders with comparisons like `if (ZGEInvertColors > 0.5)`.

See [BOOLEANS.md](BOOLEANS.md) for detailed documentation on boolean parameters.

### Tags
You can add content following the @ symbol in variable definitions so that separators or other UI controls can be added within ZGE.

For example:
```
float ZGEimgSrcMix = 0.0;
float ZGEGamma = 1.0; // Range: 0.0, 3.0 @separator
float ZGEShape = 0.0; // @list: "Triangle", "Square", "Circle" @separator
```

The `@separator` tag is added to the variable declaration so that ZGE adds a separator prior to the parameter. Boolean parameters automatically receive the `@checkbox` tag.

The converter also supports `@list` with quote-enclosed, comma-separated values:

```glsl
float ZGEShape = 0.0; // @list: "Triangle", "Square", "Circle"
```

When `@list` is used:
- It must always come before `@separator`
- the parameter remains a `float` uniform in GLSL,
- list labels are written to ParamHelp metadata as `@list: "..."`,
- and values remain normalized (`0..1`) 

For the example above, the three item shader-side values are interpreted as:
- `0.0` = Triangle
- `0.333...` = Square
- `0.666...` = Circle

To avoid rounding issues, I recommend you convert the float value to a discrete integer index value in your glsl comparisons. 

From the example definition above, I would use helper function like this:

```
// Convert normalized list value [0..1] to stable index [0..N-1]
int listIndex(float value, int itemCount) {
    // Guard for invalid counts
    if (itemCount <= 1) return 0;
    // Quantize normalized value into discrete bin
    int idx = int(floor(value * float(itemCount) + 0.5));
    // Clamp to legal range
    return clamp(idx, 0, itemCount - 1);
}

// example use of helper function 
int shapeIndex = listIndex(ZGEShape, 3);

if (shapeIndex == 0) {
    // Triangle
} else if (shapeIndex == 1) {
    // Square
} else {
    // Circle (index 2)
}
```

In the code repository, see `test_params.glsl` for a working example.


## Examples

The following are examples from Shadertoy that have been successfully converted to ZGE projects.

- Lacquer: https://www.shadertoy.com/view/M3jGDR
- Film Scratches: https://www.shadertoy.com/view/X3sGWl
- Displace Ooze: https://www.shadertoy.com/view/MXB3zK
- LED Array (audio): https://www.shadertoy.com/view/NfVGD1
