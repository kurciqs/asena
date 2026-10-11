#!/usr/bin/env python3
"""Read-only preflight: no network, subprocesses, models, or server writes."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=('replay','live'),default='replay')
    args=parser.parse_args()
    errors=[]
    def check(condition,message,optional=False):
        print(('OK  ' if condition else 'WARN' if optional else 'FAIL')+' '+message)
        if not condition and not optional:errors.append(message)
    try:
        import config
    except (RuntimeError,ValueError) as error:
        print(f'FAIL Configuration: {error}');return 1
    for package in ('Flask','requests'):
        try: print(f'OK   {package} {importlib.metadata.version(package)}')
        except importlib.metadata.PackageNotFoundError: check(False,f'Missing {package}; install requirements.txt')
    try:
        pinned=[line for line in (ROOT/'requirements.txt').read_text().splitlines() if line and not line.startswith('#')]
        for line in pinned:
            name,wanted=line.split('==')
            try: actual=importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError: actual='missing'
            check(actual==wanted,f'Pinned {name}: installed {actual}, expected {wanted}',optional=True)
    except FileNotFoundError:check(False,'Missing requirements.txt')
    for path in ('src/index.html','src/system_prompt.txt','src/main.js'):
        check((ROOT/path).is_file(),f'Required asset {path}')
    for kind,suffix in (('vrm_models','.vrm'),('animations','.fbx')):
        index=ROOT/'src'/kind/('models.json' if kind=='vrm_models' else 'animations.json')
        try:
            files=json.loads(index.read_text())
            if not isinstance(files,list) or not all(isinstance(file,str) and re.fullmatch(r'[\w .-]+'+re.escape(suffix),file,re.I) for file in files):raise ValueError('Invalid filenames')
        except (OSError,ValueError) as error:
            check(False,f'{index.relative_to(ROOT)}: {error}');continue
        if kind=='vrm_models':check(bool(files),'At least one indexed avatar')
        for filename in files:
            present=(index.parent/filename).is_file()
            check(present,f'{kind}/{filename}',optional=kind=='animations')
        if kind=='animations' and not (index.parent/'idle.fbx').is_file():
            print('WARN No idle animation; avatar uses its rest pose. See docs/assets.md.')
    try:
        fixture=json.loads((ROOT/'src/replay/benchmark.json').read_text())
        check(fixture.get('version')==1,'Replay fixture version 1')
        clips=fixture['turns']+[fixture['recall'],fixture['recall']['withoutMemory']]
        for clip in clips:
            audio=clip['speech']['audio']
            if not re.fullmatch(r'/replay/[\w-]+\.wav',audio):raise ValueError('Nonlocal fixture audio')
            check((ROOT/'src'/audio.lstrip('/')).is_file(),f'Fixture {audio}')
    except (OSError,ValueError,KeyError,TypeError) as error:check(False,f'Replay fixtures: {error}')
    if args.mode=='live':
        check(shutil.which(config.FFMPEG) is not None,'Configured ffmpeg executable',optional=config.LIP_SYNC!='rhubarb')
        check(Path(config.RHUBARB).is_file() and os.access(config.RHUBARB,os.X_OK),'Configured Rhubarb executable',optional=config.LIP_SYNC!='rhubarb')
        if config.LIP_SYNC=='dictionary':check((ROOT/'src/dictionary/cmudict.json').is_file(),'Optional dictionary (missing means neutral mouth)',optional=True)
        print(f'INFO Model key {config.CHAT_MODEL}; services were not contacted or started.')
    print('INFO Pinned browser libraries/font use CDNs; internet or cached copies are needed.')
    print(f'{len(errors)} blocking setup issue(s).')
    return bool(errors)

if __name__=='__main__':sys.exit(main())
