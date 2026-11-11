# Persistent visual buffers

The modern and classic converter accept `// ZGEContainer: 1` files with Common,
one to four BufferA..BufferD sections, and Image. Each executable section has
its own mainImage; ZGE controls are declared once in Common and share the
existing parameter editor, labels and defaults.

This first implementation supports **visual-buffer inputs only**. It accepts
explicit `BufferA.previous` / `BufferA.current` connections (and B..D), fixed
target dimensions or `size=viewport`, RGBA32F/RGBA8 storage, nearest/linear
filtering, and clamp/repeat wrapping. Audio, host Feedback, Image Src, text and
internal bitmap inputs in containers are rejected with explanatory errors.
Ordinary single-pass shaders retain their existing channel/audio/text support.

Example pass metadata:

```text
// ZGEBegin: BufferA
// ZGETarget: size=1x1 format=RGBA32F filter=nearest wrap=clamp
// ZGEInitial: 0,0,0,1
// ZGEInput: iChannel0=BufferA.previous
```

Each pass reads textures using `texture(iChannelN, normalizedCoordinates)`.
Samplers may also be passed through GLSL helpers, including nested helpers in
Common. The converter lowers logical sampler arguments to channel identifiers
and dispatches their two-argument texture reads through the pass-local binding.
Texture-size queries, texelFetch, and texture reads with extra arguments are
not supported in containers. Shared helpers that reference channels currently require those
channels to be declared in every pass containing Common, even if a helper is
unused. General unused-helper dependency pruning is not implemented yet.

ZGE's public [renderer implementation](https://github.com/VilleKrumlinde/zgameeditor/blob/master/Renderer.pas)
provides R32F but no RGBA32F target. To preserve the contract, each logical
RGBA32F target uses one native R32F texture with four component quadrants. Its
physical width and height are twice the declared logical dimensions; iResolution
and mainImage coordinates remain logical. Shader texture reads reconstruct the
RGBA vector. Clamp sampling stays inside each component quadrant; linear repeat
sampling interpolates wrapped logical texels explicitly. No float-to-byte or
half-precision substitution occurs. RGBA8 uses one native RGBA target.

Each logical input now consumes one material texture binding. This supports the
three-input BufferC case without exceeding ZGE's eight automatic tex1..tex8
bindings. Packed dimensions must fit the GPU's maximum texture dimensions.

Both current and previous storage are initialized using fragment writes,
preserving signed and above-one initial float values. Buffer passes render in
declared order, Image follows, then current outputs are copied to previous
storage. Previous textures stay unchanged until all readers finish. Buffer
writes/copies disable blending and multisampling. Offscreen rendering temporarily
uses the full target viewport so the host display aspect ratio cannot clip packed
components; the original ratio is restored for Image and after copying. Image
retains normal host compositing. Each float buffer adds one write pass and one copy pass per frame;
the write pass evaluates the logical shader once for each component quadrant.
Use small targets for scalar/vector state such as Acrylic's clock.

iResolution is pass-local. iFrame starts at zero after initialization/reset;
iTimeDelta is zero on the first execution and otherwise max(App.DeltaTime, 0).
Pause behavior depends on the host providing zero animation delta when paused;
the converter does not infer transport state from wall-clock time. Graphics
context recreation resets visual state. Viewport targets reset on output-size
changes; fixed-size targets survive those changes.

The acrylic sample needs no manual channel dropdown selections: paste its full
container and convert. `samples/acrylic.zgeproj` is a generated test artifact,
when available locally. Reload the converter page after updating its files.

Validation:

```text
node tests/visual-buffers.test.js
python tests/visual-buffers-gpu.test.py
```

The GPU test requires moderngl and an OpenGL compatibility context. It compiles
the generated shaders for all three templates and renders the emitted pass
schedule, checking signed RGBA persistence, speed continuity, zero-speed hold,
zero-delta pause, fixed-target resizing and resets. If the local acrylic sample
exists, its shaders are compiled and rendered too. This does not replace an
end-to-end load test in the installed FL Studio/ZGE host.
