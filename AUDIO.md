# Audio-Reactive Shader Guidelines

This project supports FFT spectrum input, raw PCM waveform input, and independent
converter-managed audio states, including complete spectrum history.

Shadertoy Demo: https://www.shadertoy.com/view/NfVGD1

## Instructions for use in Shadertoy

Use the following requirements whenever generating an audio-reactive shader:

Use `iChannel2` as an audio FFT spectrum texture.

Read spectrum amplitude from the red channel at `y = 0.0`:

```glsl
float amplitude = texture(iChannel2, vec2(frequency, 0.0)).r;
```

The `frequency` coordinate is normalized from `0.0` to `1.0`. Values near `0.0` represent lower-frequency bass bins, while values near `1.0` represent higher-frequency treble bins.

Use only the FFT spectrum row at `y = 0.0`. PCM waveform data is a separate
selectable source, described below; the converter does not emulate Shadertoy's
combined FFT/waveform texture.

Prefer averaging multiple nearby FFT samples when calculating broad bass, midrange, or treble energy. Avoid relying on a single FFT bin unless the visual specifically requires narrow-band behavior.

Clamp spectrum texture coordinates to the `0.0` to `1.0` range.

## Basic FFT lookup

Use a helper function to keep spectrum access consistent:

```glsl
float fft(float frequency)
{
    frequency = clamp(frequency, 0.0, 1.0);
    return texture(iChannel2, vec2(frequency, 0.0)).r;
}
```

## Semantic audio helpers

Shaders may use these conventional helper names:

```glsl
float AudioFFT(float frequency);    // current/raw FFT frame
float AudioBuffer1(float frequency); // persistent/processed FFT state #1
float AudioBuffer2(float frequency); // independent persistent state #2
```

The converter follows calls reachable from `mainImage()` or `main()`. Merely
declaring `AudioBuffer1()` does not allocate persistent state; calling it directly
or through other helpers does. When it is used, the generated project contains
an internal persistent array with the same numbered name. Every used positive
integer suffix receives an independent array, with no converter-defined maximum.
These arrays are not exposed as effect parameters and remain independent from
the raw `SpecBandArray`, so a shader can use all paths at once. The unnumbered
`AudioBuffer()` spelling remains supported for older inputs.

Each numbered helper must have integer mode and source declarations in the
original shader:

```glsl
int AudioBuffer1Mode = 1;
int AudioBuffer1Source = 0;
```

Source `0` reads raw FFT. A positive source reads that numbered buffer, and the
converter orders updates by these dependencies. Mode `0` copies its source into
independent persistent state. Mode `1` applies the reference attack/decay
envelope and requires `ZGEAttack` and `ZGEDecay`. Missing declarations,
dependency cycles, and unsupported modes are reported as conversion errors.

For independent attack/decay controls, bind each mode `1` buffer explicitly:

```glsl
// Buffer 1 uses ZGELoAttack / ZGELoDecay.
// Buffer 2 uses ZGEMidAttack / ZGEMidDecay.
// Buffer 3 uses ZGEHighAttack / ZGEHighDecay.
```

`// AudioBuffer1 uses ZGELoAttack / ZGELoDecay.` is also accepted. The named
parameters must exist. Each buffer receives its own coefficients with the same
normalized time mapping as the original controls (`1000 * control * control`
milliseconds). Buffers without a binding continue to use `ZGEAttack` and
`ZGEDecay`; buffer numbers do not imply a frequency band.

Mode `2` is peak decay: it rises immediately and falls linearly at the
`ZGEPeakDecay` rate. Mode `3` is trails decay: it rises immediately and falls
exponentially at the `ZGETrailDecay` rate. Both rates are evaluated per second
using ZGE's frame delta.

Mode `4` is accumulation: each frequency bin starts at zero and integrates
positive source values over elapsed seconds (`state += max(source, 0) * dt`).
The accumulated state does not wrap, decay, or clamp to `0..1`, so it can drive
continuous angular travel. It requires no additional parameters and may read
raw FFT or another numbered buffer, updated first according to its dependency.

### Complete mode reference

Mode numbers specify processing, not frequency bands. `AudioBuffer1` can use
any mode; its number identifies independent storage only. In the formulas below,
`input` is the selected source bin, `previous` is that buffer's previous value,
and `dt` is `App.DeltaTime` in seconds.

