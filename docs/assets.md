# Avatar and animation assets

The clean checkout includes `src/vrm_models/asena_sfw.vrm` and `models.json`. This avatar was created by the project author in VRoid Studio and permitted for use. For your own avatar, export VRM from VRoid Studio, copy it into that folder, and add its simple filename to `models.json`. No directory paths belong in either asset index.

The repository excludes user-supplied Mixamo FBX files. You can replay with no FBX files: the avatar stays in its rest pose, mouth/expression tracks still work, and unavailable gestures are skipped. Add idle first for a moving baseline.

## Mixamo export and naming

Use your own account on [Mixamo](https://www.mixamo.com/), select a standard Mixamo character such as X Bot, and search for the desired motion. Export **FBX Binary (.fbx)**, **Without Skin**, **30 FPS**, with **no keyframe reduction**. If a locomotion clip offers **In Place**, enable it for this stationary scene. Preserve the original Mixamo skeleton (`mixamorigHips` and `mixamorig...` bone names); do not rename bones or export a VRM-targeted rig from Blender. Rename only the downloaded file and copy it under `src/animations/`.

These are recommended searches for a reproducible starter set, not claims about the exact catalog entries used for the author's old local clips. The old files lack recorded source IDs; chosen variants should be recorded alongside their filename if you need exact visual reproduction.

| Search on Mixamo | Save as | Use |
| --- | --- | --- |
| Idle | `idle.fbx` | Baseline loop |
| Waving | `wave.fbx` | Greeting |
| Head Shake / Annoyed Head Shake | `head_shake.fbx` | Disagreement |
| Head Nod | `head_nod.fbx` | Agreement |
| Shrugging | `shrugging.fbx` | Showcase |
| Thinking | `thinking.fbx` | Optional gesture |
| Talking | `talking.fbx` | Optional gesture |

The existing `animations.json` also indexes `catwalk`, `backflip`, `humming`, `hands_crossed`, `frowning`, `thanking` and `sigh`. They are testing placeholders and optional. Choose corresponding motions, save with exactly those filenames, or leave them absent/remove their index entries. Asset keys come from the filename without `.fbx`; the parser's registered actions use those keys. Do not redistribute downloaded FBX files through this repository.

## Automatic conversion

`src/load_mixamo_animation.js` loads the first FBX animation with Three.js, maps Mixamo bones through `mixamo_vrm_rig_map.js`, retargets rotations from the source rest pose to VRM normalized bones, scales hip translation by relative hip heights, and applies VRM0 axis corrections when required. It creates the playable clip in the browser; there is no separate pre-conversion command. Unsupported skeletons, no animation tracks or invalid hip height become explicit missing-clip errors.

The loader attempts idle first, limits optional conversions to three at a time and applies deadlines. Settings/inspector expose missing clips, load duration, selected model and the registered current clip name. The previous avatar survives a failed replacement. Run `python scripts/check_setup.py --mode replay` to find missing files without starting the renderer or any services. Download/export details can also be checked against [Adobe's Mixamo help](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html).
