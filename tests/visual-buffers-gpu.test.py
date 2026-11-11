"""Real OpenGL validation of converted visual passes. Requires moderngl and Node."""
import array
import json
from pathlib import Path
import subprocess
import zlib
import xml.etree.ElementTree as ET

import moderngl

ROOT = Path(__file__).resolve().parent.parent
cases = json.loads(subprocess.check_output(['node', '-e', r"""
const fs=require('fs');const {clock,twoBuffers,threeBuffers,convert,schedule}=require('./tests/visual-buffers.test.js');
(async()=>{
const cases=[];
for(const template of ['basic','basic_120','basic_130']) {
 for(const kind of ['clock','spatial','helpers','acrylic']) {
  const acrylic=kind==='acrylic';
  if(acrylic&&!fs.existsSync('samples/acrylic.txt'))continue;
  const xml=await convert(acrylic?fs.readFileSync('samples/acrylic.txt','utf8'):kind==='spatial'?twoBuffers:kind==='helpers'?threeBuffers:clock,template);
  const updates=[{dt:0.1},{dt:0.1},{dt:0.1},{dt:0},{dt:0.1,width:128},{dt:0.1,reset:true}];
  cases.push({xml,frames:schedule(xml,updates),acrylic,kind,template});
 }
}
process.stdout.write(JSON.stringify(cases));
})().catch(e=>{console.error(e);process.exitCode=1;});
"""], cwd=ROOT, text=True))
ctx = moderngl.create_standalone_context(require=210)
ctx.disable(moderngl.BLEND | moderngl.DEPTH_TEST)
vertex = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}'
vertices = ctx.buffer(array.array('f', [-1, -1, 1, -1, -1, 1, 1, 1]))
print('GPU:', ctx.info['GL_RENDERER'])

