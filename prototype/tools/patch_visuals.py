import io
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_html.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("scene.add(new THREE.AmbientLight(0xFFF6E8,1.25));", "scene.add(new THREE.AmbientLight(0xFFF6E8,0.82));")
s = s.replace("scene.add(new THREE.HemisphereLight(0xFFF8EC,0xD8CFC0,0.55));", "scene.add(new THREE.HemisphereLight(0xFFF8EC,0xD8CFC0,0.32));")
s = s.replace("var dir=new THREE.DirectionalLight(0xFFF2DC,1.5);", "var dir=new THREE.DirectionalLight(0xFFF2DC,1.30);")
s = s.replace("var gdata=new Uint8Array([80,140,205,245]);", "var gdata=new Uint8Array([28,86,152,235]);")
s = s.replace("var azimuth=Math.PI*0.78,elevation=Math.PI*0.25,dist=62;", "var azimuth=Math.PI*0.78,elevation=Math.PI*0.23,dist=48;")
# 加描边
s = s.replace("""      ch.material=Array.isArray(ch.material)?arr:arr[0];""",
"""      ch.material=Array.isArray(ch.material)?arr:arr[0];
      try{
        var eg=new THREE.EdgesGeometry(ch.geometry,38);
        var ln=new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:0x3A332B,transparent:true,opacity:0.45}));
        ch.add(ln);
      }catch(e){}""")
io.open(p, "w", encoding="utf-8").write(s)
print("patched visuals")
