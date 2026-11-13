import base64, os
BASE = r"C:\Users\Asteria\Documents\deepseek-harness\旅途"
T = os.path.join(BASE, "_tools")
three = open(os.path.join(T, "three147.min.js"), encoding="utf-8").read()
gltf = open(os.path.join(T, "GLTFLoader147.js"), encoding="utf-8").read()
buf = open(os.path.join(T, "BufferGeometryUtils147.js"), encoding="utf-8").read()
with open(os.path.join(BASE, "_assets", "island_rag.glb"), "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

html = """<!doctype html><html><body style="font:18px sans-serif;padding:20px">
<div id="log">start</div>
<script>%s</script>
<script>%s</script>
<script>%s</script>
<script>
var L = document.getElementById('log');
function say(s){ L.textContent = s; }
try {
  say('three=' + (typeof THREE) + ' loader=' + (typeof (THREE && THREE.GLTFLoader)) + ' buf=' + (typeof (THREE && THREE.BufferGeometryUtils)));
  var bin = atob("%s");
  var u = new Uint8Array(bin.length);
  for (var i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  var loader = new THREE.GLTFLoader();
  loader.parse(u.buffer, "", function(g){ say('OK children=' + g.scene.children.length); },
    function(e){ say('ERR ' + e); });
  say(say('parsing...'));
} catch(e) { say('THROW ' + e); }
</script></body></html>""" % (three, buf, gltf, b64)

open(os.path.join(BASE, "_test_glb.html"), "w", encoding="utf-8").write(html)
print("written", len(html))
