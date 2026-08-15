# Text overlays

Add this comment near the top of a shader to render text over the converted scene:

```glsl
// ZGETextOverlay
```

The converter adds these ZGameEditor Visualizer parameters as one contiguous group after the shader's normal parameters. A separator is placed before **Text line**, and no separators are inserted inside the text group:

- **Text line** selects a line supplied through FL Studio's **Add content > Text** feature.
- **Text value** supplies a manual numeric value from 0 to 1000.
- **Font** is a dynamic list of `.ttf` and `.zfo` fonts in the Visualizer HUD font directory.
- **Font size** uses a viewport-relative curve: `parameter² * viewport height`.
- **Row width** wraps text within a viewport-relative width; its maximum value disables wrapping.
- **Font hue**, **Font saturation**, and **Font lightness** control the text color using HSL values from 0 to 1.
- **Text X** and **Text Y** position the overlay in normalized viewport coordinates.

The text is drawn with NanoVG after the fullscreen shader, so it remains an overlay and is not part of the GLSL program.

## Options

Defaults can be supplied on the directive line:

```glsl
// ZGETextOverlay: value=timer format="{line}: {value}" size=0.12 font=0 hue=0.55 saturation=0.8 lightness=0.7 x=0.5 y=0.08 align=center
```

| Option | Accepted values | Default |
| --- | --- | --- |
| `value` | `manual`, `timer`, `random`, or `none` | `manual` |
| `format` | Quoted text containing `{line}` and/or `{value}` | `{line}{value}` |
| `size` | `0..1` | `0.1` |
| `rowwidth` | `0..1`; `1` disables wrapping | `1` |
| `font` | Normalized initial font selection, `0..1` | `0` |
| `hue` | `0..1` | `0` |
| `saturation` | `0..1` | `0` |
| `lightness` | `0..1` | `1` |
| `x` | `0..1` | `0.5` |
| `y` | `0..1` | `0.1` |
| `align` | `left`, `center`, or `right` | `center` |
| `output` | `overlay` or `iChannel0` through `iChannel3` | `overlay` |
| `overlay` | `true` or `false`; also draw after the shader when using a channel | `false` |

Numeric options outside `0..1` are clamped. Unknown options and invalid modes produce converter warnings.

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
// ZGETextOverlay: value=random format="RANDOM {value}" align=right x=0.95 y=0.05
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
