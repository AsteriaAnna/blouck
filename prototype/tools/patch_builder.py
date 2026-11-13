import io, os, re
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_html.py"
s = io.open(p, encoding="utf-8").read()

# 进度/错误显示
s = s.replace(
"""var remaining=NODES.length;""",
"""var remaining=NODES.length;
function prog(msg){ var d=document.getElementById("loading"); if(d) d.textContent=msg; }"""
)
s = s.replace(
"""  loader.parse(b64buf(data),"",function(gltf){
    var obj=gltf.scene;""",
"""  prog("解析 "+id+" ...");
  loader.parse(b64buf(data),"",function(gltf){
    try{
    var obj=gltf.scene;"""
)
s = s.replace(
"""    remaining--;
    if(remaining<=0)finish();
  },function(err){ console.error("load fail",id,err); remaining--; if(remaining<=0)finish(); });""",
"""    remaining--;
    prog("完成 "+id+"，剩余 "+remaining);
    if(remaining<=0)finish();
    }catch(err){ prog("LOAD_ERR "+id+" : "+err); }
  },function(err){ prog("PARSE_ERR "+id+" : "+err); remaining--; if(remaining<=0)finish(); });"""
)
io.open(p, "w", encoding="utf-8").write(s)
print("patched builder")
