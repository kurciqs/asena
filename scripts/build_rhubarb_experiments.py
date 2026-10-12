"""Build isolated profiling/reuse/forced-alignment prototypes, never production.

Requires the native build first. The original binary is preserved. Patches are
generated from the pinned checkout, saved as a diff, and remain removable.
"""
import shutil
import subprocess
from pathlib import Path
from rhubarb_benchmark import ROOT, WORK, guarded_run, save


TIMER = r'''
#pragma once
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <mutex>
struct AsenaTimer {
    const char* name;
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
    explicit AsenaTimer(const char* name): name(name) {}
    ~AsenaTimer() {
        if (!std::getenv("ASENA_PROFILE")) return;
        static std::mutex mutex;
        std::lock_guard<std::mutex> lock(mutex);
        std::cerr << "@ASENA_PROFILE\t" << name << "\t"
                  << std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count() << "\n";
    }
};
'''

REUSE = r'''
static lambda_unique_ptr<ps_decoder_t> createDecoder(optional<std::string> dialog) {
    if (!std::getenv("ASENA_REUSE_DECODER")) return createDecoderCold(dialog);
    // Offline single-worker experiment. No unbounded concurrent decoder pool.
    static thread_local std::shared_ptr<ps_decoder_t> cached;
    static thread_local optional<std::string> previousDialog;
    if (!cached) {
        cached = std::shared_ptr<ps_decoder_t>(createDecoderCold(dialog).release(),
                                               [](ps_decoder_t* p) { ps_free(p); });
    } else if (dialog != previousDialog && !std::getenv("ASENA_FORCE_ALIGN")) {
        AsenaTimer timer("rebias");
        auto model = dialog ? createBiasedLanguageModel(*cached, *dialog)
                            : createDefaultLanguageModel(*cached);
        if (ps_set_lm(cached.get(), "lm", model.get()) < 0 || ps_set_search(cached.get(), "lm") < 0)
            throw runtime_error("Could not update reused decoder language model");
    }
    previousDialog = dialog;
    return lambda_unique_ptr<ps_decoder_t>(cached.get(), [](ps_decoder_t*) {});
}

'''

FORCE = r'''
    AsenaTimer total("recognize_total");
    if (dialog && std::getenv("ASENA_FORCE_ALIGN")) {
        // Still acoustic phone alignment, not equal-duration dictionary cues.
        // Experimental: exact transcript correctness and silence handling matter.
        auto decoder = createDecoder(dialog);
        auto words = tokenizeText(*dialog, [&](const string& word) {
            return dictionaryContains(*decoder->dict, word);
        });
        addMissingDictionaryWords(words, *decoder);
        vector<s3wid_t> ids;
        ids.push_back(getWordId("<s>", *decoder->dict));
        for (const auto& word : words) ids.push_back(getWordId(word, *decoder->dict));
        ids.push_back(getWordId("</s>", *decoder->dict));
        auto clip = inputAudioClip.clone() | removeDcOffset() | resample(sphinxSampleRate);
        const auto buffer = copyTo16bitBuffer(*clip);
        auto aligned = getPhoneAlignment(ids, buffer, *decoder);
        if (!aligned || words.empty()) throw runtime_error("Known-text alignment found no path");
        BoundedTimeline<Phone> result(inputAudioClip.getTruncatedRange());
        for (const auto& phone : *aligned) result.set(phone);
        progressSink.reportProgress(1.0);
        return result;
    }
'''


def replace_once(value, before, after):
    if value.count(before) != 1:
        raise RuntimeError('Pinned source patch no longer matches: ' + before[:100])
    return value.replace(before, after, 1)


def main():
    source = WORK / 'upstream'
    build = WORK / 'build-arm64'
    baseline = WORK / 'native-baseline'
    if not (baseline / 'rhubarb').exists():
        baseline.mkdir(exist_ok=True)
        shutil.copy2(build / 'rhubarb/rhubarb', baseline / 'rhubarb')
        (baseline / 'res').symlink_to(build / 'rhubarb/res', target_is_directory=True)
    def original(relative):
        return subprocess.run(['git','-C',str(source),'show','HEAD:'+relative],
                              capture_output=True,text=True,check=True).stdout
    relative = 'rhubarb/src/recognition/PocketSphinxRecognizer.cpp'
    text = original(relative)
    text = '#include "asenaExperimentTimer.h"\n#include "audio/DcOffset.h"\n' + text
    text = replace_once(text, 'static lambda_unique_ptr<ps_decoder_t> createDecoder(optional<std::string> dialog) {',
                        'static lambda_unique_ptr<ps_decoder_t> createDecoderCold(optional<std::string> dialog) {\n\tAsenaTimer timer("decoder_cold");')
    text = replace_once(text, '\t// Set language model\n', '\t// Known-text experiment does not require a word-search language model.\n\tif (std::getenv("ASENA_FORCE_ALIGN")) return decoder;\n\n\t// Set language model\n')
    text = replace_once(text, 'optional<Timeline<Phone>> getPhoneAlignment(', REUSE + 'optional<Timeline<Phone>> getPhoneAlignment(')
    text = replace_once(text, '\tif (wordIds.empty()) return boost::none;', '\tAsenaTimer timer("phone_alignment");\n\tif (wordIds.empty()) return boost::none;')
    text = replace_once(text, '\tBoundedTimeline<string> words = recognizeWords(audioBuffer, decoder);', '\tBoundedTimeline<string> words;\n\t{ AsenaTimer timer("word_search"); words = recognizeWords(audioBuffer, decoder); }')
    text = replace_once(text, '\treturn ::recognizePhones(\n', FORCE + '\n\treturn ::recognizePhones(\n')
    (source / relative).write_text(text)
    (source / 'rhubarb/src/recognition/asenaExperimentTimer.h').write_text(TIMER)
    relative = 'rhubarb/src/recognition/pocketSphinxTools.cpp'
    text = '#include "asenaExperimentTimer.h"\n' + original(relative)
    text = replace_once(text, '\t\tutterances = detectVoiceActivity(*audioClip, voiceActivationProgressSink);', '\t\tAsenaTimer timer("vad");\n\t\tutterances = detectVoiceActivity(*audioClip, voiceActivationProgressSink);')
    (source / relative).write_text(text)
    cmake = source / 'rhubarb/CMakeLists.txt'
    cmake.write_text(original('rhubarb/CMakeLists.txt') + '\nadd_executable(asena-rhubarb-worker "' + str(ROOT/'experiments/rhubarb/worker.cpp') + '")\ntarget_link_libraries(asena-rhubarb-worker rhubarb-exporters rhubarb-lib)\n')
    changes = subprocess.run(['git','-C',str(source),'diff','--','CMakeLists.txt','rhubarb/CMakeLists.txt',
                              'rhubarb/src/recognition/PocketSphinxRecognizer.cpp',
                              'rhubarb/src/recognition/pocketSphinxTools.cpp'],capture_output=True,text=True,check=True).stdout
    (WORK/'experiment-source.patch').write_text(changes)
    configure = guarded_run(['cmake','-S',str(source),'-B',str(build)],name='experiment-configure',timeout=180)
    compiled = guarded_run(['cmake','--build',str(build),'--target','rhubarb','asena-rhubarb-worker','--parallel','1'],
                           name='experiment-build',timeout=180)
    save(WORK/'experiment-build.json',{'configure':configure,'build':compiled,
         'originalBinary':str(baseline/'rhubarb'),'worker':str(build/'rhubarb/asena-rhubarb-worker')})
    print('Profiling, finite-batch decoder reuse and known-text alignment prototypes built.',flush=True)


if __name__ == '__main__':
    main()
