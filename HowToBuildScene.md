# How to Build a Scene

## Loading a model

- Get a `.glb` model from [poly.pizza](https://poly.pizza) (free, no account).
- In **your fork** on GitHub, open the `assets` folder → **Add file → Upload
  files** → drop the `.glb` in → commit.
- Add an entity for it inside the `#world` entity in `scene.html`.

## Writing it

Everything goes inside `#world`. Inside it, **1 unit = 1 metre**.

```html
<a-entity
  gltf-model="./assets/{your model}.glb"
  fit-model="size: {size}"
  position="{x} {y} {z}"
  rotation="{pitch} {yaw} {roll}">
</a-entity>
```

- `gltf-model` — the file you uploaded. Only the file name changes.
- `fit-model="size: ..."` — how big the model ends up, in metres.
  `0.25` = 25 cm across, whatever units the model was made in.
- `position="x y z"` — metres from the marker. `+X` right, `+Y` up in the
  air, **away from you is `-Z`**. The desk surface is `y = 0`, and models
  stand on their base, so `y` stays `0` to keep it on the desk.
- `rotation="x y z"` — degrees, around the model's own position.
  `"0 45 0"` turns it 45° counter-clockwise seen from above.
- Repeat the whole `<a-entity>...</a-entity>` block for every model —
  same file or different ones.

## Primitives

Simple shapes need no model file — one tag each:

```html
<a-box color="#4a8f3c" position="0 -0.01 0" width="0.5" height="0.02" depth="0.5"></a-box>
<a-sphere color="#ffcc00" position="0.2 0.05 0" radius="0.05"></a-sphere>
<a-cylinder color="#886644" position="-0.2 0.1 0" radius="0.02" height="0.2"></a-cylinder>
```

- Sizes and positions are metres, like everything else inside `#world`.
- Primitives are placed by their CENTRE: a 10 cm box resting on the desk
  needs `position` y = `0.05`, not `0`.
- Others that work the same way: `<a-cone>`, `<a-torus>`, `<a-plane>`,
  `<a-ring>`. `color` takes any CSS colour.
