// Title: Simple Shapes
// Author: NFX

float ZGESize = 0.5;
float ZGEPositionX = 0.5;
float ZGEPositionY = 0.5;
float ZGEShape = 0.0; // @list: "Triangle", "Square", "Circle" @separator
bool ZGEOutline = false;

// Convert normalized list value [0..1] to stable index [0..N-1]
int listIndex(float value, int itemCount) {
    if (itemCount <= 1) return 0;
    int idx = int(floor(value * float(itemCount) + 0.5));
    return clamp(idx, 0, itemCount - 1);
}

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdTriangle(vec2 p, float r) {
    p.y += r * 0.25; 
    return max(abs(p.x)*0.866025 + p.y*0.5, -p.y) - r*0.5;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // Coordinate mapping and position application
    vec2 uv = fragCoord / iResolution.xy;
    uv -= vec2(ZGEPositionX, ZGEPositionY);
    uv.x *= iResolution.x / iResolution.y;
    
    // Scale derived from ZGESize 
    float realSize = max(0.001, ZGESize * 2.0);
    uv /= realSize;

    // Convert normalized shape float to index
    int shapeIdx = listIndex(ZGEShape, 3);
    
    // Calculate signed distance for selected shape
    float d = 0.0;
    if (shapeIdx == 0) { // Triangle
        d = sdTriangle(uv, 0.3);
    } else if (shapeIdx == 1) { // Square
        d = sdBox(uv, vec2(0.25));
    } else { // Circle
        d = sdCircle(uv, 0.3);
    }

    // Required boolean conversion logic
    float isOutline = ZGEOutline ? 1.0 : 0.0;
    
    // Determine screen-space smoothing for anti-aliasing
    float sm = 1.5 / iResolution.y / realSize;
    float mask = 0.0;
    
    if (isOutline > 0.5) {
        // Make it a thin outline
        float thickness = 0.02;
        mask = smoothstep(sm, -sm, abs(d) - thickness);
    } else {
        // Filled shape
        mask = smoothstep(sm, -sm, d);
    }
    
    // Output final mask as white color
    fragColor = vec4(vec3(mask), 1.0);
}