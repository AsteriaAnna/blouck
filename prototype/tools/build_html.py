"""把 three.js + GLTFLoader + 21 个 glb 打包成单文件 HTML（file:// 可直接打开）"""
import base64, json, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 旅途/
TOOLS = os.path.join(BASE, "_tools")
ASSETS = os.path.join(BASE, "_assets")

def read(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read()

three = read(os.path.join(TOOLS, "three147.min.js"))
gltf = read(os.path.join(TOOLS, "GLTFLoader147.js"))
bufutils = read(os.path.join(TOOLS, "BufferGeometryUtils147.js"))

manifest = json.load(open(os.path.join(ASSETS, "manifest.json"), encoding="utf-8"))

nodes = [
 ("rag",2,900,560,0),("retrieval",3,690,430,0),("vectordb",2,490,300,1),("embedding",3,400,520,0),
 ("chunking",1,520,740,1),("bm25",1,300,880,1),("docparse",1,250,400,0),("clean",1,370,170,1),
 ("kg",1,640,1010,1),("generation",2,1140,420,0),("hallucination",1,1290,580,1),("ctx",2,1230,760,0),
 ("prompt",1,935,875,0),("eval",2,820,960,0),("recall",1,1000,1010,1),("qa",2,1080,290,0),
 ("finetune",1,1270,200,1),("agent",2,1450,380,0),("workflow",1,1580,560,1),("multimodal",1,1600,790,1),
 ("longctx",1,1410,960,0),
]
edges = [
 ("rag","retrieval","formal"),("rag","generation","formal"),("rag","ctx","formal"),("retrieval","vectordb","formal"),
 ("retrieval","embedding","formal"),("retrieval","chunking","formal"),("retrieval","bm25","formal"),
 ("embedding","vectordb","formal"),("chunking","docparse","source"),("docparse","clean","formal"),
 ("generation","hallucination","formal"),("generation","qa","formal"),("ctx","longctx","formal"),
 ("eval","recall","formal"),("eval","rag","formal"),("prompt","rag","formal"),("agent","rag","formal"),
 ("agent","workflow","formal"),("workflow","multimodal","source"),("kg","rag","formal"),
 ("finetune","qa","formal"),("chunking","recall","suggest"),("kg","retrieval","suggest"),
 ("hallucination","ctx","dir"),("recall","longctx","dir"),("workflow","multimodal","dir")
]

assets = {}
for m in manifest:
    fid = m["file"].replace(".glb", "").replace("island_", "")
    with open(os.path.join(ASSETS, m["file"]), "rb") as f:
        assets[fid] = base64.b64encode(f.read()).decode("ascii")

HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>知识世界 · 3D 浮岛 v3.3</title>
<meta name="color-scheme" content="light"/>
<style>
:root{--ink:#2A2620;--dim:#7A736A;--font:"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#F7F2E8;color:var(--ink);font-family:var(--font)}
canvas{display:block}
.hud{position:fixed;left:34px;top:26px;pointer-events:none;z-index:12}
.hud .t{font-size:10px;letter-spacing:5px;color:var(--dim)}
.hud .h{font-size:23px;letter-spacing:2px;margin-top:8px;font-weight:500}
.hud .m{margin-top:9px;font-size:11.5px;color:var(--dim);letter-spacing:.6px}
.hud .m b{color:var(--ink);font-weight:600}
.hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);font-size:10.5px;color:#8A8278;
  background:rgba(255,253,247,.86);padding:4px 12px;border-radius:999px;z-index:12}
