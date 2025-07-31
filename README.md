# asena

it's a working progress, but i've decided to commit the first semi-stable version. it's basically an lmstudio -> kokoro tts -> rhubarb -> three.js wrapper that is supposed to mimic grok [ani](https://www.reddit.com/r/grok/comments/1m7yg3o/just_tried_groks_new_ai_companion_ani_its_kinda/). i know my chances are slim but i'll try anyway. the main bottleneck at the moment is my local computing power. i need about 30 seconds to generate 10 words which is terrible. it can be cut back a lot by skipping rhubarb and faking the visemes but then it just looks goofy. 

the plan forward is to rewrite it using streaming from kokoro and faking visemes as i go along. then the only latency would be waiting for the llm response but that's basically always sub-5-seconds.

i also apologise to frontend devs for that amazing gui haha.

that aside, if this works and is sufficiently fast, you can only imagine the power. the fact that it's running locally means that noone is datamining you, the fact that you get to pick your llm means you can go as wild as you want with requests. plus it's entirely free and based open source so you can add features or play around with it. 

# installation

it's seriously a pain, i recommend waiting until i bring out a stable release (if ever). you'll need docker with [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI/tree/master) installed, as well as lmstudio. you can configure and choose the chatbot by editing the lms request in main.js. you'll need to have rhubarb installed and exactly in the directory as the project folder (working on making that a little less scuffed haha). 

you'll need node.js, three.js, three-vrm i think and flask for backend python. maybe i'll specify the exact dependencies later. you start the server with serve . and python3 proxy.py

last but not least, you'll need animations and vrm models. load whatever mixamo animations you want into animations/ and models created with [vroid studio](https://hub.vroid.com/en/search/%23VRoidStudio) into vrm_models/.  

it probably won't run anywhere outside of my computer for now, but i'll maybe work on an installation system later.

# todo

- [ ] clean up
- [ ] rewrite for streaming
- [ ] action system, let ai control the animations
- [ ] memory system
- [ ] better llm
- [ ] system prompt

# img

![asena in action](image.png)
