import io
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_html.py"
s = io.open(p, encoding="utf-8").read()

# ---------- 1. 边类型（正式 / 来源 / 建议 / 方向） ----------
s = s.replace(
"""edges = [("rag","retrieval"),("rag","generation"),("rag","ctx"),("retrieval","vectordb"),("retrieval","embedding"),
 ("retrieval","chunking"),("retrieval","bm25"),("embedding","vectordb"),("chunking","docparse"),("docparse","clean"),
 ("generation","hallucination"),("generation","qa"),("ctx","longctx"),("eval","recall"),("eval","rag"),
 ("prompt","rag"),("agent","rag"),("agent","workflow"),("workflow","multimodal"),("kg","rag"),
 ("finetune","qa"),("chunking","recall"),("kg","retrieval")]""",
"""edges = [
 ("rag","retrieval","formal"),("rag","generation","formal"),("rag","ctx","formal"),("retrieval","vectordb","formal"),
 ("retrieval","embedding","formal"),("retrieval","chunking","formal"),("retrieval","bm25","formal"),
 ("embedding","vectordb","formal"),("chunking","docparse","source"),("docparse","clean","formal"),
 ("generation","hallucination","formal"),("generation","qa","formal"),("ctx","longctx","formal"),
 ("eval","recall","formal"),("eval","rag","formal"),("prompt","rag","formal"),("agent","rag","formal"),
 ("agent","workflow","formal"),("workflow","multimodal","source"),("kg","rag","formal"),
 ("finetune","qa","formal"),("chunking","recall","suggest"),("kg","retrieval","suggest"),
 ("hallucination","ctx","dir"),("recall","longctx","dir"),("workflow","multimodal","dir")
]""")
s = s.replace('edges_js = json.dumps([list(e) for e in edges])', 'edges_js = json.dumps([list(e) for e in edges])')

# ---------- 2. 星路渲染：按类型不同线型 ----------
old_edges = """/* 星路 */
EDGES.forEach(function(p){
  var a=byId[p[0]],b=byId[p[1]];if(!a||!b)return;
  var A=new THREE.Vector3(a.x*S,0.55,a.y*S),B=new THREE.Vector3(b.x*S,0.55,b.y*S);
  var mid=A.clone().add(B).multiplyScalar(.5);mid.y+=A.distanceTo(B)*.25;
  var curve=new THREE.QuadraticBezierCurve3(A,mid,B);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve,26,0.024,5,false),
    new THREE.MeshBasicMaterial({color:0x4A4238,transparent:true,opacity:.55})));
});"""
new_edges = """/* 星路：四种线型 */
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
});"""
s = s.replace(old_edges, new_edges)

io.open(p, "w", encoding="utf-8").write(s)
print("edges patched")
