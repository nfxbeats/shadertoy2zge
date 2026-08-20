# Text overlays

Add this comment to use the default text-render configuration:

```glsl
// ZGETextOverlay
```

The bare directive is equivalent to:

```glsl
// ZGETextOverlay: output=iChannel3 value=none format="{line}" position=scene
```

It reserves `iChannel3`, displays the selected FL Studio text line without a numeric value, and binds placement to the required `ZGEPositionX` and `ZGEPositionY` controls.

The converter adds these ZGameEditor Visualizer parameters as one contiguous group at the position of the `// ZGETextOverlay` directive relative to the shader's `ZGE...` declarations. A separator is placed before **Text line**, and no separators are inserted inside the text group. Place the directive between ZGE parameter declarations to control where the text group appears in ZGameEditor:

```glsl
float ZGESize = 0.5;
float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;

// The generated text controls appear here.
// ZGETextOverlay: output=iChannel3 value=none format="{line}" position=scene

float ZGEEdgeWidth = 0.2;
float ZGEEdgeSoftness = 0.2;
```

The text controls are appended after all ZGE parameters when the directive appears after them. When the directive is near the shader header and before all ZGE declarations, the text controls appear first. Existing ZGE parameters retain their relative order in either case.

The generated text group contains:

- **Text line** selects a line supplied through FL Studio's **Add content > Text** feature.
- **Text value** supplies a manual numeric value from 0 to 1000.
- **Font** is a dynamic list of `.ttf` and `.zfo` fonts in the Visualizer HUD font directory.
- **Font size** uses a viewport-relative curve: `parameter² * viewport height`.
- **Row width** wraps text within a viewport-relative width; its maximum value disables wrapping.
- **Show guides** displays blue vertical lines at the active Row Width boundaries. Guides are hidden when Row Width is at its maximum and wrapping is disabled.
- **Horizontal align** selects left, center, or right alignment around the text position. Its default is center.
- **Font hue**, **Font saturation**, and **Font lightness** control the text color using HSL values from 0 to 1.
- **Text X** and **Text Y** position the overlay in normalized viewport coordinates. They are omitted when `position=scene` binds text placement to the shader's existing **Position X** and **Position Y** controls.

The text is drawn with NanoVG after the fullscreen shader, so it remains an overlay and is not part of the GLSL program.

## Options

Defaults can be supplied on the directive line:

```glsl
// ZGETextOverlay: value=timer format="{line}: {value}" size=0.12 font=0 hue=0.55 saturation=0.8 lightness=0.7 x=0.5 y=0.08
```

| Option | Accepted values | Default |
| --- | --- | --- |
| `value` | `manual`, `timer`, `random`, or `none` | `none` |
| `format` | Quoted text containing `{line}` and/or `{value}` | `{line}` |
| `size` | `0..1` | `0.1` |
| `rowwidth` | `0..1`; `1` disables wrapping | `1` |
| `font` | Normalized initial font selection, `0..1` | `0` |
| `hue` | `0..1` | `0` |
| `saturation` | `0..1` | `0` |
| `lightness` | `0..1` | `1` |
| `x` | `0..1` | `0.5` |
| `y` | `0..1` | `0.1` |
| `position` | `text` or `scene` | `scene` |
| `output` | `overlay` or `iChannel0` through `iChannel3` | `iChannel3` |
| `overlay` | `true` or `false`; also draw after the shader when using a channel | `false` |

Numeric options outside `0..1` are clamped. Unknown options and invalid modes produce converter warnings.

## Position modes

`position=text` creates the dedicated **Text X** and **Text Y** parameters and uses the `x` and `y` options as their defaults. This is the standard mode and keeps text placement independent of the shader's scene controls.

`position=scene` binds NanoVG text placement directly to the shader's existing `ZGEPositionX` and `ZGEPositionY` controls. In this mode:

- The converter does not create **Text X** or **Text Y** parameters.
- The `x` and `y` directive options are not used.
- The shader must declare both `float ZGEPositionX` and `float ZGEPositionY` parameters.
- Position is applied before NanoVG performs row wrapping and before the text render target is sampled by the shader.
- The GLSL should not apply `ZGEPositionX` or `ZGEPositionY` to the sampled text texture again, or placement will be applied twice and may crop the result.

Use `position=scene` when the shader's standard position controls should move the text itself:

```glsl
// ZGETextOverlay: output=iChannel3 value=none format="{line}" position=scene

float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;
```

## Value modes

- `manual` maps the **Text value** control to `0..1000`.
- `timer` displays elapsed project time in seconds.
- `random` generates a new value from 0 to 1000 once per second.
- `none` suppresses `{value}` automatically and omits the **Text value** control, so `format="{line}{value}"` displays only the selected line.

The `format` option supports `{line}`, `{value}`, and value placeholders such as `{value:0.0}`. ZGameEditor performs the final numeric conversion, so its native float formatting is used.

## Examples

Selected FL Studio text only:

```glsl
// ZGETextOverlay: value=none format="{line}" size=0.1 lightness=1 x=0.5 y=0.08
```

Timer label:

```glsl
// ZGETextOverlay: value=timer format="{line}: {value}" hue=0.12 saturation=0.9 lightness=0.6
```

Random number:

```glsl
// ZGETextOverlay: value=random format="RANDOM {value}" x=0.95 y=0.05
```

Set the generated **Horizontal align** parameter to Right for this example.

Scene-position controls without separate **Text X/Y** parameters:

```glsl
// ZGETextOverlay: output=iChannel3 value=none format="{line}" position=scene
```

If no text lines or fonts are available, the generated overlay safely remains blank. The underlying shader continues to render normally.

## Applying shader effects to text

Set `output` to an `iChannel` to render the text into a transparent, viewport-sized ZGameEditor `RenderTarget` before the fullscreen shader:

```glsl
// ZGETextOverlay: output=iChannel3 value=timer format="{value}" overlay=false
```

The selected channel is reserved for the text target. Its source row is shown automatically as **Text Render** and locked while the directive uses that channel. Sample it like any other Shadertoy channel:

```glsl
vec4 text = texture(iChannel3, fragCoord / iResolution.xy);
```

Use the texture alpha as a mask for glow, distortion, outlines, or compositing. Set `overlay=true` if the original unaffected text should also be drawn after the shader.
