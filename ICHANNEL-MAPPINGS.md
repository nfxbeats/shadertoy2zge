# Shader channel mapping comments

Declare a source on its own `//` comment line anywhere in a single-pass shader. Place these comments after the Title/Author header so the intended inputs are visible together:

```glsl
// iChannel0: Feedback
// iChannel1: ImageSrc
// iChannel2: FFT
// iChannel3: Text
```

Include only the mappings the shader needs. Each line selects the source for that exact channel; the converter preserves the shader's channel numbers while assigning ZGE texture slots internally. The conventional layout above keeps FFT on `iChannel2` and text on `iChannel3`, consistent with the shader specification. The converter can also honor explicitly requested alternative channel assignments.

| Source | Accepted spellings (case-insensitive) | ZGE resource |
| --- | --- | --- |
| `Feedback` | `Feedback` | The layer's feedback/composited scene texture |
| `ImageSrc` | `ImageSrc`, `Image Src`, `Image Source` | The layer's Image Src selection (`Bitmap1`) |
| `FFT` | `FFT`, `AudioFFT`, `Audio Spectrum`, `Audio Spectrum (FFT)` | The host spectrum array (`SpecBandArray`), red component at `y = 0.0` |
| `Text` | `Text`, `Text Render`, `TextOverlay` | A transparent text render target generated before the shader |

Spaces, underscores, and hyphens within source names are interchangeable. Trailing notes are allowed after a second `//`, for example `// iChannel0: Feedback // background`. Channel names must be `iChannel0` through `iChannel3`. Directives embedded in `/* ... */` documentation or following GLSL code on the same line are ignored.

## Automatic selection and validation

The converter displays each declared channel, selects its source, and locks that dropdown while the directive remains present. The comments take precedence during conversion, including when the UI has not been refreshed. Removing a directive unlocks its dropdown; channels without directives remain manually configurable.

Assign each channel only once. At most one channel can use Feedback, and at most one can use Text. Multiple ImageSrc assignments share the same layer image selection; multiple FFT assignments share the same host spectrum. Unknown sources, invalid channel numbers, duplicate assignments, or text-output conflicts stop conversion with an error and clear the previous result.

These comments are converter metadata. They do not declare GLSL uniforms, add shader parameters, change FFT analysis, or provide the corresponding textures in ShaderToy itself. Configure matching channels manually when previewing on ShaderToy. See [AUDIO.md](AUDIO.md) for the existing `AudioFFT()` / `AudioBufferX()` analysis contract.

## Text mappings and custom text settings

A Text mapping works on its own:

```glsl
// iChannel3: Text
```

It creates the same text renderer as `// ZGETextOverlay: output=iChannel3 value=none format="{line}" position=scene`. The renderer uses the selected FL Studio text line and the shader's required `ZGEPositionX` / `ZGEPositionY` controls. With no explicit `ZGETextOverlay` directive, the text control group is appended after the shader's ZGE parameters.

To customize the renderer, also include the existing directive with a matching output channel:

```glsl
// iChannel3: Text
// ZGETextOverlay: output=iChannel3 value=timer format="{line}: {value}" position=scene
```

The matching declarations create one renderer. A Text mapping to a different channel, or a Text mapping combined with `output=overlay`, is an error. Existing shaders using only `ZGETextOverlay` continue to work.

Choose position mode to match the shader: `position=scene` places text in NanoVG, while `position=shader` lets GLSL place the text and requires the `TextOverlayUV()` fallback and sampling transform. See [TEXT-OVERLAY.md](TEXT-OVERLAY.md) for the complete contract, including source fitting and centering. Do not apply the scene position twice.

## Paste-ready system prompt addition

Copy this block into your shader-generation system prompt:

````text
When a shader uses external inputs, declare each required iChannel source using a standalone comment immediately after the existing Title/Author/Comment header:

```glsl
// iChannel0: Feedback
// iChannel1: ImageSrc
// iChannel2: FFT
// iChannel3: Text
```

Include only the lines actually needed. Use this conventional channel layout unless I explicitly request another assignment. Supported source names are Feedback, ImageSrc (also Image Src), FFT, and Text. Do not redeclare the supplied iChannel uniforms.

Feedback selects the layer's feedback scene. ImageSrc selects its Image Src dropdown. FFT selects current spectrum data; preserve the existing AudioFFT/AudioBuffer analysis rules and read FFT through those helpers. Text selects the generated text texture; preserve the existing ZGETextOverlay and text-positioning rules. Mapping comments alone do not request extra parameters or audio processing.

Declare each channel once, with at most one Feedback channel and one Text channel. If a ZGETextOverlay directive is present, its output must match the Text mapping. Preserve its other options. A Text mapping without that directive creates the default renderer (value=none, format="{line}", position=scene). If GLSL places/scales/rotates text, use the documented position=shader and TextOverlayUV contract instead.
````