| Mode | Name | Behavior per frequency bin | Required controls |
| --- | --- | --- | --- |
| `0` | RAW / NONE | Copies `input` every update; no smoothing or history. | None |
| `1` | ATTACK_DECAY | Exponential envelope with separate rise and fall times. | `ZGEAttack`, `ZGEDecay`, or an explicit per-buffer binding above |
| `2` | PEAK_DECAY | `max(input, previous - rate * dt)`; immediate rise, linear fall. | `ZGEPeakDecay` |
| `3` | TRAILS_DECAY | `max(input, previous * exp(-rate * dt))`; immediate rise, exponential fall. | `ZGETrailDecay` |
| `4` | ACCUMULATE | `previous + max(input, 0) * dt`; unbounded positive energy integration. | None |
| `5` | HISTORY | Keeps the current source plus a circular history of complete source spectra. | None; optional internal history settings below |

Mode `1` maps each normalized time control to `1000 * control * control`
milliseconds. It uses the attack coefficient when `abs(input) > abs(previous)`
and decay otherwise. The coefficient is `exp(-1 / (fps * timeSeconds))`, using
the existing reference FPS clamped to `15..60`. A zero time gives immediate
response. The resulting state is `coefficient * (previous - input) + input`.

Modes `2` and `3` use their control values as per-second rates, respecting any
existing `Range:` mapping. Zero rate retains the previous peak until a higher
input arrives. Mode `2` falls at constant speed; mode `3` falls proportionally
and approaches zero gradually. They are not timed peak-hold modes. State is not
otherwise amplitude-clamped. Peak decay reaches zero with silent, nonnegative
FFT input because the current zero input provides its lower bound.

Mode `4` starts at zero and has no wrap, decay, or upper limit. It is useful for
continuous travel or rotation, and should not be treated as a normalized audio
envelope. Modes `0..4` each retain only one spectrum, not a sequence of spectra.

Every numbered buffer requires its actual global `int AudioBufferXMode` and
`int AudioBufferXSource` declarations. Source `0` is raw `SpecBandArray`; positive
sources refer to numbered buffers. Dependencies update before their consumers;
cycles, missing declarations, invalid settings, and unknown modes are errors.
The legacy unnumbered `AudioBuffer()` retains mode `1` behavior with the global
attack/decay controls when present (immediate response when absent).

### Mode 5: complete spectrum history

Mode `5` records every frequency bin in the chosen source, preserving separate
snapshots rather than fading or scaling the current spectrum. Source `0` records
raw FFT; another source records that buffer's processed spectrum. It remains
independent of the iChannel dropdowns, including a PCM selection for `iChannel2`.

Optional **internal converter metadata** configures capacity and capture interval:

```glsl
int AudioBuffer1Mode = 5;
int AudioBuffer1Source = 0;
int AudioBuffer1HistoryFrames = 128;
float AudioBuffer1HistoryInterval = 0.033333333;
```

These are fixed settings, not user controls. `HistoryFrames` defaults to `128`
and accepts an integer literal from `2` to `2048`. `HistoryInterval` defaults to
`1/30` second and accepts a float literal from `0.001` to `60` seconds. Use a
numeric literal such as `0.1`, not a GLSL expression such as `1.0 / 10.0`.
Each history buffer can use different settings. No extra ZGE sliders are added.

Declare the history helper in the ShaderToy source with two `float` arguments:

```glsl
float AudioBuffer1(float freq, float age)
{
    return AudioFFT(freq);
}
```

The fallback intentionally shows current raw FFT in ShaderToy, keeping the shader
single-pass. After conversion the second argument selects a recorded snapshot:

| Age | Snapshot |
| --- | --- |
| `0.0` | Newest recorded spectrum |
| `1.0` | Previous recorded spectrum |
| `2.0` | Two captures before the newest |
| `127.0` | Oldest retained spectrum with the default capacity |

Age is a **snapshot index**, not seconds or a normalized coordinate. It is rounded
to the nearest integer and clamped to `0..HistoryFrames-1`. Frequency is clamped
to `0..1`. Unrecorded ages return zero during startup and after a reset. Age
selection uses row centers so adjacent snapshots are not blended. For a scrolling
spectrogram, map one screen coordinate to frequency and the other to age; average
the usual eight frequency samples at the same age when displaying frequency bands.

