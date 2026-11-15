# PlayGround

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/mikeemory2005-blip/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/mikeemory2005-blip/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/mikeemory2005-blip/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/mikeemory2005-blip/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/mikeemory2005-blip/PlayGround).
- 🛠️ [Check build runs](https://github.com/mikeemory2005-blip/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/mikeemory2005-blip/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/mikeemory2005-blip).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->

## Narration

Storyverse uses the pretrained [Kokoro 82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) text-to-speech model through `kokoro-js` in the browser (`q8` weights, WASM runtime). On first playback, the browser downloads the library and model assets from public CDNs; speech generation then runs locally. No story text is sent to a Storyverse backend. This is inference with an existing pretrained model—not model training. An internet connection is required for the initial download.
