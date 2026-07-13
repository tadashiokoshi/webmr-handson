/* stage3.js — all the machinery behind stage3.html, kept out of the page
 * so the scene markup stays readable. Nothing in here needs editing to
 * build a scene, with ONE exception: MARKER_WIDTH_M, just below. */

// The printed target image is 120 mm wide (markers.html at 100% scale,
// white border included). Everything metric on this page — the size of
// #world and the IMU maths — derives from this one constant. If you
// calibrated your marker in stage 2, use the same value here.
const MARKER_WIDTH_M = 0.12;

// Safari reports devicemotion acceleration with the opposite sign to
// the spec (and to Android).
const ACCEL_SIGN = /iPhone|iPad|iPod/.test(navigator.userAgent) ? -1 : 1;

/* real-units — makes 1 unit = 1 metre for everything inside this
 * entity. In a marker's local frame 1 unit is one marker width, so the
 * conversion is just 1 / (the marker's physical width). */
AFRAME.registerComponent('real-units', {
  init: function () {
    this.el.object3D.scale.setScalar(1 / MARKER_WIDTH_M);
  }
});

/* fit-model — same component as stage 1: measures a .glb and scales it
 * so its biggest dimension ends up `size`, then stands it on the
 * surface. Inside #world, `size` is in metres. */
AFRAME.registerComponent('fit-model', {
  schema: {
    size: { type: 'number', default: 0.25 }
  },

  init: function () {
    this.info = document.querySelector('#model-info');
    this.el.addEventListener('model-loaded', (e) => this.onLoad(e.detail.model));
    this.el.addEventListener('model-error', () => {
      this.report('could not load the model.\ncheck the file name, and that it really is in assets/', true);
    });
  },

  report: function (text, isError) {
    this.info.textContent = text;
    this.info.classList.toggle('error', !!isError);
  },

  measure: function (model) {
    const box = new THREE.Box3();
    const part = new THREE.Box3();

    const walk = (obj, parentMatrix) => {
      obj.updateMatrix();
      const matrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, obj.matrix);
      if (obj.geometry) {
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        part.copy(obj.geometry.boundingBox).applyMatrix4(matrix);
        box.union(part);
      }
      obj.children.forEach((child) => walk(child, matrix));
    };
    walk(model, new THREE.Matrix4());

    return box;
  },

  onLoad: function (model) {
    const box = this.measure(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const biggest = Math.max(size.x, size.y, size.z);
    if (!(biggest > 0)) {
      this.report('the model loaded but has no size. is it empty?', true);
      return;
    }

    this.el.object3D.scale.setScalar(this.data.size / biggest);

    const centre = new THREE.Vector3();
    box.getCenter(centre);
    model.position.x -= centre.x;
    model.position.z -= centre.z;
    model.position.y -= box.min.y;

    this.report(
      'this model is ' + biggest.toFixed(1) + ' units across, scaled by ' +
      (this.data.size / biggest).toFixed(4) + '.'
    );
  }
});

/* imu-fusion — same component as stage 2, and the reason your scene
 * survives losing the marker. Marker visible: adopt its pose and wipe
 * the IMU drift. Marker lost: hold the last pose, coasting on the
 * phone's orientation sensors so you can look around the scene.
 * See stage2.html for the full story. */
