"""程序化生成浮岛资产（Blender headless）
运行：blender --background --python build_assets.py
输出：_assets/*.glb + manifest.json
"""
import bpy, math, os, json, random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_assets")
os.makedirs(OUT, exist_ok=True)

# ---------- 调色板 ----------
def srgb(c):
    def f(u):
        u /= 255.0
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
    return (f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255))

PALETTES = [
    dict(top=0xFDF6E7, side=0xE6D5BC, wall=0xF3E4CB, roof=0xC97B6B, tree=0x7E9A76, accent=0x6FA8B8, trunk=0x8A6A4E),
    dict(top=0xF6EFE3, side=0xDDD2C2, wall=0xF1E6D4, roof=0x7E8FA8, tree=0x6E8C6A, accent=0xC98A5E, trunk=0x84674C),
    dict(top=0xFBF1E4, side=0xE3CCB6, wall=0xF6E7D2, roof=0xA76B6B, tree=0x8A9C6E, accent=0x8E7BB0, trunk=0x8E6B4F),
    dict(top=0xF4F1E6, side=0xD9D6C4, wall=0xEFEAD8, roof=0x6E8C83, tree=0x7C9468, accent=0xC9A05B, trunk=0x7E6448),
    dict(top=0xFDF3E2, side=0xE0CBB0, wall=0xF5E5CD, roof=0xB0805A, tree=0x7A936B, accent=0x6B8FA8, trunk=0x8A6B4C),
    dict(top=0xF7F2EA, side=0xDED4C6, wall=0xF2E9DA, roof=0x8A7080, tree=0x82966E, accent=0xA88A5E, trunk=0x7A6048),
]

NODES = [
    ("rag", 2, "library"), ("retrieval", 3, "beacon"), ("vectordb", 2, "crystals"),
    ("embedding", 3, "crystal_tower"), ("chunking", 1, "mill"), ("bm25", 1, "well"),
    ("docparse", 1, "book_tower"), ("clean", 1, "pond"), ("kg", 1, "big_tree"),
    ("generation", 2, "fountain"), ("hallucination", 1, "crooked_tower"), ("ctx", 2, "gate_arch"),
    ("prompt", 1, "monolith"), ("eval", 2, "balance"), ("recall", 1, "lighthouse"),
    ("qa", 2, "clock_tower"), ("finetune", 1, "workshop"), ("agent", 2, "castle"),
    ("workflow", 1, "waterwheel"), ("multimodal", 1, "twin_towers"), ("longctx", 1, "arcade"),
]

MATS = {}
def M(key, pal):
    name = "m_%s_%d" % (key, pal)
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*srgb(PALETTES[pal][key]), 1.0)
    b.inputs["Roughness"].default_value = 0.92
    MATS[name] = m
    return m

def reset():
    MATS.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)

