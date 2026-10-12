"""Removable, single-job native Rhubarb Release build; never installs globally.

Run after downloading the official v1.14.0 checkout and pinned Boost archive
to .runtime/rhubarb-optimization/. All recognition/animation sources remain
unchanged. Build-only changes omit unrelated plugin packaging targets.
"""
import hashlib
import argparse
import json
import platform
import shutil
from pathlib import Path
import subprocess
import tarfile
from rhubarb_benchmark import WORK, guarded_run, save

BOOST_SHA256 = '7009fe1faa1697476bdc7027703a2badb84e849b7b0baad5086b087b971f8617'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tuned',action='store_true',help='Separate apple-m3 + ThinLTO build; not installed automatically')
    parser.add_argument('--no-lto',action='store_true',help='Use M3 tuning without ThinLTO; requires --tuned')
    args=parser.parse_args()
    source = WORK / 'upstream'
    revision=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    archive = WORK / 'boost_1_85_0.tar.bz2'
    headers = WORK / 'boost_1_85_0'
    if not (headers / 'boost/version.hpp').exists():
        if hashlib.sha256(archive.read_bytes()).hexdigest() != BOOST_SHA256:
            raise RuntimeError('Boost archive checksum mismatch')
        with tarfile.open(archive) as handle:
            handle.extractall(WORK, members=(m for m in handle
                              if m.name.startswith('boost_1_85_0/boost/')
                              or m.name == 'boost_1_85_0/LICENSE_1_0.txt'), filter='data')
    def original_file(relative):
        return subprocess.run(['git','-C',str(WORK/'upstream'),'show','HEAD:'+relative],
                              capture_output=True,text=True,check=True).stdout
    if args.tuned:
        source=WORK/'upstream-tuned'
        if not source.exists():
            shutil.copytree(WORK/'upstream',source,ignore=shutil.ignore_patterns('.git'))
    # Restore experiment-patched files before building any standard executable.
    for relative in ['rhubarb/CMakeLists.txt','rhubarb/src/recognition/PocketSphinxRecognizer.cpp',
                     'rhubarb/src/recognition/pocketSphinxTools.cpp']:
        (source/relative).write_text(original_file(relative))
    cmake = source / 'CMakeLists.txt'
    original = original_file('CMakeLists.txt')
    modified = original
    for target in ['extras/AdobeAfterEffects', 'extras/MagixVegas', 'extras/EsotericSoftwareSpine']:
        modified = modified.replace(f'add_subdirectory("{target}")', f'# Asena: omit unrelated extras "{target}"')
    cmake.write_text(modified)
    label=('native-m3' if args.no_lto else 'native-tuned') if args.tuned else 'native'
    build = WORK / ('build-arm64-m3' if args.no_lto else 'build-arm64-tuned' if args.tuned else 'build-arm64')
    flags='-O3 -DNDEBUG' + (' -mcpu=apple-m3' + ('' if args.no_lto else ' -flto=thin') if args.tuned else '')
    print('Configuring native Release build', flush=True)
    configuration = guarded_run(['cmake', '-S', str(source), '-B', str(build), '-G', 'Ninja',
                         '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=arm64',
                         '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0',
                         '-DCMAKE_C_FLAGS_RELEASE='+flags,
                         '-DCMAKE_CXX_FLAGS_RELEASE='+flags,
                         f'-DBOOST_ROOT={headers}', '-DBoost_NO_SYSTEM_PATHS=ON'],
                         name=label+'-configure', timeout=180)
    print('Building with one compile job', flush=True)
    compilation = guarded_run(['cmake', '--build', str(build), '--target', 'rhubarb', '--parallel', '1'],
                              name=label+'-build', timeout=900)
    binary = build / 'rhubarb/rhubarb'
    version = subprocess.run([str(binary), '--version'], capture_output=True, text=True, check=True).stdout.strip()
    save(WORK / (label+'-build.json'), {'source':'https://github.com/DanielSWolf/rhubarb-lip-sync',
         'revision':revision, 'tag':'v1.14.0', 'boostVersion':'1.85.0', 'boostSha256':BOOST_SHA256,
         'binary':str(binary), 'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
         'machine':platform.machine(), 'version':version, 'configure':configuration,
         'build':compilation, 'flags':flags,'sourceChanges':'CMake excludes unrelated plugin extras only'})
    print(version, 'native build finished.', flush=True)


if __name__ == '__main__':
    main()