You may also declare the existing one-argument overload, falling back to
`AudioFFT(freq)` in ShaderToy. After conversion, `AudioBuffer1(freq)` reads the
current source every update; `AudioBuffer1(freq, 0.0)` reads the latest captured
snapshot, which may be slightly older. If another numbered buffer sources a
history buffer, it receives this current one-dimensional view.

The first nonempty spectrum is captured immediately. Further captures occur on
updates after at least `HistoryInterval` seconds have elapsed, at most once per
update. Paused elapsed time does not advance history. Actual capture rate is
limited by rendering, and the interval timer restarts after each capture. A long
stall records one actual spectrum when updates resume; missed spectra are not
reconstructed or filled with duplicates. Ages therefore indicate capture order,
not guaranteed exact timestamps. At a steady 30 captures/second, 128 rows cover
about 4.2 seconds from newest to oldest.

The ring overwrites the oldest snapshot when full. Changing the host FFT bin
count clears the valid-history count and starts fresh; old incompatible spectra
are not exposed. Empty input records nothing. Each effect instance and numbered
history buffer owns its own data. Loading a new instance starts empty.

Storage uses two R32F floating-point render targets (frequency bins × history
capacity), plus a current-spectrum array and internal head/count/clock state.
Captures write one target while reading the other, then copy the result back;
the effect never samples from the target it is writing. At 512 bins × 128
snapshots, the two targets' color data requires 512 KiB, before depth buffers,
multisampling, and other overhead. Capturing adds two fullscreen passes at the
history resolution. Targets use nearest filtering and preserve signed float
values without an intentional `0..1` clamp or byte quantization.