#labels{position:fixed;inset:0;pointer-events:none;z-index:8;overflow:hidden}
.lbl3d{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;
  background:rgba(255,253,247,.92);border:1px solid rgba(60,50,40,.16);border-radius:999px;
  padding:2px 9px;font-size:11px;color:#3A332B;box-shadow:0 2px 6px rgba(90,70,40,.08)}
.lbl3d.unknown{color:#9A9186;border-style:dashed}
#toast{position:fixed;left:50%;top:24px;transform:translate(-50%,-10px);padding:8px 16px;
  border:1px solid rgba(60,50,40,.30);border-radius:999px;background:#FFFDF7;font-size:12px;opacity:0;
  transition:all .25s;pointer-events:none;z-index:40;text-align:center}
#toast.show{opacity:1;transform:translate(-50%,0)}
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
#panel .p-tag{font-size:10.5px;border:1px solid rgba(60,50,40,.25);border-radius:999px;padding:2px 8px;color:#6E6558}
.loading{position:fixed;inset:0;display:grid;place-items:center;background:#F7F2E8;z-index:50;
  font-size:12px;color:#9A9186;letter-spacing:1px}
</style>
</head>
<body>
<header class="hud">
  <div class="t">KNOWLEDGE WORLD</div>
  <div class="h">AI 产品学习</div>
  <div class="m"><b id="c-found">0</b>/<b id="c-nodes">0</b> 已探索 · <b id="c-edges">0</b> 星路 · <b id="c-builds">0</b> 副本</div>
</header>
<div class="hint">拖拽旋转 · 滚轮缩放 · 点击雾中的剪影</div>
<div id="labels"></div>
<div id="toast"></div>
<div id="panel"></div>
<div class="loading" id="loading">正在把浮岛搬进世界…</div>

<script>window.__ERR=[];window.addEventListener("error",function(e){try{document.getElementById("loading").textContent="ERR: "+(e.message||e.error);}catch(x){}});window.addEventListener("unhandledrejection",function(e){try{document.getElementById("loading").textContent="REJ: "+e.reason;}catch(x){}});</script>
<script>
window.addEventListener("error",function(e){try{var d=document.getElementById("loading");if(d)d.textContent="ERR: "+(e.message||e.error)+" @"+(e.lineno||"?");}catch(x){}});
window.addEventListener("unhandledrejection",function(e){try{var d=document.getElementById("loading");if(d)d.textContent="REJ: "+e.reason;}catch(x){}});
</script>
<script>__THREE__</script>
<script>__BUFUTILS__</script>
<script>__GLTF__</script>
<script>
var NODES=__NODES__;
var EDGES=__EDGES__;
var ASSETS=__ASSETS__;
(function(){
"use strict";
var DBG=function(m){var d=document.getElementById("loading");if(d)d.textContent="DBG "+m;};
DBG("01 main");
var S=0.02;
function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
function b64buf(b64){var bin=atob(b64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer;}

var scene=new THREE.Scene();
var renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

var bgc=document.createElement("canvas");bgc.width=4;bgc.height=256;
var bx=bgc.getContext("2d");var bg=bx.createLinearGradient(0,0,0,256);
bg.addColorStop(0,"#FDFAF3");bg.addColorStop(.55,"#F7F1E5");bg.addColorStop(1,"#EFE7D9");
bx.fillStyle=bg;bx.fillRect(0,0,4,256);
var bgTex=new THREE.CanvasTexture(bgc);bgTex.encoding=THREE.sRGBEncoding;
scene.background=bgTex;
scene.fog=new THREE.Fog(0xF3EDE1,42,110);

var camera=new THREE.PerspectiveCamera(30,window.innerWidth/window.innerHeight,0.1,500);
var camTarget=new THREE.Vector3(900*S,0,560*S),camGoal=camTarget.clone();
var azimuth=Math.PI*0.78,elevation=Math.PI*0.23,dist=48;

scene.add(new THREE.AmbientLight(0xFFF6E8,0.82));
scene.add(new THREE.HemisphereLight(0xFFF8EC,0xD8CFC0,0.32));
var dir=new THREE.DirectionalLight(0xFFF2DC,1.30);
dir.position.set(12,24,9);dir.castShadow=true;
dir.shadow.mapSize.set(2048,2048);
dir.shadow.camera.left=-32;dir.shadow.camera.right=32;
dir.shadow.camera.top=32;dir.shadow.camera.bottom=-32;
dir.shadow.camera.far=100;dir.shadow.bias=-0.0004;dir.shadow.radius=4;
scene.add(dir);
var ground=new THREE.Mesh(new THREE.PlaneGeometry(240,240),new THREE.ShadowMaterial({opacity:0.10}));
ground.rotation.x=-Math.PI/2;ground.position.y=-2.2;ground.receiveShadow=true;scene.add(ground);

var gdata=new Uint8Array([28,86,152,235]);
var gradTex=new THREE.DataTexture(gdata,4,1,THREE.RedFormat);
gradTex.needsUpdate=true;gradTex.magFilter=THREE.NearestFilter;gradTex.minFilter=THREE.NearestFilter;

var GRAY=0xBDB6AA;
DBG("02 before loader "+typeof THREE.GLTFLoader);
var loader=new THREE.GLTFLoader();
DBG("03 loader ok");
var islands=[],pickables=[],buildings=[];
var byId={};NODES.forEach(function(n){byId[n.id]=n;});

function makeLabel(text,unknown){
  var d=document.createElement("div");
  d.className="lbl3d"+(unknown?" unknown":"");
  d.textContent=text;
  document.getElementById("labels").appendChild(d);
  return d;
}

DBG("04 before loop");
var remaining=NODES.length;
function prog(msg){ var d=document.getElementById("loading"); if(d) d.textContent=msg; }
NODES.forEach(function(n,i){ DBG("loop "+n.id);
  var id=n.id;
  var data=ASSETS[id];
  if(!data){ remaining--; return; }
  prog("解析 "+id+" ..."); DBG("05 parse "+id);
  loader.parse(b64buf(data),"",function(gltf){
    try{
    var obj=gltf.scene;
    var colors=[];
    obj.traverse(function(ch){
      if(!ch.isMesh)return;
      ch.castShadow=true;ch.receiveShadow=true;
      var mats=Array.isArray(ch.material)?ch.material:[ch.material];
      var arr=mats.map(function(m){
        var c=m.color?m.color.getHex():0xFFFFFF;
        var nm=new THREE.MeshToonMaterial({color:c,gradientMap:gradTex});
        colors.push({mat:nm,color:c});
        return nm;
      });
      ch.material=Array.isArray(ch.material)?arr:arr[0];
      try{
        var eg=new THREE.EdgesGeometry(ch.geometry,38);
        var ln=new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:0x3A332B,transparent:true,opacity:0.45}));
        ch.add(ln);
      }catch(e){}
    });
    obj.position.set(n.x*S,0,n.y*S);
    obj.userData.node=n;
    scene.add(obj);
    var label=makeLabel(n.unknown?"???":n.name,n.unknown);
    var it={node:n,group:obj,phase:i*0.7,label:label,colors:colors,revealed:!n.unknown};
    if(n.unknown){
      colors.forEach(function(c){c.mat.color.setHex(GRAY);if(c.mat.emissive)c.mat.emissive.setHex(0x000000);});
    }
    /* 拾取盒 */
    var box=new THREE.Box3().setFromObject(obj);
    var size=new THREE.Vector3();box.getSize(size);
    var pick=new THREE.Mesh(new THREE.BoxGeometry(Math.max(2,size.x),Math.max(1.6,size.y),Math.max(2,size.z)),
      new THREE.MeshBasicMaterial({visible:false}));
    pick.position.copy(obj.position);pick.position.y+=size.y*0.4;
    pick.userData.island=it;
    scene.add(pick);pickables.push(pick);
    islands.push(it);
    remaining--;
    prog("完成 "+id+"，剩余 "+remaining);
    if(remaining<=0)finish();
    }catch(err){ prog("LOAD_ERR "+id+" : "+err); }
  },function(err){ prog("PARSE_ERR "+id+" : "+err); remaining--; if(remaining<=0)finish(); });
});

/* 副本建筑：领域副本（挂在节点上的塔）+ 流程副本（独立岛） */
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

/* 星路：四种线型 */
function qmarkSprite(){
  var c=document.createElement("canvas");c.width=64;c.height=64;
  var x=c.getContext("2d");x.fillStyle="#FFFDF7";x.strokeStyle="#6E6558";x.lineWidth=3;
  x.beginPath();x.arc(32,32,26,0,Math.PI*2);x.fill();x.stroke();
  x.fillStyle="#6E6558";x.font="bold 34px sans-serif";x.textAlign="center";x.textBaseline="middle";x.fillText("?",32,34);
  var tex=new THREE.CanvasTexture(c);tex.encoding=THREE.sRGBEncoding;
  var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.scale.set(0.34,0.34,1);return sp;
}
EDGES.forEach(function(p){
  var a=byId[p[0]],b=byId[p[1]];if(!a||!b)return;
  var type=p[2]||"formal";
  var A=new THREE.Vector3(a.x*S,0.55,a.y*S),B=new THREE.Vector3(b.x*S,0.55,b.y*S);
  var mid=A.clone().add(B).multiplyScalar(.5);
  var lift=type==="dir"?0.15:0.25;
  mid.y+=A.distanceTo(B)*lift;
  var curve=new THREE.QuadraticBezierCurve3(A,mid,B);
  if(type==="formal"||type==="source"){
    var col=type==="source"?0x6E8FA8:0x4A4238;
    var rad=type==="source"?0.022:0.028;
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve,26,rad,5,false),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:type==="source"?.72:.8})));
    if(type==="source"){
      var dot=new THREE.Mesh(new THREE.SphereGeometry(0.07,10,10),
        new THREE.MeshBasicMaterial({color:0x6E8FA8}));
      dot.position.copy(A);scene.add(dot);
    }
  }else{
    var pts=curve.getPoints(40);
    var g=new THREE.BufferGeometry().setFromPoints(pts);
    var m=new THREE.LineDashedMaterial({
      color:type==="dir"?0xA79E90:0x8A8278,
      dashSize:type==="dir"?0.05:0.16,
      gapSize:type==="dir"?0.10:0.12,
      transparent:true,opacity:type==="dir"?.75:.8
    });
    var line=new THREE.Line(g,m);line.computeLineDistances();scene.add(line);
    if(type==="dir"){
      var q=qmarkSprite();q.position.copy(B);q.position.y+=0.25;scene.add(q);
    }
  }
});

