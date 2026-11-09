import struct,sys,os,re,json
def probe(path):
    f=open(path,'rb');rd=lambda n:f.read(n)
    u32=lambda:struct.unpack('<I',rd(4))[0];u64=lambda:struct.unpack('<Q',rd(8))[0]
    def s():n=u64();return rd(n).decode('utf-8','replace')
    sizes={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
    fmt={0:'<B',1:'<b',2:'<H',3:'<h',4:'<I',5:'<i',6:'<f',7:'<?',10:'<Q',11:'<q',12:'<d'}
    def val(t):
        if t in fmt:return struct.unpack(fmt[t],rd(sizes[t]))[0]
        if t==8:return s()
        if t==9:
            it=u32();n=u64()
            if it in sizes:f.seek(sizes[it]*n,1)
            else:
                for _ in range(n):val(it)
            return None
    assert rd(4)==b'GGUF';ver=u32();nt=u64();nkv=u64();kv={}
    for _ in range(nkv):
        k=s();t=u32();v=val(t)
        if v is not None:kv[k]=v
    arch=kv.get('general.architecture','');al=kv.get('general.alignment',32)
    tens=[]
    for _ in range(nt):
        name=s();nd=u32();dims=[u64() for _ in range(nd)];ty=u32();off=u64();tens.append((name,dims,off))
    start=(f.tell()+al-1)//al*al;fs=os.path.getsize(path)
    tens.sort(key=lambda x:x[2])
    ec=kv.get(arch+'.expert_count',0);exp=0;dense=0
    for i,(n,d,o) in enumerate(tens):
        size=(tens[i+1][2] if i+1<len(tens) else fs-start)-o
        if ec>1 and re.match(r'blk\.\d+\..*_exps(\.weight)?$',n) and len(d)==3 and d[2]==ec: exp+=size
        else: dense+=size
    keys=['expert_count','expert_used_count','block_count','context_length','embedding_length','attention.head_count','attention.head_count_kv','leading_dense_block_count']
    return dict(arch=arch,**{k:kv.get(arch+'.'+k) for k in keys},expertMiB=exp>>20,denseMiB=dense>>20,moe=ec>1 and exp>0,file_type=kv.get('general.file_type'))
for p in sys.argv[1:]:print(p,json.dumps(probe(p)))
