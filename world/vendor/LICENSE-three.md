# Vendored third-party code

## three.js — r169 (npm `three@0.169.0`)

* License: MIT (see `three/LICENSE`, copied verbatim from the package).
* Copyright © 2010-2024 three.js authors.
* Upstream: <https://github.com/mrdoob/three.js>

Vendored on 2026-10-11 by downloading the published npm package files from
unpkg, unmodified and non-minified. The non-minified build is deliberate: the
world bundler concatenates real identifier names, so a minified build would
break the `import`-stripping strategy in `world/bundle.mjs`.

### Files

| Path in this repo | Upstream path (`three@0.169.0`) |
| --- | --- |
| `three/three.module.js` | `build/three.module.js` |
| `three/LICENSE` | `LICENSE` |
| `addons/controls/OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` |
| `addons/postprocessing/EffectComposer.js` | `examples/jsm/postprocessing/EffectComposer.js` |
| `addons/postprocessing/MaskPass.js` | `examples/jsm/postprocessing/MaskPass.js` |
| `addons/postprocessing/OutputPass.js` | `examples/jsm/postprocessing/OutputPass.js` |
| `addons/postprocessing/Pass.js` | `examples/jsm/postprocessing/Pass.js` |
| `addons/postprocessing/RenderPass.js` | `examples/jsm/postprocessing/RenderPass.js` |
| `addons/postprocessing/ShaderPass.js` | `examples/jsm/postprocessing/ShaderPass.js` |
| `addons/postprocessing/UnrealBloomPass.js` | `examples/jsm/postprocessing/UnrealBloomPass.js` |
| `addons/shaders/CopyShader.js` | `examples/jsm/shaders/CopyShader.js` |
| `addons/shaders/LuminosityHighPassShader.js` | `examples/jsm/shaders/LuminosityHighPassShader.js` |
| `addons/shaders/OutputShader.js` | `examples/jsm/shaders/OutputShader.js` |

`MaskPass.js`, `Pass.js` and `OutputShader.js` are not requested directly by the
runtime; they are vendored because `EffectComposer.js`, `ShaderPass.js`,
`RenderPass.js`, `UnrealBloomPass.js` and `OutputPass.js` import them.

Every file keeps its original contents, including license headers. Nothing in
`world/vendor/` is edited; `world/bundle.mjs` strips module syntax at build time
only, in memory.

### Refreshing

```sh
V=0.169.0
curl -sfL "https://unpkg.com/three@$V/build/three.module.js" -o world/vendor/three/three.module.js
curl -sfL "https://unpkg.com/three@$V/LICENSE" -o world/vendor/three/LICENSE
# then each examples/jsm path from the table above
```
