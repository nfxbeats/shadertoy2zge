"""Optional real-OpenGL history test. Requires Python moderngl and Node.js."""
import array
import json
from pathlib import Path
import re
import subprocess

import moderngl


root = Path(__file__).resolve().parent.parent
resources = json.loads(subprocess.check_output([
    "node", "-e",
    "process.stdout.write(JSON.stringify(require('./audio-analysis.js').buildAudioHistoryResources("
    "[{id:'1',mode:5,source:0,historyFrames:3}])));",
], cwd=root, text=True))
shaders = re.findall(
    r'<VertexShaderSource><!\[CDATA\[(.*?)\]\]></VertexShaderSource>'
    r'<FragmentShaderSource><!\[CDATA\[(.*?)\]\]></FragmentShaderSource>',
    resources["content"], re.S,
)
assert len(shaders) == 2
ctx = moderngl.create_standalone_context(require=210)
# Compile actual converted shaders, including the history helper and sampler
# bindings, with every shipped template. No manual channel selection is needed
# for a shader that only uses semantic FFT history helpers.
converted = json.loads(subprocess.check_output(["node", "-e", r"""
const {converter}=require('./tests/audio-input-conversion.test.js');
(async()=>{
const result=[];
for(const template of ['basic','basic_120','basic_130']) {
 const elements=converter();
 elements.get('templateSelect').value=`templates/${template}.zgeproj`;
 elements.get('inputCode').value=`// Title: GPU history test
// Author: NFX
float ZGESize=0.5;
float ZGEPositionX=0.5;
float ZGEPositionY=0.5;
float ZGEAge=0.0;
int AudioBuffer1Mode=5;
int AudioBuffer1Source=0;
int AudioBuffer1HistoryFrames=3;
float AudioFFT(float freq){return texture(iChannel2,vec2(freq,0.0)).r;}
float AudioBuffer1(float freq,float age){return AudioFFT(freq);}
void mainImage(out vec4 color,in vec2 pixel){color=vec4(AudioBuffer1(pixel.x/iResolution.x,ZGEAge*2.0),0.0,0.0,1.0);}`;
 elements.get('inputCode').listeners.input();
 await elements.get('convertButton').listeners.click();
 result.push(elements.get('outputCode').value);
}
process.stdout.write(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
"""], cwd=root, text=True))
main_programs = []
for project in converted:
    main = re.search(r'<Shader Name="MainShader"[^>]*>(.*?)</Shader>', project, re.S)[1]
    vertex_source = re.search(r'<VertexShaderSource>\s*<!\[CDATA\[(.*?)\]\]>', main, re.S)[1]
    fragment_source = re.search(r'<FragmentShaderSource>\s*<!\[CDATA\[(.*?)\]\]>', main, re.S)[1]
    main_programs.append(ctx.program(vertex_shader=vertex_source, fragment_shader=fragment_source))
# Compile the generated compatibility vertex shaders as well as both fragments.
for vertex, fragment in shaders:
    ctx.program(vertex_shader=vertex, fragment_shader=fragment).release()
# Use explicit vertex attributes for the test harness's fullscreen triangles.
vertex = "attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}"
write, copy = [ctx.program(vertex_shader=vertex, fragment_shader=fragment) for _, fragment in shaders]
vertices = ctx.buffer(array.array("f", [-1, -1, 1, -1, -1, 1, 1, 1]))
write_vao = ctx.vertex_array(write, [(vertices, "2f", "position")])
copy_vao = ctx.vertex_array(copy, [(vertices, "2f", "position")])
main_fragment = re.search(r'<FragmentShaderSource>\s*<!\[CDATA\[(.*?)\]\]>',
                          re.search(r'<Shader Name="MainShader"[^>]*>(.*?)</Shader>', converted[0], re.S)[1], re.S)[1]
read_program = ctx.program(vertex_shader=vertex, fragment_shader=main_fragment)
read_vao = ctx.vertex_array(read_program, [(vertices, "2f", "position")])
ctx.disable(moderngl.BLEND | moderngl.DEPTH_TEST)


def exercise(bins):
    targets = [ctx.texture((bins, 3), 1, dtype="f4") for _ in range(2)]
    fbos = [ctx.framebuffer([texture]) for texture in targets]
    current = ctx.texture((bins, 1), 1, dtype="f4")
    for texture in [*targets, current]:
        texture.filter = (moderngl.NEAREST, moderngl.NEAREST)
        texture.repeat_x = texture.repeat_y = False
    # Deliberately seed stale contents; the first capture must hide/clear them.
    for target in targets:
        target.write(array.array("f", [999] * (bins * 3)))
    expected = [0] * (bins * 3)
    head = 0
    for capture in range(1, 8):
        head = (head + 1) % 3
        # Signed values and values above one must survive R32F storage unchanged.
        values = [(-1 if bin_index % 2 else 1) * (capture + bin_index / 4) for bin_index in range(bins)]
        current.write(array.array("f", values))
        current.use(1)
        targets[1].use(0)
        write["currentSpectrum"].value = 1
        write["tex1"].value = 0
        write["historyHead"].value = head
        write["historyCount"].value = min(capture, 3)
        write["historyBins"].value = bins
        fbos[0].use()
        ctx.viewport = (0, 0, bins, 3)
        write_vao.render(moderngl.TRIANGLE_STRIP)
        targets[0].use(0)
        copy["tex1"].value = 0
        copy["historyBins"].value = bins
        fbos[1].use()
        copy_vao.render(moderngl.TRIANGLE_STRIP)
        expected[head * bins:(head + 1) * bins] = values
        for target in targets:
            actual = array.array("f")
            actual.frombytes(target.read())
            assert list(actual) == expected, (bins, capture, list(actual), expected)
        # Exercise the actual converted age helper on the GPU, including cold
        # history (unrecorded ages must return zero) and circular wraparound.
        output_texture = ctx.texture((bins, 1), 1, dtype="f4")
        output_fbo = ctx.framebuffer([output_texture])
        output_fbo.use()
        ctx.viewport = (0, 0, bins, 1)
        targets[0].use(0)
        read_program["tex1"].value = 0
        read_program["iResolution"].value = (bins, 1)
        read_program["iViewport"].value = (0, 0)
        read_program["AudioBuffer1HistoryHead"].value = head
        read_program["AudioBuffer1HistoryCount"].value = min(capture, 3)
        for age in range(3):
            read_program["ZGEAge"].value = age / 2
            read_vao.render(moderngl.TRIANGLE_STRIP)
            actual = array.array("f")
            actual.frombytes(output_texture.read())
            row = (head - age + 3) % 3
            expected_row = expected[row * bins:(row + 1) * bins] if age < min(capture, 3) else [0] * bins
            assert list(actual) == expected_row, (bins, capture, age)
        output_fbo.release()
        output_texture.release()
    for resource in [*fbos, *targets, current]:
        resource.release()


for bins in [1, 4, 128, 512]:
    exercise(bins)
print("audio history GPU tests passed on", ctx.info["GL_RENDERER"])
