import io
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_html.py"
s = io.open(p, encoding="utf-8").read()

# ---------- CSS + HTML 面板 ----------
s = s.replace("""#toast.show{opacity:1;transform:translate(-50%,0)}""",
"""#toast.show{opacity:1;transform:translate(-50%,0)}
#panel{position:fixed;right:22px;top:86px;width:min(360px,34vw);background:#FFFDF7;border:1px solid rgba(60,50,40,.28);
  border-radius:4px;padding:18px 20px 16px;box-shadow:0 10px 30px rgba(80,60,30,.10);
  transform:translateX(calc(100% + 40px));transition:transform .35s cubic-bezier(.22,.61,.36,1);z-index:30;display:none}
#panel.open{transform:translateX(0);display:block}
#panel .p-close{position:absolute;right:10px;top:8px;font-size:18px;line-height:1;color:#8A8278;background:none;border:0;cursor:pointer}
#panel .p-k{font-size:9.5px;letter-spacing:2px;color:#9A9186;margin-bottom:8px}
#panel h3{margin:0 0 6px;font-size:21px;font-weight:500;letter-spacing:.5px}
#panel .p-muted{font-size:11.5px;color:#8A8278;line-height:1.7;margin:2px 0 10px}
#panel .p-row{display:flex;justify-content:space-between;font-size:11.5px;color:#5A5347;margin-top:12px;
  border-top:1px solid rgba(60,50,40,.12);padding-top:10px}
#panel .p-row span{letter-spacing:.5px}
#panel .p-btn{margin-top:14px;width:100%;padding:9px 0;border:1px solid #2A2620;border-radius:999px;background:#FFFDF7;
  font-size:12px;cursor:pointer}
#panel .p-btn:hover{background:#2A2620;color:#FFFDF7}
#panel .p-tags{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
#panel .p-tag{font-size:10.5px;border:1px solid rgba(60,50,40,.25);border-radius:999px;padding:2px 8px;color:#6E6558}""")

s = s.replace("""<div id="toast"></div>""", """<div id="toast"></div>
<div id="panel"></div>""")

# ---------- buildings 数组 + 加载 + 面板函数 ----------
s = s.replace("""var islands=[],pickables=[];""", """var islands=[],pickables=[],buildings=[];""")

