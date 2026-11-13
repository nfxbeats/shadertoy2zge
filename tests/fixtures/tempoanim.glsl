// Title: Explosion Sprite Sheet Player
// Author: NFX
// Comment: Plays a 16-frame sprite sheet arranged in 8 columns and 2 rows.
// ZGETempo: version=1 source=host fallbackBpm=120

float ZGESize = 0.5; // Scene settings @separator
float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;

float ZGEPlaybackSpeed = 0.5; // Playback settings @separator
float ZGELoopDelay = 0.1;
float ZGEHeldFrame = 0.0; // 0 = empty; higher values select frames 1–16.

bool ZGETempoSync = true; // Tempo synchronization @separator
float ZGETriggerInterval = 0.333333333; // @list: "1 beat", "2 beats", "4 beats (1 bar)", "8 beats (2 bars)", "16 beats (4 bars)", "32 beats (8 bars)"
float ZGEAnimationBeats = 0.125; // Duration: max(0.25, control * 16) quarter-note beats.

float TempoBeats()
{
    return iTime * (120.0 / 60.0);
}

int listIndex(float value, int itemCount)
{
    if (itemCount <= 1) return 0;

    int idx = int(floor(value * float(itemCount) + 0.5));

    return clamp(idx, 0, itemCount - 1);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float sizeCtrl = clamp(ZGESize, 0.0, 1.0);
    float positionXCtrl = clamp(ZGEPositionX, 0.0, 1.0);
    float positionYCtrl = clamp(ZGEPositionY, 0.0, 1.0);
    float playbackSpeedCtrl = clamp(ZGEPlaybackSpeed, 0.0, 1.0);
    float loopDelayCtrl = clamp(ZGELoopDelay, 0.0, 1.0);
    float heldFrameCtrl = clamp(ZGEHeldFrame, 0.0, 1.0);
    float tempoSync = ZGETempoSync ? 1.0 : 0.0;
    float triggerIntervalCtrl = clamp(ZGETriggerInterval, 0.0, 1.0);
    float animationBeatsCtrl = clamp(ZGEAnimationBeats, 0.0, 1.0);

    // Independent playback speed: 3 to 48 FPS, with 12 FPS at the default.
    float framesPerSecond = 12.0 * exp2(
        (playbackSpeedCtrl - 0.5) * 4.0
    );

    // Independent post-animation pause: 0 to 10 seconds.
    float loopDelaySeconds = loopDelayCtrl * 10.0;

    const float columns = 8.0;
    const float rows = 2.0;
    const float frameCount = 16.0;

    // Approximate width / height of an individual frame in this sheet.
    // This is an artwork setting, not a query of the source texture size.
    const float frameAspect = 1.333333333;

    float viewportAspect = iResolution.x / iResolution.y;
    float sceneScale = exp2((sizeCtrl - 0.5) * 4.0);

    vec2 position = vec2(
        (positionXCtrl - 0.5) * viewportAspect,
        positionYCtrl - 0.5
    );

    // Coordinates measured relative to the output height.
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    p = (p - position) / sceneScale;

    vec2 frameUV = vec2(p.x / frameAspect, p.y) + 0.5;

    // Keep the rest of the output black.
    if (frameUV.x < 0.0 || frameUV.x > 1.0 ||
        frameUV.y < 0.0 || frameUV.y > 1.0)
    {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float frame = 0.0;
    bool postPlayback = false;

    if (tempoSync > 0.5)
    {
        int intervalIdx = listIndex(triggerIntervalCtrl, 6);

        // Trigger intervals: 1, 2, 4, 8, 16, or 32 quarter-note beats.
        // Bar labels assume 4/4 time.
        float triggerBeats = exp2(float(intervalIdx));
        float animationBeats = max(0.25, animationBeatsCtrl * 16.0);

        float beats = TempoBeats();
        float cycleBeat = mod(beats, triggerBeats);

        frame = min(
            floor((cycleBeat / animationBeats) * frameCount),
            frameCount - 1.0
        );

        postPlayback = cycleBeat >= animationBeats;

        // If animation duration exceeds the trigger interval,
        // each new trigger restarts the animation before it finishes.
    }
    else
    {
        float animationDuration = frameCount / framesPerSecond;
        float cycleDuration = animationDuration + loopDelaySeconds;
        float cycleTime = mod(max(iTime, 0.0), cycleDuration);

        frame = min(
            floor(cycleTime * framesPerSecond),
            frameCount - 1.0
        );

        postPlayback = cycleTime >= animationDuration;
    }

    // Quantized selection: 0 = empty, 1–16 = sprite frame.
    int heldFrame = int(floor(heldFrameCtrl * frameCount + 0.5));

    if (postPlayback)
    {
        if (heldFrame == 0)
        {
            fragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }

        frame = float(heldFrame - 1);
    }

    float column = mod(frame, columns);
    float rowFromTop = floor(frame / columns);

    // Small inset helps prevent filtering into neighboring cells.
    vec2 cellUV = mix(vec2(0.001), vec2(0.999), frameUV);

    // Standard ShaderToy UV convention: texture bottom is y = 0.
    vec2 sheetUV = (
        vec2(column, rows - 1.0 - rowFromTop) + cellUV
    ) / vec2(columns, rows);

    vec4 sprite = texture(iChannel0, sheetUV);

    // Display both opaque and transparent sheets over black.
    fragColor = vec4(sprite.rgb * sprite.a, 1.0);
}