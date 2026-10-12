"""Promote only the checksum-verified, unmodified native build to private tools."""
import hashlib
import json
import shutil
import subprocess
from rhubarb_benchmark import ROOT, WORK, save


def main():
    metadata = json.loads((WORK/'native-build.json').read_text())
    source = WORK/'native-baseline'
    binary = source/'rhubarb'
    if hashlib.sha256(binary.read_bytes()).hexdigest() != metadata['binarySha256']:
        raise RuntimeError('Original native binary checksum mismatch; refusing experimental binary')
    if 'arm64' not in subprocess.run(['file',str(binary)],capture_output=True,text=True,check=True).stdout:
        raise RuntimeError('Expected a native Apple Silicon executable')
    target = ROOT/'.runtime/tools/rhubarb-1.14.0-arm64'
    target.mkdir(parents=True,exist_ok=True)
    shutil.copy2(binary,target/'rhubarb')
    shutil.copytree(source/'res',target/'res',dirs_exist_ok=True)
    shutil.copy2(WORK/'upstream/LICENSE.md',target/'LICENSE.md')
    resources = {str(p.relative_to(target)):hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted((target/'res').rglob('*')) if p.is_file()}
    save(target/'build-manifest.json',{'schema':1,'version':'1.14.0','architecture':'arm64',
         'source':metadata['source'],'revision':metadata['revision'],
         'binarySha256':metadata['binarySha256'],'resourcesSha256':resources,
         'algorithmChanges':False,'build':'Release -O3 -DNDEBUG; one job; Boost 1.85.0'})
    print('Installed verified native Rhubarb in private project tools; no process started.')


if __name__=='__main__': main()
