"""Compile the actual tempo sample and render sprite selection at host beat positions."""
import array
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zlib

import moderngl

ROOT = Path(__file__).resolve().parent.parent
outputs = json.loads(subprocess.check_output(['node', '-e', r"""
const fs=require('fs');const {converter}=require('./tests/audio-input-conversion.test.js');
(async()=>{const outputs=[];for(const template of ['basic','basic_120','basic_130']){
 const e=converter();e.get('templateSelect').value=`templates/${template}.zgeproj`;
 e.get('inputCode').value=fs.readFileSync(fs.existsSync('samples/tempoanim.txt')?'samples/tempoanim.txt':'tests/fixtures/tempoanim.glsl','utf8');
 e.get('inputCode').listeners.input();e.get('ichannel0Source').value='bitmap1';
 await e.get('convertButton').listeners.click();outputs.push(e.get('outputCode').value);
}process.stdout.write(JSON.stringify(outputs));})().catch(e=>{console.error(e);process.exitCode=1;});
"""], cwd=ROOT, text=True))
ctx = moderngl.create_standalone_context(require=210)
pixels = ctx.texture((8, 2), 4, dtype='f4')
# Encode frame number in red; the sample's sheet starts at the top left.
pixels.write(array.array('f', [v for row in range(2) for col in range(8)
                              for v in ((8 * (1 - row) + col + 1) / 16, 0, 0, 1)]))
pixels.filter = (moderngl.NEAREST, moderngl.NEAREST)
pixels.use(0)
target = ctx.texture((1, 1), 4, dtype='f4')
framebuffer = ctx.framebuffer([target])
framebuffer.use()
vertices = ctx.buffer(array.array('f', [-1, -1, 1, -1, -1, 1, 1, 1]))
for xml in outputs:
    root = ET.fromstring(xml)
    shader = root.find(".//Shader[@Name='MainShader']")
    fragment = shader.findtext('FragmentShaderSource')
    ctx.program(vertex_shader=shader.findtext('VertexShaderSource'), fragment_shader=fragment).release()
    program = ctx.program(vertex_shader='attribute vec2 position;void main(){gl_Position=vec4(position,0,1);}', fragment_shader=fragment)
    vao = ctx.vertex_array(program, [(vertices, '2f', 'position')])
    params = array.array('f', zlib.decompress(bytes.fromhex(root.find(".//Array[@Name='Parameters']/Values").text.strip())))
    for binding in shader.findall('./UniformVariables/ShaderVariable'):
        name = binding.attrib['VariableName']
        if name.startswith('ZGE') and name in program:
            index = int(binding.attrib['ValuePropRef'].split('[')[1].split(']')[0])
            program[name].value = params[index]
    program['iResolution'].value = (1, 1)
    program['iViewport'].value = (0, 0)
    program['tex1'].value = 0
    program['iTime'].value = 0
    def render(beat):
        program['tempoHostBeats'].value = beat
        vao.render(moderngl.TRIANGLE_STRIP)
        return array.array('f', target.read())[0]
    # Includes backward seeks, loop restart, negative pre-roll, and repeated pause.
    for beat, expected in [(0, 1), (1, 9), (1.99, 16), (2, 0), (4, 1), (1, 9), (-1, 1), (1, 9), (1, 9)]:
        assert abs(render(beat) - expected / 16) < 1e-5, (beat, expected)
    # Independent mode still follows seconds, irrespective of host beats.
    program['ZGETempoSync'].value = 0
    program['iTime'].value = 0.5
    assert abs(render(100) - 7 / 16) < 1e-5
    assert abs(render(0) - 7 / 16) < 1e-5
    vao.release()
    program.release()
print('tempo GPU tests passed (all three templates)')