def box(size, loc=(0,0,0), rot=(0,0,0), bevel=0.02, mat=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        md = o.modifiers.new("b", "BEVEL"); md.width = bevel; md.segments = 2
        bpy.ops.object.modifier_apply(modifier=md.name)
    if mat: o.data.materials.append(mat)
    return o

def cyl(r1, r2, h, loc=(0,0,0), rot=(0,0,0), verts=10, mat=None, bevel=0.01):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.object
    if bevel > 0:
        md = o.modifiers.new("b", "BEVEL"); md.width = bevel; md.segments = 1
        bpy.ops.object.modifier_apply(modifier=md.name)
    if mat: o.data.materials.append(mat)
    return o

def ico(r, loc=(0,0,0), sub=1, mat=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = bpy.context.object
    if mat: o.data.materials.append(mat)
    return o

def cone(r, h, loc=(0,0,0), rot=(0,0,0), verts=8, mat=None, bevel=0.005):
    return cyl(r, 0.0, h, loc=loc, rot=rot, verts=verts, mat=mat, bevel=bevel)

def tree(pal, loc, s=1.0):
    t = M("trunk", pal); g = M("tree", pal)
    cyl(0.045*s, 0.06*s, 0.34*s, loc=(loc[0], loc[1], loc[2]+0.17*s), verts=6, mat=t, bevel=0)
    for i in range(3):
        cone((0.26-i*0.055)*s, 0.30*s, loc=(loc[0], loc[1], loc[2]+(0.36+i*0.18)*s), verts=7, mat=g, bevel=0.005)

def rock(pal, loc, s=1.0):
    ico(0.14*s, loc=loc, sub=1, mat=M("side", pal))

def lan(pal, loc, s=1.0):
    cyl(0.018*s, 0.018*s, 0.42*s, loc=(loc[0], loc[1], loc[2]+0.21*s), verts=6, mat=M("trunk", pal), bevel=0)
    ico(0.055*s, loc=(loc[0], loc[1], loc[2]+0.46*s), sub=1, mat=M("accent", pal))

# ---------- 地标 ----------
def lm_library(pal, z):
    parts = []
    parts.append(box((1.0, 0.8, 0.16), loc=(0,0,z+0.08), bevel=0.02, mat=M("wall", pal)))
    for x in (-0.34,-0.12,0.12,0.34):
        parts.append(cyl(0.055,0.055,0.42, loc=(x,0.28,z+0.37), verts=8, mat=M("wall", pal), bevel=0.005))
    parts.append(box((0.86,0.5,0.36), loc=(0,0,z+0.5), bevel=0.02, mat=M("wall", pal)))
    parts.append(cone(0.62,0.34, loc=(0,0,z+0.85), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    return parts

def lm_beacon(pal, z):
    parts = []
    parts.append(cyl(0.26,0.30,0.16, loc=(0,0,z+0.08), verts=10, mat=M("wall", pal)))
    parts.append(cyl(0.13,0.19,1.0, loc=(0,0,z+0.62), verts=10, mat=M("wall", pal)))
    parts.append(cyl(0.16,0.16,0.10, loc=(0,0,z+1.15), verts=10, mat=M("roof", pal)))
    parts.append(ico(0.10, loc=(0,0,z+1.26), sub=1, mat=M("accent", pal)))
    parts.append(cone(0.20,0.20, loc=(0,0,z+1.36), verts=8, mat=M("roof", pal)))
    return parts

def lm_crystals(pal, z):
    parts = []
    random.seed(7)
    for i in range(7):
        a = i*0.9; r = 0.10 + 0.22*random.random()
        x = math.cos(a)*r; y = math.sin(a)*r
        h = 0.25 + 0.45*random.random()
        parts.append(cyl(0.07,0.0,h, loc=(x,y,z+h/2), rot=(0.12*random.random(),0.12*random.random(),0), verts=6, mat=M("accent", pal) if i%2 else M("roof", pal)))
    parts.append(box((0.9,0.9,0.10), loc=(0,0,z+0.05), bevel=0.03, mat=M("side", pal)))
    return parts

def lm_crystal_tower(pal, z):
    parts = lm_crystals(pal, z)[:4]
    parts.append(cyl(0.16,0.26,0.9, loc=(0,0,z+0.55), verts=8, mat=M("wall", pal)))
    parts.append(cyl(0.22,0.0,0.5, loc=(0,0,z+1.25), verts=6, mat=M("roof", pal)))
    return parts

def lm_mill(pal, z):
    parts = []
    parts.append(cyl(0.18,0.30,0.8, loc=(0,0,z+0.4), verts=8, mat=M("wall", pal)))
    parts.append(cone(0.34,0.24, loc=(0,0,z+0.92), verts=8, mat=M("roof", pal)))
    for i in range(4):
        a = i*math.pi/2
        parts.append(box((0.06,0.6,0.05), loc=(math.cos(a)*0.3, 0.36, z+0.7+math.sin(a)*0.3), rot=(0,0,a), bevel=0.01, mat=M("trunk", pal)))
    return parts

def lm_well(pal, z):
    parts = []
    parts.append(cyl(0.28,0.30,0.22, loc=(0,0,z+0.11), verts=10, mat=M("wall", pal)))
    parts.append(cyl(0.20,0.20,0.04, loc=(0,0,z+0.24), verts=10, mat=M("accent", pal), bevel=0))
    for x in (-0.2,0.2):
        parts.append(cyl(0.03,0.03,0.4, loc=(x,0,z+0.42), verts=6, mat=M("trunk", pal), bevel=0))
    parts.append(cone(0.30,0.18, loc=(0,0,z+0.66), verts=8, mat=M("roof", pal)))
    return parts

def lm_book_tower(pal, z):
    parts = []
    parts.append(cyl(0.24,0.28,1.1, loc=(0,0,z+0.55), verts=10, mat=M("wall", pal)))
    for i in range(4):
        parts.append(box((0.42,0.42,0.16), loc=(0,0,z+0.25+i*0.24), scale=None) if False else box((0.46,0.30,0.06), loc=(0,0,z+0.28+i*0.24), rot=(0,0.2*i,0), bevel=0.01, mat=M("side", pal)))
    parts.append(cone(0.30,0.26, loc=(0,0,z+1.2), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    return parts

def lm_pond(pal, z):
    parts = []
    parts.append(cyl(0.46,0.46,0.05, loc=(0,0,z+0.03), verts=14, mat=M("accent", pal), bevel=0))
    for i in range(5):
        a = i*1.3
        rock(pal, (math.cos(a)*0.44, math.sin(a)*0.44, z+0.08), 0.7)
    return parts

def lm_big_tree(pal, z):
    parts = []
    cyl(0.10,0.14,0.9, loc=(0,0,z+0.45), verts=7, mat=M("trunk", pal))
    for i,(x,y,s) in enumerate([(0,0,0.55),(-0.3,0.1,0.4),(0.3,-0.05,0.42),(0.05,0.3,0.38)]):
        parts.append(ico(s, loc=(x,y,z+1.0+(i*0.12)), sub=1, mat=M("tree", pal)))
    return parts

def lm_fountain(pal, z):
    parts = []
    parts.append(cyl(0.44,0.48,0.14, loc=(0,0,z+0.07), verts=12, mat=M("wall", pal)))
    parts.append(cyl(0.10,0.14,0.5, loc=(0,0,z+0.38), verts=8, mat=M("wall", pal)))
    parts.append(cyl(0.30,0.32,0.08, loc=(0,0,z+0.66), verts=12, mat=M("side", pal)))
    parts.append(ico(0.08, loc=(0,0,z+0.76), sub=1, mat=M("accent", pal)))
    return parts

def lm_crooked_tower(pal, z):
    parts = []
    parts.append(cyl(0.22,0.28,0.9, loc=(0.06,0,z+0.45), rot=(0.16,0,0.1), verts=8, mat=M("wall", pal)))
    parts.append(cone(0.30,0.30, loc=(0.2,0,z+1.0), rot=(0.12,0,0.1), verts=6, mat=M("roof", pal)))
    return parts

def lm_gate_arch(pal, z):
    parts = []
    parts.append(box((0.9,0.5,0.14), loc=(0,0,z+0.07), bevel=0.02, mat=M("wall", pal)))
    for x in (-0.33,0.33):
        parts.append(cyl(0.10,0.12,0.8, loc=(x,0,z+0.5), verts=8, mat=M("wall", pal)))
    parts.append(box((1.0,0.42,0.16), loc=(0,0,z+0.98), bevel=0.02, mat=M("wall", pal)))
    parts.append(cone(0.62,0.22, loc=(0,0,z+1.17), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    return parts

def lm_monolith(pal, z):
    parts = []
    parts.append(box((0.5,0.5,0.14), loc=(0,0,z+0.07), bevel=0.02, mat=M("side", pal)))
    parts.append(box((0.26,0.18,1.1), loc=(0,0,z+0.62), rot=(0,0,0.18), bevel=0.02, mat=M("wall", pal)))
    parts.append(ico(0.09, loc=(0,0,z+1.2), sub=1, mat=M("accent", pal)))
    return parts

def lm_balance(pal, z):
    parts = []
    parts.append(box((0.7,0.7,0.1), loc=(0,0,z+0.05), bevel=0.02, mat=M("side", pal)))
    parts.append(cyl(0.05,0.06,0.9, loc=(0,0,z+0.5), verts=8, mat=M("wall", pal)))
    parts.append(box((0.8,0.08,0.06), loc=(0,0,z+0.95), bevel=0.01, mat=M("trunk", pal)))
    for x in (-0.34,0.34):
        parts.append(cone(0.12,0.06, loc=(x,0,z+0.92), verts=8, mat=M("accent", pal)))
    return parts

def lm_lighthouse(pal, z):
    parts = lm_beacon(pal, z)
    return parts

def lm_clock_tower(pal, z):
    parts = []
    parts.append(box((0.6,0.6,0.18), loc=(0,0,z+0.09), bevel=0.02, mat=M("side", pal)))
    parts.append(box((0.44,0.44,1.0), loc=(0,0,z+0.62), bevel=0.02, mat=M("wall", pal)))
    parts.append(box((0.3,0.02,0.3), loc=(0,0.225,z+0.9), bevel=0.01, mat=M("accent", pal)))
    parts.append(cone(0.36,0.32, loc=(0,0,z+1.3), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    return parts

def lm_workshop(pal, z):
    parts = []
    parts.append(box((0.8,0.7,0.5), loc=(0,0,z+0.25), bevel=0.02, mat=M("wall", pal)))
    parts.append(cone(0.58,0.28, loc=(0,0,z+0.62), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    parts.append(box((0.12,0.12,0.5), loc=(0.24,0.1,z+0.75), bevel=0.01, mat=M("side", pal)))
    return parts

def lm_castle(pal, z):
    parts = []
    parts.append(box((0.9,0.9,0.5), loc=(0,0,z+0.25), bevel=0.02, mat=M("wall", pal)))
    for (x,y) in [(-0.42,-0.42),(0.42,-0.42),(-0.42,0.42),(0.42,0.42)]:
        parts.append(cyl(0.12,0.14,0.8, loc=(x,y,z+0.55), verts=8, mat=M("wall", pal)))
        parts.append(cone(0.19,0.22, loc=(x,y,z+1.0), verts=6, mat=M("roof", pal)))
    parts.append(box((0.2,0.2,0.24), loc=(0,0,z+0.62), bevel=0.01, mat=M("roof", pal)))
    return parts

def lm_waterwheel(pal, z):
    parts = []
    parts.append(box((0.7,0.5,0.4), loc=(0,0,z+0.2), bevel=0.02, mat=M("wall", pal)))
    parts.append(cone(0.52,0.24, loc=(0,0,z+0.52), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.3, minor_radius=0.04, location=(0.5,0,z+0.28), rotation=(0,math.pi/2,0))
    w = bpy.context.object; w.data.materials.append(M("trunk", pal)); parts.append(w)
    return parts

def lm_twin_towers(pal, z):
    parts = []
    for x in (-0.28,0.28):
        parts.append(cyl(0.13,0.17,0.9, loc=(x,0,z+0.45), verts=8, mat=M("wall", pal)))
        parts.append(cone(0.2,0.24, loc=(x,0,z+1.0), verts=6, mat=M("roof", pal)))
    parts.append(box((0.6,0.12,0.08), loc=(0,0,z+0.7), bevel=0.01, mat=M("trunk", pal)))
    return parts

def lm_arcade(pal, z):
    parts = []
    for x in (-0.36,0,0.36):
        parts.append(cyl(0.08,0.10,0.7, loc=(x,0,z+0.35), verts=8, mat=M("wall", pal)))
    parts.append(box((1.0,0.24,0.12), loc=(0,0,z+0.78), bevel=0.02, mat=M("wall", pal)))
    parts.append(cone(0.6,0.2, loc=(0,0,z+0.94), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    return parts

BUILDERS = dict(library=lm_library, beacon=lm_beacon, crystals=lm_crystals, crystal_tower=lm_crystal_tower,
                mill=lm_mill, well=lm_well, book_tower=lm_book_tower, pond=lm_pond, big_tree=lm_big_tree,
                fountain=lm_fountain, crooked_tower=lm_crooked_tower, gate_arch=lm_gate_arch, monolith=lm_monolith,
                balance=lm_balance, lighthouse=lm_lighthouse, clock_tower=lm_clock_tower, workshop=lm_workshop,
                castle=lm_castle, waterwheel=lm_waterwheel, twin_towers=lm_twin_towers, arcade=lm_arcade)

def build_island(idx, node_id, tier, landmark):
    pal = idx % len(PALETTES)
    size = {1:0.78, 2:1.02, 3:1.32}[tier]
    depth = {1:0.20, 2:0.26, 3:0.32}[tier]
    parts = []
    # 岛体
    parts.append(box((size*2, size*2, depth), loc=(0,0,0), bevel=size*0.16, mat=M("side", pal)))
    parts.append(box((size*1.86, size*1.86, depth*0.5), loc=(0,0,depth*0.28), bevel=size*0.13, mat=M("top", pal)))
    z0 = depth*0.45
    # 三档形态：第二档 = 环；第三档 = 双环 + 卫星
    if tier >= 2:
        bpy.ops.mesh.primitive_torus_add(major_radius=size*0.86, minor_radius=0.035, location=(0,0,z0+0.02), rotation=(0,0,0))
        ring = bpy.context.object; ring.data.materials.append(M("accent", pal)); parts.append(ring)
    if tier >= 3:
        bpy.ops.mesh.primitive_torus_add(major_radius=size*1.06, minor_radius=0.025, location=(0,0,z0+0.14), rotation=(0,0,0))
        ring2 = bpy.context.object; ring2.data.materials.append(M("roof", pal)); parts.append(ring2)
        parts.append(box((0.10,0.10,0.10), loc=(size*0.95,0,z0+0.22), bevel=0.01, mat=M("accent", pal)))
    # 地标（放大，相对岛体更显眼）
    lm_parts = BUILDERS[landmark](pal, z0)
    for o in lm_parts:
        o.scale = (o.scale.x*1.55, o.scale.y*1.55, o.scale.z*1.55)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.select_set(False)
    parts += lm_parts
    # 初始节点：顶部一根细杆 + 小旗
    if node_id == "rag":
        parts.append(cyl(0.02,0.02,1.25, loc=(0,0,z0+0.62), verts=6, mat=M("trunk", pal), bevel=0))
        parts.append(box((0.34,0.06,0.20), loc=(0.19,0,z0+1.15), bevel=0.005, mat=M("roof", pal)))
    # 小件
    random.seed(idx*37+5)
    spots = [(-size*0.62,size*0.55),(size*0.6,size*0.5),(-size*0.66,-size*0.5),(size*0.62,-size*0.55),(0,size*0.78)]
    random.shuffle(spots)
    n_props = 2 if tier == 1 else 3
    for i in range(n_props):
        x,y = spots[i]
        k = random.random()
        before = len(parts)
        if k < 0.6: tree(pal, (x,y,z0), 1.15+0.35*random.random())
        elif k < 0.85: rock(pal, (x,y,z0+0.06), 1.1+0.5*random.random())
        else: lan(pal, (x,y,z0), 1.2)
        # 记录新增小件并缩放
        for o in parts[before:]:
            o.scale = (o.scale.x*1.35, o.scale.y*1.35, o.scale.z*1.35)
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            o.select_set(False)
    # 浮石（岛底）
    for i in range(3):
        r = 0.10+0.13*random.random()
        parts.append(ico(r, loc=((random.random()-0.5)*size*1.4, (random.random()-0.5)*size*1.4, -depth*0.9-random.random()*0.4), sub=1, mat=M("side", pal)))
    # 合并
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = "island_%s" % node_id
    bpy.ops.object.shade_flat()
    path = os.path.join(OUT, "island_%s.glb" % node_id)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials='EXPORT')
    return dict(id=node_id, tier=tier, landmark=landmark, palette=pal, file="island_%s.glb" % node_id)

def build_gate(name, kind):
    pal = 3 if kind == "domain" else 4
    parts = []
    parts.append(box((2.6,2.6,0.34), loc=(0,0,0), bevel=0.28, mat=M("side", pal)))
    parts.append(box((2.3,2.3,0.22), loc=(0,0,0.25), bevel=0.22, mat=M("top", pal)))
    for x in (-0.7,0.7):
        parts.append(cyl(0.16,0.2,1.5, loc=(x,0,1.0), verts=10, mat=M("wall", pal)))
        parts.append(cyl(0.24,0.24,0.12, loc=(x,0,1.78), verts=10, mat=M("roof", pal)))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.72, minor_radius=0.10, location=(0,0,1.45), rotation=(0,0,0))
    ring = bpy.context.object; ring.data.materials.append(M("accent", pal)); parts.append(ring)
    parts.append(box((1.1,0.5,0.4), loc=(0,0,0.55), bevel=0.04, mat=M("wall", pal)))
    parts.append(cone(0.5,0.35, loc=(0,0,1.95), verts=4, rot=(0,0,math.pi/4), mat=M("roof", pal)))
    # 台阶
    for i in range(3):
        parts.append(box((1.4-i*0.2,0.3,0.10), loc=(0,1.1+i*0.28,0.2+i*0.08), bevel=0.02, mat=M("side", pal)))
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object; obj.name = "gate_%s" % kind
    bpy.ops.object.shade_flat()
    path = os.path.join(OUT, "gate_%s.glb" % kind)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials='EXPORT')
    return dict(id="gate_"+kind, file="gate_%s.glb" % kind)

reset()
manifest = []
for i,(nid, tier, lm) in enumerate(NODES):
    reset()
    manifest.append(build_island(i, nid, tier, lm))
reset()
manifest.append(build_gate("domain","domain"))
reset()
manifest.append(build_gate("flow","flow"))
with open(os.path.join(OUT,"manifest.json"),"w",encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
print("ASSETS_DONE", len(manifest))


