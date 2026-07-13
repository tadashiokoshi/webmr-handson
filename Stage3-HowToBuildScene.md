# How to Build a Scene (Stage 3)

## Loading a model

- Get a `.glb` model from [poly.pizza](https://poly.pizza) (free, no account).
- In **your fork** on GitHub, open the `assets` folder → **Add file → Upload
  files** → drop the `.glb` in → commit.
- Add an entity for it inside the `#world` entity in `stage3.html`.

## Writing it

Everything goes inside `#world`. Inside it, **1 unit = 1 metre**.

```html
<a-entity id="world" real-units>

  <a-entity
    gltf-model="./assets/Wolf.glb"
    fit-model="size: 0.25"
    position="0.30 0 -0.20"
    rotation="0 45 0">
  </a-entity>

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