/* 交互 */
var dragging=false,downX=0,downY=0,moved=0;
var ray=new THREE.Raycaster(),ptr=new THREE.Vector2();
var el=renderer.domElement;
el.addEventListener("pointerdown",function(e){dragging=true;downX=e.clientX;downY=e.clientY;moved=0;el.setPointerCapture(e.pointerId);});
el.addEventListener("pointermove",function(e){
  if(!dragging)return;
  var dx=e.clientX-downX,dy=e.clientY-downY;
  moved=Math.max(moved,Math.hypot(dx,dy));
  if(moved>4){azimuth-=dx*0.006;elevation=Math.max(Math.PI*0.12,Math.min(Math.PI*0.40,elevation+dy*0.004));downX=e.clientX;downY=e.clientY;}
});
el.addEventListener("pointerup",function(e){if(!dragging)return;dragging=false;if(moved<5)pick(e);});
el.addEventListener("wheel",function(e){e.preventDefault();dist=Math.max(22,Math.min(120,dist*Math.exp(e.deltaY*0.0011)));},{passive:false});

var found=NODES.filter(function(n){return !n.unknown;}).length;
function pick(e){
  ptr.x=(e.clientX/window.innerWidth)*2-1;ptr.y=-(e.clientY/window.innerHeight)*2+1;
  ray.setFromCamera(ptr,camera);
  var hits=ray.intersectObjects(pickables,false);
  if(!hits.length)return;
  var hit=hits[0].object;
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
  nodePanel(it.node);
}
function reveal(it){
  it.revealed=true;it.node.unknown=false;
  it.colors.forEach(function(c){c.mat.color.setHex(c.color);});
  it.label.textContent=it.node.name;it.label.classList.remove("unknown");
  found++;document.getElementById("c-found").textContent=found;
  toast("发现新区："+it.node.name);
}
var toastTimer;
function toast(m){var t=document.getElementById("toast");t.textContent=m;t.classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.classList.remove("show");},2000);}

