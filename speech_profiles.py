"""Named timing policies; loading validates data and starts no services."""
import json
from pathlib import Path


def load_speech_profile(path, selected=None):
    catalog=json.loads(Path(path).read_text())
    if catalog.get('version') != 1 or not isinstance(catalog.get('profiles'),dict):
        raise RuntimeError('Invalid speech timing profile catalog')
    selected=catalog.get('default') if selected is None else selected
    if not isinstance(selected,str) or selected not in catalog['profiles']:
        raise RuntimeError('Unknown ASENA_SPEECH_PROFILE')
    profile=catalog['profiles'][selected]
    if (not isinstance(profile,dict) or set(profile)!={'label','policy','openingSeconds','startupSeconds','strategy'}
            or not isinstance(profile['label'],str) or not profile['label']
            or profile['strategy'] not in ('whole','phrases','sentences')
            or profile['policy'] not in ('1s','2s','3s')
            or type(profile['openingSeconds']) not in (int,float) or profile['openingSeconds'] not in (.5,1,2)
            or type(profile['startupSeconds']) not in (int,float) or profile['startupSeconds'] not in (.5,1,2,4)):
        raise RuntimeError('Invalid speech timing profile settings')
    return {'id':selected,'version':catalog['version'],**profile}
