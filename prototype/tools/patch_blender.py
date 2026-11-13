import io
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_assets.py"
s = io.open(p, encoding="utf-8").read()

# 1) 岛体缩小
s = s.replace("    size = {1:1.05, 2:1.45, 3:1.95}[tier]", "    size = {1:0.78, 2:1.02, 3:1.32}[tier]")
s = s.replace("    depth = {1:0.30, 2:0.38, 3:0.46}[tier]", "    depth = {1:0.20, 2:0.26, 3:0.32}[tier]")

# 2) 建筑/小件放大：把 landmark 与 props 先收集再整体缩放
s = s.replace("""    # 地标
    parts += BUILDERS[landmark](pal, z0)""",
"""    # 地标（放大，相对岛体更显眼）
    lm_parts = BUILDERS[landmark](pal, z0)
    for o in lm_parts:
        o.scale = (o.scale.x*1.55, o.scale.y*1.55, o.scale.z*1.55)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.select_set(False)
    parts += lm_parts""")

s = s.replace("""        if k < 0.6: tree(pal, (x,y,z0), 0.8+0.3*random.random())
        elif k < 0.85: rock(pal, (x,y,z0+0.06), 0.8+0.4*random.random())
        else: lan(pal, (x,y,z0), 0.9)""",
"""        before = len(parts)
        if k < 0.6: tree(pal, (x,y,z0), 1.15+0.35*random.random())
        elif k < 0.85: rock(pal, (x,y,z0+0.06), 1.1+0.5*random.random())
        else: lan(pal, (x,y,z0), 1.2)
        # 记录新增小件并缩放
        for o in parts[before:]:
            o.scale = (o.scale.x*1.35, o.scale.y*1.35, o.scale.z*1.35)
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            o.select_set(False)""")

# 3) 三档形态：二档加环，三档加双环+卫星
s = s.replace("""    z0 = depth*0.45""",
"""    z0 = depth*0.45
    # 三档形态：第二档 = 环；第三档 = 双环 + 卫星
    if tier >= 2:
        bpy.ops.mesh.primitive_torus_add(major_radius=size*0.86, minor_radius=0.035, location=(0,0,z0+0.02), rotation=(0,0,0))
        ring = bpy.context.object; ring.data.materials.append(M("accent", pal)); parts.append(ring)
    if tier >= 3:
        bpy.ops.mesh.primitive_torus_add(major_radius=size*1.06, minor_radius=0.025, location=(0,0,z0+0.14), rotation=(0,0,0))
        ring2 = bpy.context.object; ring2.data.materials.append(M("roof", pal)); parts.append(ring2)
        parts.append(box((0.10,0.10,0.10), loc=(size*0.95,0,z0+0.22), bevel=0.01, mat=M("accent", pal)))""")

# 4) 初始节点标记（rag）
s = s.replace("""    # 小件
    random.seed(idx*37+5)""",
"""    # 初始节点：顶部一根细杆 + 小旗
    if node_id == "rag":
        parts.append(cyl(0.02,0.02,1.25, loc=(0,0,z0+0.62), verts=6, mat=M("trunk", pal), bevel=0))
        parts.append(box((0.34,0.06,0.20), loc=(0.19,0,z0+1.15), bevel=0.005, mat=M("roof", pal)))
    # 小件
    random.seed(idx*37+5)""")

io.open(p, "w", encoding="utf-8").write(s)
print("blender script patched")
