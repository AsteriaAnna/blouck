import bpy, os
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=1)
o=bpy.context.object
m=bpy.data.materials.new("m"); m.use_nodes=True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value=(0.8,0.2,0.2,1)
o.data.materials.append(m)
out=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","_assets")
os.makedirs(out,exist_ok=True)
path=os.path.join(out,"test.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True)
print("EXPORT_OK", os.path.exists(path), os.path.getsize(path) if os.path.exists(path) else 0)
