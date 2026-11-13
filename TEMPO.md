# Tempo synchronized animation

Use this metadata and fallback in a ShaderToy Image shader, or in the Common
section of a ZGEContainer:

```glsl
// ZGETempo: version=1 source=host fallbackBpm=120
float TempoBeats()
{
    return iTime * (120.0 / 60.0);
}
```

The AI creator must supply exactly one actual `float TempoBeats()` definition
alongside the directive. Its ShaderToy fallback returns elapsed quarter-note
beats at the declared preview BPM. Keep the BPM in the fallback consistent with
`fallbackBpm`: the metadata validates the contract, but does not rewrite the
ShaderToy preview expression. A bare `// ZGETempo` uses the options above.
Unsupported versions, sources, duplicate options, and invalid BPM values fail
conversion rather than silently retaining fixed-tempo playback.

The converter replaces this function with a read from an internal float uniform
bound to FL Studio Visualizer's `SongPositionInBeats` variable. This uses absolute
transport position, with negative positions clamped to zero. It does not
integrate BPM or frame time. No BPM slider, FFT analysis, or persistent audio
buffer is added. `iTime` and existing speed controls keep their existing behavior.
Do not declare `tempoHostBeats`; it is reserved for the converter.

Derive timing locally: `fract(TempoBeats())` repeats every beat,
`fract(TempoBeats() * 2.0)` every eighth note, and
`fract(TempoBeats() / 4.0)` every four beats. Keep trigger intervals, animation
duration, phase offsets, and pulse shaping in GLSL; they need no extra metadata.
Only add user controls when requested, using normalized `ZGE` float/bool values.
Four beats is one bar only in meters such as 4/4; this contract supplies no meter.

Shaders without the directive retain their original fallback. In standalone
ZGameEditor, no FL Studio host fills the beat variable, so the converted musical
clock stays at zero. Use ShaderToy for the fixed-BPM preview.

`samples/tempoanim.txt` is an example: its defaults trigger every four beats,
play sixteen sprite frames over two beats, then remain empty for two beats.
Select Image Src for `iChannel0` and supply the matching sprite sheet in FL Studio.
Host playback, pause, seek, looping, tempo automation, and offline video export
should be checked in FL Studio before release.
