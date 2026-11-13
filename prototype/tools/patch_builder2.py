import io
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_html.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace('"use strict";', '"use strict";\nvar DBG=function(m){var d=document.getElementById("loading");if(d)d.textContent="DBG "+m;};\nDBG("01 main");', 1)
s = s.replace('var loader=new THREE.GLTFLoader();', 'DBG("02 before loader "+typeof THREE.GLTFLoader);\nvar loader=new THREE.GLTFLoader();\nDBG("03 loader ok");')
s = s.replace('var remaining=NODES.length;', 'DBG("04 before loop");\nvar remaining=NODES.length;')
s = s.replace('  prog("解析 "+id+" ...");', '  prog("解析 "+id+" ..."); DBG("05 parse "+id);')
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
