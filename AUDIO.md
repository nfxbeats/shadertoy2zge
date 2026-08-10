# Audio-Reactive Shader Guidelines

This project supports audio-reactive Shadertoy shaders by exposing FL Studio's FFT spectrum data through a Shadertoy-style input channel.

Shadertoy Demo: https://www.shadertoy.com/view/NfVGD1

## Instructions for use in Shadertoy

Use the following requirements whenever generating an audio-reactive shader:

Use `iChannel2` as an audio FFT spectrum texture.

Read spectrum amplitude from the red channel at `y = 0.0`:

```glsl
float amplitude = texture(iChannel2, vec2(frequency, 0.0)).r;
```

The `frequency` coordinate is normalized from `0.0` to `1.0`. Values near `0.0` represent lower-frequency bass bins, while values near `1.0` represent higher-frequency treble bins.

Use only the FFT spectrum row at `y = 0.0`. Do not read the Shadertoy waveform row at `y = 1.0`, because the ZGameEditor converter does not currently provide waveform data.

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
const int AudioBuffer1Mode = 1;
const int AudioBuffer1Source = 0;
```

Source `0` reads raw FFT. A positive source reads that numbered buffer, and the
converter orders updates by these dependencies. Mode `0` copies its source into
independent persistent state. Mode `1` applies the reference attack/decay
envelope and requires `ZGEAttack` and `ZGEDecay`. Missing declarations,
dependency cycles, and unsupported modes are reported as conversion errors.

Mode `2` is peak decay: it rises immediately and falls linearly at the
`ZGEPeakDecay` rate. Mode `3` is trails decay: it rises immediately and falls
exponentially at the `ZGETrailDecay` rate. Both rates are evaluated per second
using ZGE's frame delta.

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

If `ZGEAttack` and/or `ZGEDecay` parameters are declared, they configure the
buffer's attack/release envelope using the reference ZGE behavior. Without those
parameters the buffer still exists and tracks the current spectrum, retaining a
separate stateful path for other processing modes.

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

## Current limitations

- Only FFT spectrum data is provided.
- Shadertoy's waveform row is not available.
- Audio input depends on FL Studio's ZGameEditor Visualizer host. Standalone ZGameEditor does not populate `SpecBandArray`.
- The number and precision of available spectrum bands can depend on the host's spectrogram and FFT settings.
- Temporal attack, release, and smoothing are not automatically added by the converter. A shader samples the current spectrum frame unless smoothing is implemented separately.
