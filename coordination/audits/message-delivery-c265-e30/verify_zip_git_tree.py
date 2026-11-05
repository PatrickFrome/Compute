import hashlib, zipfile, sys
from collections import defaultdict
if len(sys.argv) != 2:
    raise SystemExit('usage: python verify_zip_git_tree.py <METAENGINE-e30-github-only-source.zip>')
archive=sys.argv[1]

def obj(typ,data):
    return hashlib.sha1(typ.encode()+b' '+str(len(data)).encode()+b'\0'+data).digest()

def calc(node):
    entries=[]
    for name,item in node.items():
        if isinstance(item,dict):
            mode=b'40000';sha=calc(item);order=name+'/'
        else:
            mode=b'100755' if item[0]&0o111 else b'100644'
            sha=obj('blob',item[1]);order=name
        entries.append((order,mode+b' '+name.encode('utf8')+b'\0'+sha))
    return obj('tree',b''.join(x[1] for x in sorted(entries,key=lambda v:v[0].encode('utf8'))))

root={};count=0;executables=0
with zipfile.ZipFile(archive) as z:
 for x in z.infolist():
  if x.is_dir():continue
  assert x.filename.startswith('Compute/')
  folders=x.filename.split('/')[1:]
  assert len(folders)>0 and all(f not in ('','.','..') for f in folders)
  cur=root
  for f in folders[:-1]:cur=cur.setdefault(f,{})
  mode=(x.external_attr>>16)&0o777
  cur[folders[-1]]=(mode,z.read(x));count+=1;executables+=bool(mode&0o111)
print('zip_sha256',hashlib.sha256(open(archive,'rb').read()).hexdigest())
print('zip_file_count',count)
print('zip_execute_mode_count',executables)
print('independent_zip_git_tree',calc(root).hex())
print('expected_git_tree','90fa5633d7926dd71a7303266073e0625325e740')