document.getElementById("c-nodes").textContent=NODES.length;
document.getElementById("c-edges").textContent=EDGES.length;
document.getElementById("c-builds").textContent=BUILDINGS.length;

var clock=new THREE.Clock(),v=new THREE.Vector3();
function finish(){
  document.getElementById("c-found").textContent=found;
  var ld=document.getElementById("loading");if(ld)ld.style.display="none";
  toast("世界已生成："+islands.length+" 座浮岛");
}
function frame(){
  requestAnimationFrame(frame);
  var t=clock.getElapsedTime();
  islands.forEach(function(it){
    it.group.position.y=Math.sin(t*0.85+it.phase)*0.055;
    it.group.rotation.y=Math.sin(t*0.35+it.phase)*0.012;
    v.set(0,1.9,0);it.group.localToWorld(v);v.project(camera);
    var x=(v.x*0.5+0.5)*window.innerWidth,y=(-v.y*0.5+0.5)*window.innerHeight;
    it.label.style.opacity=(v.z>1)?0:1;
    it.label.style.left=x+"px";it.label.style.top=y+"px";
  });
  buildings.forEach(function(b){
    var p=b.cfg.node?byId[b.cfg.node]:null;
    v.set(0,2.1,0);b.obj.localToWorld(v);v.project(camera);
    var bx=(v.x*0.5+0.5)*window.innerWidth,by=(-v.y*0.5+0.5)*window.innerHeight;
    b.label.style.opacity=(v.z>1)?0:1;
    b.label.style.left=bx+"px";b.label.style.top=by+"px";
  });
  camTarget.lerp(camGoal,0.055);
  camera.position.set(
    camTarget.x+Math.sin(azimuth)*Math.cos(elevation)*dist,
    camTarget.y+Math.sin(elevation)*dist,
    camTarget.z+Math.cos(azimuth)*Math.cos(elevation)*dist);
  camera.lookAt(camTarget);
  dir.target.position.copy(camTarget);dir.target.updateMatrixWorld();scene.add(dir.target);
  renderer.render(scene,camera);
}
window.addEventListener("resize",function(){
  camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
});
frame();
})();
</script>
</body>
</html>
"""

NAMES = {"rag":"RAG","retrieval":"检索","vectordb":"向量数据库","embedding":"Embedding","chunking":"Chunking",
 "bm25":"BM25","docparse":"文档解析","clean":"数据清洗","kg":"知识图谱","generation":"生成",
 "hallucination":"幻觉","ctx":"上下文窗口","prompt":"Prompt","eval":"评测","recall":"召回率",
 "qa":"问答","finetune":"微调","agent":"Agent","workflow":"工作流","multimodal":"多模态","longctx":"长上下文"}
nodes_js = json.dumps([dict(id=a,tier=b,x=c,y=d,unknown=bool(e),name=NAMES[a]) for a,b,c,d,e in nodes], ensure_ascii=False)
edges_js = json.dumps([list(e) for e in edges])
assets_js = json.dumps(assets)

out = HTML.replace("__THREE__", three).replace("__BUFUTILS__", bufutils).replace("__GLTF__", gltf)
out = out.replace("__NODES__", nodes_js).replace("__EDGES__", edges_js).replace("__ASSETS__", assets_js)

dst = os.path.join(BASE, "knowledge-world-visual-v3.3-glb.html")
with open(dst, "w", encoding="utf-8") as f:
    f.write(out)
print("WROTE", dst, len(out))