Both dimensions must fit the GPU's texture limits. Lower capacity/longer intervals
can reduce resource use; no frequency bins are deliberately discarded. History
has an internal material texture binding without consuming a user iChannel.
GPU context recreation resets the valid history. This uses ZGE's native
[render target support](https://github.com/VilleKrumlinde/zgameeditor/blob/master/Renderer.pas),
whose R32F format is required for mode `5`. The converter cannot use a
multidimensional `ValueArrayRef` texture for history: ZGE flattens it to one row.

To verify the converter, run each `tests/*.test.js` file with Node.js. The optional
`python tests/audio-history-gpu.test.py` check requires `moderngl` and an OpenGL
context; it compiles all converted history shaders and exercises the write,
copy, and age-read passes on real floating-point textures.

### Audio buffers are implemented by ZGE

The persistent behavior of `AudioBuffer1()`, `AudioBuffer2()`, and subsequent
numbered helpers exists only in the converted ZGE project. A normal ShaderToy
Image fragment shader cannot maintain a mutable FFT array between frames:
ordinary GLSL fragment invocations do not share writable global state, and
values created during one frame do not automatically persist into the next.

For this reason, the ShaderToy versions of the numbered helpers are only
fallbacks. They commonly return `AudioFFT(frequency)` so the Image shader remains
self-contained and produces a useful preview, but they do not provide attack,
decay, peak hold, trails, or other persistent processing in ShaderToy.

During conversion, the helper names are treated as semantic markers. The
converter replaces their fallback behavior with reads from persistent ZGE
arrays, and ZGE updates those arrays once per frame according to each buffer's
mode and source declarations. This persistent state is outside GLSL and is why
the converted effect can implement behavior that the standalone Image shader
cannot.

ShaderToy can implement cross-frame state through separate Buffer passes and
feedback textures, but those are a different mechanism and are intentionally
not used by this convention or by the converter's ZGE audio buffers.

Numbered mode `1` buffers require both time controls (or their explicitly bound
equivalents). Other modes use only the controls listed in the mode reference.

The converter automatically changes `texture()` calls to `texture2D()` when required for ZGameEditor compatibility.

## Reading frequency ranges

Broad frequency energy should be calculated by averaging several samples:

```glsl
float fftRange(float from, float to)
{
    const int SAMPLE_COUNT = 8;
    float energy = 0.0;

    for (int i = 0; i < SAMPLE_COUNT; i++)
    {
        float position = (float(i) + 0.5) / float(SAMPLE_COUNT);
        float frequency = mix(from, to, position);
        energy += fft(frequency);
    }

    return energy / float(SAMPLE_COUNT);
}
```

Example broad-band values:

```glsl
float bass   = fftRange(0.00, 0.08);
float mids   = fftRange(0.08, 0.35);
float treble = fftRange(0.35, 0.80);
```

These ranges are visual starting points rather than exact acoustic frequency divisions. The FFT texture coordinate represents a position within the spectrum supplied by the host.

## Scaling the audio values

Raw FFT values may be too small or uneven for direct visual use. Apply gain and a response curve appropriate to the effect:

```glsl
bass   = smoothstep(0.05, 0.35, bass);
mids   = smoothstep(0.03, 0.25, mids);
treble = smoothstep(0.01, 0.15, treble);
```

Another useful response curve is:

```glsl
float response(float value, float gain)
{
    return 1.0 - exp(-max(value, 0.0) * gain);
}
```

For example:

```glsl
bass   = response(bass, 5.0);
mids   = response(mids, 7.0);
treble = response(treble, 10.0);
```

Avoid assuming that all songs, mixer tracks, or host spectrum settings produce identical amplitude ranges.

## Complete minimal example

```glsl
float fft(float frequency)
{
    return texture(iChannel2, vec2(clamp(frequency, 0.0, 1.0), 0.0)).r;
}

float fftRange(float from, float to)
{
    const int SAMPLE_COUNT = 8;
    float energy = 0.0;

    for (int i = 0; i < SAMPLE_COUNT; i++)
    {
        float position = (float(i) + 0.5) / float(SAMPLE_COUNT);
        energy += fft(mix(from, to, position));
    }

    return energy / float(SAMPLE_COUNT);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    float bass = fftRange(0.00, 0.08);
    float mids = fftRange(0.08, 0.35);
    float treble = fftRange(0.35, 0.80);

    bass = 1.0 - exp(-max(bass, 0.0) * 5.0);
    mids = 1.0 - exp(-max(mids, 0.0) * 7.0);
    treble = 1.0 - exp(-max(treble, 0.0) * 10.0);

    float radius = 0.25 + bass * 0.12;
    float ring = 0.015 / max(abs(length(uv) - radius), 0.001);

    vec3 color = vec3(
        ring * (0.3 + bass),
        ring * (0.2 + mids),
        ring * (0.4 + treble)
    );

    fragColor = vec4(color, 1.0);
}
```

## Converting the shader

1. Paste the Shadertoy code into the converter.
2. Select **Audio Spectrum (FFT)** as the source for `iChannel2`.
3. Convert and download the `.zgeproj` file.
4. Load the project as an effect in FL Studio's ZGameEditor Visualizer.
5. Play audio routed through the relevant FL Studio mixer path.

The generated project declares an array named `SpecBandArray`. FL Studio populates this array at runtime, and ZGameEditor exposes it to the shader as the selected `iChannel`.

## Raw waveform / PCM input

Choose **AudioArray (Waveform / PCM)** in an iChannel Source dropdown to bind
FL Studio's host-populated `AudioArray` directly to that shader channel. This
can be selected for `iChannel2` when a waveform shader is needed instead of the
usual FFT input. Both converter pages offer the same source options.

Read the red component at `y = 0.0`, with normalized horizontal coordinates
across the array. Values are signed PCM samples, normally `-1..1`, with silence
at zero. Stereo samples are interleaved in the original one-dimensional host
array; they are not split into separate texture rows or color components.
The host determines the array length at runtime.

This is raw host data, not Shadertoy's combined audio texture: no FFT row,
waveform row at `y = 1.0`, or automatic conversion to a `0..1` waveform is added.
Existing Shadertoy waveform shaders may need their sampling logic adapted.
`AudioFFT()` and numbered `AudioBufferX()` helpers continue to use FFT data
independently of the selected waveform channel.

## Current limitations

- Each channel selects either FFT or PCM; a combined Shadertoy audio texture is not provided.
- Audio input depends on FL Studio's ZGameEditor Visualizer host. Standalone ZGameEditor does not populate `SpecBandArray` or `AudioArray`.
- The number and precision of available spectrum bands can depend on the host's spectrogram and FFT settings.
- Persistent processing is requested through numbered buffer Mode/Source metadata; ordinary channel FFT reads remain current-frame data.