AFRAME.registerComponent('imu-fusion', {
  schema: {
    anchor: { type: 'selector' }
  },

  init: function () {
    const o = this.el.object3D;
    o.visible = false;
    // Same trick MindAR itself uses: we own this matrix, nothing else
    // composes it from position/rotation/scale attributes.
    o.matrixAutoUpdate = false;

    this.rotationOn = false;
    this.translationOn = false;

    this.hasFix = false;
    this.M0 = new THREE.Matrix4();      // marker pose at the last sighting
    this.q0 = new THREE.Quaternion();   // camera orientation at that moment
    this.unitsPerMetre = 1;

    this.qCam = new THREE.Quaternion(); // camera orientation, live from the IMU
    this.haveOrientation = false;
    this.vel = new THREE.Vector3();     // world-frame velocity (m/s)
    this.disp = new THREE.Vector3();    // world-frame drift since the fix (m)

    // scratch objects, allocated once — tick runs 60 times a second
    this._euler = new THREE.Euler();
    this._qScreen = new THREE.Quaternion();
    // -90° about X: the sensors' Z-up earth frame → three.js Y-up world
    this._qEarth = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    this._zee = new THREE.Vector3(0, 0, 1);
    this._dR = new THREE.Quaternion();
    this._qInv = new THREE.Quaternion();
    this._t = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._dT = new THREE.Matrix4();
    this._a = new THREE.Vector3();

    this.onOrientation = this.onOrientation.bind(this);
    this.onMotion = this.onMotion.bind(this);
  },

  // Ask iOS for sensor permission (only works inside a button tap), then
  // start listening. Android has nothing to ask.
  enable: function () {
    const asks = [];
    if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) {
      asks.push(DeviceOrientationEvent.requestPermission());
    }
    if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) {
      asks.push(DeviceMotionEvent.requestPermission());
    }
    return Promise.all(asks).then((answers) => {
      if (answers.some((a) => a !== 'granted')) throw new Error('permission denied');
      window.addEventListener('deviceorientation', this.onOrientation);
      window.addEventListener('devicemotion', this.onMotion);
    });
  },

  screenAngle: function () {
    return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  },

  // Orientation sensors → camera orientation in a Y-up world.
  onOrientation: function (e) {
    if (e.alpha === null) return;
    const rad = THREE.MathUtils.degToRad;
    this._euler.set(rad(e.beta), rad(e.alpha), -rad(e.gamma), 'YXZ');
    this.qCam.setFromEuler(this._euler);
    this.qCam.multiply(this._qEarth);
    this.qCam.multiply(this._qScreen.setFromAxisAngle(this._zee, -rad(this.screenAngle())));
    this.haveOrientation = true;
  },

  // Accelerometer → velocity → displacement (unused unless translation
  // coasting is switched on — stage 2 shows why it is off here).
  onMotion: function (e) {
    const a = e.acceleration; // gravity already removed by the OS
    if (!a || a.x === null || !this.haveOrientation) return;
    let dt = e.interval || 1 / 60;
    if (dt > 1) dt = dt / 1000;         // spec says ms, some browsers send seconds
    if (!(dt > 0) || dt > 0.1) return;  // a hiccup — integrating it only makes it worse
    this._a.set(a.x, a.y, a.z).multiplyScalar(ACCEL_SIGN);
    this._a.applyQuaternion(this._qScreen.setFromAxisAngle(this._zee, THREE.MathUtils.degToRad(this.screenAngle())));
    this._a.applyQuaternion(this.qCam);
    this.vel.addScaledVector(this._a, dt);
    this.disp.addScaledVector(this.vel, dt);
  },

  tick: function () {
    const anchorObj = this.data.anchor.object3D;
    const o = this.el.object3D;

    if (anchorObj.visible) {
      // CORRECT: the marker is the truth. Adopt its pose, wipe the drift.
      o.matrix.copy(anchorObj.matrix);
      this.M0.copy(anchorObj.matrix);
      this.q0.copy(this.qCam);
      this.unitsPerMetre = this.M0.getMaxScaleOnAxis() / MARKER_WIDTH_M;
      this.vel.set(0, 0, 0);
      this.disp.set(0, 0, 0);
      this.hasFix = true;
      o.visible = true;
      return;
    }

    if (!this.hasFix) return; // never seen the marker yet: nothing to hold

    // PREDICT: start from the remembered pose, apply the IMU deltas.
    if (this.rotationOn && this.haveOrientation) {
      this._dR.copy(this.qCam).invert().multiply(this.q0);
    } else {
      this._dR.identity();
    }
    this._t.set(0, 0, 0);
    if (this.translationOn && this.haveOrientation) {
      this._t.copy(this.disp)
        .multiplyScalar(-this.unitsPerMetre)
        .applyQuaternion(this._qInv.copy(this.qCam).invert());
    }
    this._dT.compose(this._t, this._dR, this._one);
    o.matrix.multiplyMatrices(this._dT, this.M0);
  }
});

// ---- page wiring: the status line and the IMU button ----
window.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const anchor = document.querySelector('#anchor');
  const fusedEl = document.querySelector('#fused');
  const btnImu = document.getElementById('btn-imu');

  const fusion = () => fusedEl.components['imu-fusion'];

  let markerVisible = false;
  anchor.addEventListener('targetFound', () => { markerVisible = true; });
  anchor.addEventListener('targetLost', () => { markerVisible = false; });

  btnImu.addEventListener('click', () => {
    fusion().enable().then(() => {
      fusion().rotationOn = true;   // no toggles here: stage 2 was the lesson
      btnImu.disabled = true;
      btnImu.textContent = 'IMU: on';
    }).catch((err) => {
      btnImu.textContent = 'IMU blocked (' + err.message + ')';
    });
  });

  setInterval(() => {
    const f = fusion();
    if (!f) return;
    if (markerVisible) {
      status.textContent = '✅ Tracking Marker A';
    } else if (!f.hasFix) {
      status.textContent = 'Looking for the marker…';
    } else if (f.rotationOn && f.haveOrientation) {
      status.textContent = '❌ Marker lost — coasting on IMU, look around';
    } else {
      status.textContent = '❌ Marker lost — frozen (enable IMU to look around)';
    }
  }, 100);
});
