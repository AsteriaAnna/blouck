import io
p = r"C:\Users\Asteria\Documents\deepseek-harness\旅途\_tools\build_html.py"
s = io.open(p, encoding="utf-8").read()

# 给 NODES 加 name
old = 'nodes_js = json.dumps([dict(id=a,tier=b,x=c,y=d,unknown=bool(e)) for a,b,c,d,e in nodes], ensure_ascii=False)'
new = '''NAMES = {"rag":"RAG","retrieval":"检索","vectordb":"向量数据库","embedding":"Embedding","chunking":"Chunking",
 "bm25":"BM25","docparse":"文档解析","clean":"数据清洗","kg":"知识图谱","generation":"生成",
 "hallucination":"幻觉","ctx":"上下文窗口","prompt":"Prompt","eval":"评测","recall":"召回率",
 "qa":"问答","finetune":"微调","agent":"Agent","workflow":"工作流","multimodal":"多模态","longctx":"长上下文"}
nodes_js = json.dumps([dict(id=a,tier=b,x=c,y=d,unknown=bool(e),name=NAMES[a]) for a,b,c,d,e in nodes], ensure_ascii=False)'''
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("names added")
