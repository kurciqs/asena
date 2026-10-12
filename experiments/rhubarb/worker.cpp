// Offline benchmark worker. Links Rhubarb's original recognition/animation
// libraries with the explicitly experimental patches applied by the builder.
// Reads a finite batch, exits at EOF, and is never started by the website.
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include "core/Shape.h"
#include "exporters/JsonExporter.h"
#include "lib/rhubarbLib.h"
#include "recognition/PocketSphinxRecognizer.h"
#include "tools/textFiles.h"

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    std::string mode(argv[2]);
    setenv("ASENA_PROFILE", "1", 1);
    if (mode.find("reuse") != std::string::npos) setenv("ASENA_REUSE_DECODER", "1", 1);
    if (mode.find("force") != std::string::npos) setenv("ASENA_FORCE_ALIGN", "1", 1);
    std::ifstream jobs(argv[1]);
    if (!jobs) return 2;
    PocketSphinxRecognizer recognizer;
    ShapeSet shapes(ShapeConverter::get().getBasicShapes());
    for (char ch : std::string("GHX")) shapes.insert(ShapeConverter::get().parse(std::string(1,ch)));
    JsonExporter exporter;
    std::string line;
    int count = 0;
    while (std::getline(jobs, line)) {
        if (++count > 200) return 2;
        std::istringstream fields(line);
        std::string id, audio, dialog;
        std::getline(fields,id,'\t'); std::getline(fields,audio,'\t'); std::getline(fields,dialog);
        if (id.empty() || audio.empty()) return 2;
        try {
            ProgressForwarder progress([](double) {});
            const auto before = std::chrono::steady_clock::now();
            const auto animation = animateWaveFile(audio,
                dialog.empty() ? boost::optional<std::string>() : readUtf8File(dialog),
                recognizer, shapes, 1, progress);
            const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now()-before).count();
            std::cout << "@ASENA_BEGIN\t" << id << "\t" << seconds << "\n";
            exporter.exportAnimation(ExporterInput(audio,animation,shapes), std::cout);
            std::cout << "@ASENA_END\n" << std::flush;
            std::cerr << "@ASENA_PROFILE_DONE\t" << id << "\n";
        } catch (const std::exception& error) {
            std::cerr << id << ": " << error.what() << "\n";
            return 1;
        }
    }
}