for case in cases:
    root = ET.fromstring(case['xml'])
    names = [n.attrib['Name'] for n in root.iter() if 'Name' in n.attrib]
    assert len(set(names)) == len(names), 'Duplicate ZGE component names'
    shaders = {s.attrib['Name']: s for s in root.iter('Shader')}
    materials = {m.attrib['Name']: m for m in root.iter('Material')}
    target_defs = {t.attrib['Name']: t for t in root.iter('RenderTarget')}
    parameters = array.array('f', zlib.decompress(bytes.fromhex(root.find(".//Array[@Name='Parameters']/Values").text.strip())))
    assert all(m.attrib['Shader'] in shaders for m in materials.values())
    programs = {}
    vaos = {}
    for name, shader in shaders.items():
        fragment = shader.findtext('FragmentShaderSource')
        # Compile the exact generated compatibility vertex shader too.
        ctx.program(vertex_shader=shader.findtext('VertexShaderSource'), fragment_shader=fragment).release()
        program = ctx.program(vertex_shader=vertex, fragment_shader=fragment)
        programs[name] = program
        vaos[name] = ctx.vertex_array(program, [(vertices, '2f', 'position')])
    targets = {}
    for name, definition in target_defs.items():
        tex = ctx.texture((int(definition.attrib['CustomWidth']), int(definition.attrib['CustomHeight'])), 1, dtype='f4')
        tex.filter = (moderngl.NEAREST, moderngl.NEAREST)
        tex.repeat_x = tex.repeat_y = False
        # Stale memory must be overwritten by generated initialization passes.
        tex.write(array.array('f', [999] * (tex.width * tex.height)))
        targets[name] = tex, ctx.framebuffer([tex])
    default_tex = ctx.texture((128, 36), 4, dtype='f4')
    default = ctx.framebuffer([default_tex])
    clock_values = []
    current_shader = None
    for frame_index, events in enumerate(case['frames']):
        for event in events:
            material = materials[event['material']]
            shader_name = material.attrib['Shader']
            program = programs[shader_name]
            target_name = event['target']
            # Apply actual runtime target dimensions, including viewport recreation.
            for reference, (texture, framebuffer) in list(targets.items()):
                dimensions = event['values'][reference]
                required = (int(dimensions['CustomWidth']), int(dimensions['CustomHeight']))
                if texture.size != required:
                    framebuffer.release()
                    texture.release()
                    texture = ctx.texture(required, 1, dtype='f4')
                    definition = target_defs[reference]
                    filtering = moderngl.NEAREST if definition.attrib['Filter'] == '1' else moderngl.LINEAR
                    texture.filter = (filtering, filtering)
                    texture.repeat_x = texture.repeat_y = False
                    targets[reference] = texture, ctx.framebuffer([texture])
            fbo = targets[target_name][1] if target_name else default
            fbo.use()
            size = event['values']['uResolution']
            ctx.viewport = (0, 0, fbo.width, fbo.height) if target_name else (0, 0, int(size['X']), int(size['Y']))
            for slot, texture in enumerate(material.findall('./Textures/MaterialTexture')):
                reference = texture.attrib['RenderTarget']
                assert reference != target_name, 'Reading and writing the same render target'
                targets[reference][0].use(slot)
                sampler = f'tex{slot+1}'
                if sampler in program:
                    program[sampler].value = slot
            # Mirror native EnableMaterial: uniforms are applied only when the
            # material changes shaders, not for every draw/material switch.
            bindings = shaders[shader_name].findall('./UniformVariables/ShaderVariable') if shader_name != current_shader else []
            current_shader = shader_name
            for binding in bindings:
                uniform = binding.attrib['VariableName']
                if uniform not in program:
                    continue
                if 'VariableRef' in binding.attrib:
                    value = event['values'][binding.attrib['VariableRef']]
                    if isinstance(value, dict):
                        value = tuple(value[k] for k in ('X', 'Y'))
                elif 'ValuePropRef' in binding.attrib:
                    reference = binding.attrib['ValuePropRef']
                    if reference.startswith('Parameters['):
                        index = int(reference.split('[')[1].split(']')[0])
                        value = parameters[index]
                    else:
                        value = float(event['values'][reference])
                    if uniform == 'ZGESpeed' and frame_index in (2, 3):
                        value = 0.0  # Speed zero must hold accumulated state.
                    elif uniform == 'ZGESpeed' and frame_index == 4:
                        value = 1.0  # Changing speed must preserve continuity.
                else:
                    raise AssertionError(binding.attrib)
                program[uniform].value = value
            vaos[shader_name].render(moderngl.TRIANGLE_STRIP)
        clock_values.append(array.array('f', targets['VisualBufferAcurrent0'][0].read())[0])
        image = array.array('f', default_tex.read())
        for reference, (texture, framebuffer) in targets.items():
            if 'previous' in reference:
                current = targets[reference.replace('previous', 'current')][0]
                assert texture.read() == current.read(), f'Copy changed spatial state in {reference}'
        assert all(v == v and abs(v) < 1e10 for v in image), 'Nonfinite output'
        if case['kind'] in ('spatial', 'helpers'):
            assert abs(image[0] - clock_values[-1]) < 1e-6
            assert image[3] == 12345, 'Seed/state alpha lost precision'
            packed_texture = targets['VisualBufferBcurrent0'][0]
            packed_values = array.array('f', packed_texture.read())
            logical_width, logical_height = packed_texture.width // 2, packed_texture.height // 2
            spatial = [packed_values[y * packed_texture.width + x + logical_width]
                       for y in range(logical_height) for x in range(logical_width)]
            assert max(spatial) - min(spatial) > 0.9, 'Spatial state collapsed to a constant'
            if case['kind'] == 'helpers':
                relief = targets['VisualBufferCcurrent0'][0]
                relief_values = array.array('f', relief.read())
                assert abs(relief_values[(relief.height // 2) * relief.width] - clock_values[-1]) < 1e-6
                assert relief_values[(relief.height // 2) * relief.width + relief.width // 2] == 12345
        elif not case['acrylic']:
            # All four components must survive signed/unbounded R32F storage.
            assert abs(image[0] - clock_values[-1]) < 1e-6
            assert list(image[1:4]) == [-2, 3, 1]
        else:
            assert max(image[0::4]) > 0.1, 'Acrylic rendered black'
    expected = [0.0, 0.02975, 0.02975, 0.02975, 0.11475, 0.0]
    assert all(abs(a-b) < 1e-6 for a, b in zip(clock_values, expected)), (clock_values, expected)
    print(f"PASS {case['template']} {case['kind']}: compile, feedback, speed, pause, resize, reset")
    for vao in vaos.values():
        vao.release()
    for program in programs.values():
        program.release()
    for tex, fbo in targets.values():
        fbo.release()
        tex.release()
    default.release()
    default_tex.release()

print('visual buffer GPU tests passed')