s = s.replace("""/* 星路：四种线型 */""",
"""/* 副本建筑：领域副本（挂在节点上的塔）+ 流程副本（独立岛） */
var BUILDINGS=[
 {key:"domain",asset:"gate_domain",name:"领域副本",sub:"每日 10 题 · 填空 / 判断 / 解答；跨天保留",
  node:"retrieval",scale:0.52,badge:"节点内建筑"},
 {key:"flow",asset:"gate_flow",name:"流程副本",sub:"连线题 · 把流程步骤按正确顺序连起来；通关后可再打开",
  pos:[1080*S,0,780*S],scale:0.95,badge:"独立建筑"}
];
BUILDINGS.forEach(function(b){
  var data=ASSETS[b.asset]; if(!data)return;
  loader.parse(b64buf(data),"",function(g){
    var obj=g.scene;
    obj.traverse(function(ch){
      if(!ch.isMesh)return;
      ch.castShadow=true;ch.receiveShadow=true;
      var mats=Array.isArray(ch.material)?ch.material:[ch.material];
      var arr=mats.map(function(m){
        var c=m.color?m.color.getHex():0xffffff;
        var nm=new THREE.MeshToonMaterial({color:c,gradientMap:gradTex});
        return nm;
      });
      ch.material=Array.isArray(ch.material)?arr:arr[0];
    });
    var pos;
    if(b.node){var n=byId[b.node];pos=[n.x*S,1.45,n.y*S];}else pos=b.pos;
    obj.position.set(pos[0],pos[1],pos[2]);
    obj.scale.setScalar(b.scale);
    scene.add(obj);
    var box=new THREE.Box3().setFromObject(obj);
    var size=new THREE.Vector3();box.getSize(size);
    var pick=new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.2,size.x),Math.max(1.0,size.y),Math.max(1.2,size.z)),
      new THREE.MeshBasicMaterial({visible:false}));
    pick.position.copy(obj.position);pick.position.y+=size.y*0.35;
    pick.userData.building=b;
    scene.add(pick);pickables.push(pick);
    var lbl=makeLabel(b.name,false);
    buildings.push({cfg:b,obj:obj,label:lbl});
  },function(){});
});

/* 右侧面板：节点 MD / 副本 */
function openPanel(html){
  var p=document.getElementById("panel");
  p.innerHTML='<button class="p-close">×</button>'+html;
  p.classList.add("open");
  p.querySelector(".p-close").onclick=function(){p.classList.remove("open");};
}
function nodePanel(n){
  var form=["第一档 · 核心","第二档 · 环","第三档 · 三形态"][n.tier-1]||"第一档 · 核心";
  openPanel(
    '<div class="p-k">节点 · '+form+'</div><h3>'+n.name+'</h3>'+
    '<div class="p-tags"><span class="p-tag">实体</span><span class="p-tag">三档 '+n.tier+'</span>'+
    (n.id==="rag"?'<span class="p-tag">初始节点</span>':'')+'</div>'+
    '<div class="p-row"><span>自由区</span><span>可编辑</span></div>'+
    '<div class="p-muted">摘录 / 资料 / 链接 / 图片 / 定位 / 关系</div>'+
    '<div class="p-row"><span>题目区</span><span>5 简答 · 10 判断</span></div>'+
    '<div class="p-muted">三档：1/1 · 3/5 · 5/10（仅 AI 生成题计入）</div>'+
    '<button class="p-btn">开始答题</button>'
  );
}
function buildingPanel(b){
  openPanel(
    '<div class="p-k">建筑 · 副本 · '+b.badge+'</div><h3>'+b.name+'</h3>'+
    '<div class="p-muted">'+b.sub+'</div>'+
    '<div class="p-row"><span>出现条件</span><span>AI 依据当前图谱自动生成</span></div>'+
    '<div class="p-row"><span>当前状态</span><span>可挑战</span></div>'+
    '<button class="p-btn">进入挑战</button>'
  );
}

/* 星路：四种线型 */""")

# ---------- 点击处理 ----------
s = s.replace("""  var it=hits[0].object.userData.island;if(!it)return;
  camGoal.set(it.node.x*S,0,it.node.y*S);
  dist=Math.min(dist,34);
  if(!it.revealed)reveal(it); else toast(it.node.name+" · 第"+it.node.tier+"档浮岛");""",
"""  var hit=hits[0].object;
  if(hit.userData.building){
    var b=hit.userData.building;
    var p=b.node?new THREE.Vector3(byId[b.node].x*S,0,byId[b.node].y*S):new THREE.Vector3(b.pos[0],0,b.pos[2]);
    camGoal.copy(p);dist=Math.min(dist,32);
    buildingPanel(b);toast(b.name+" · 已开启");
    return;
  }
  var it=hit.userData.island;if(!it)return;
  camGoal.set(it.node.x*S,0,it.node.y*S);
  dist=Math.min(dist,34);
  if(!it.revealed)reveal(it);
  nodePanel(it.node);""")

# ---------- 建筑标签投影 ----------
s = s.replace("""  camTarget.lerp(camGoal,0.055);""",
"""  buildings.forEach(function(b){
    var p=b.cfg.node?byId[b.cfg.node]:null;
    v.set(0,2.1,0);b.obj.localToWorld(v);v.project(camera);
    var bx=(v.x*0.5+0.5)*window.innerWidth,by=(-v.y*0.5+0.5)*window.innerHeight;
    b.label.style.opacity=(v.z>1)?0:1;
    b.label.style.left=bx+"px";b.label.style.top=by+"px";
  });
  camTarget.lerp(camGoal,0.055);""")

# ---------- HUD 增加建筑数 ----------
s = s.replace("""<b id="c-edges">0</b> 星路""", """<b id="c-edges">0</b> 星路 · <b id="c-builds">0</b> 副本""")
s = s.replace("""document.getElementById("c-edges").textContent=EDGES.length;""",
"""document.getElementById("c-edges").textContent=EDGES.length;
document.getElementById("c-builds").textContent=BUILDINGS.length;""")

io.open(p, "w", encoding="utf-8").write(s)
print("buildings+panel patched")
