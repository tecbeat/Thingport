// The badge in three dimensions, drawn with Thingport's own Three.js.
//
// The plate and the text are each their own mesh in their own colour, so a two-colour badge looks here the way it
// comes off the printer. It draws when something changes rather than every frame, so a still window costs nothing.

import { creasedGeometry } from "./meshNormals.js";

const HOME = { around: -60, up: 32, zoom: 1 };

/**
 * A viewer on one canvas. `three` is what `library("three")` gives. Returns null where the browser has no WebGL,
 * and the window then shows the figures without a picture.
 */
export function createViewer(three, canvas) {
  let renderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);

  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(36, 1, 0.1, 5000);
  const key = new three.DirectionalLight(0xffffff, 2.2);
  key.position.set(-0.4, -0.9, 1.1);
  const rim = new three.DirectionalLight(0xffffff, 0.7);
  rim.position.set(0.8, 0.6, 0.4);
  scene.add(key, rim, new three.AmbientLight(0xffffff, 1.1), new three.HemisphereLight(0xffffff, 0x404458, 1.2));

  const group = new three.Group();
  scene.add(group);

  const orbit = { ...HOME };
  const centre = new three.Vector3();
  let radius = 30;
  let frame = 0;
  let disposed = false;

  function place() {
    const upright = (camera.fov * Math.PI) / 180;
    const across = 2 * Math.atan(Math.tan(upright / 2) * Math.max(0.2, camera.aspect));
    const distance = (radius * 1.1) / Math.sin(Math.min(upright, across) / 2) / Math.max(0.15, orbit.zoom);
    const around = (orbit.around * Math.PI) / 180;
    const up = (orbit.up * Math.PI) / 180;
    camera.position.set(
      centre.x + distance * Math.cos(up) * Math.cos(around),
      centre.y + distance * Math.cos(up) * Math.sin(around),
      centre.z + distance * Math.sin(up),
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(centre);
    camera.near = Math.max(0.1, distance - radius * 4);
    camera.far = distance + radius * 6;
    camera.updateProjectionMatrix();
  }

  function draw() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(ratio);
    if (
      renderer.domElement.width !== Math.round(width * ratio) ||
      renderer.domElement.height !== Math.round(height * ratio)
    ) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / height;
    place();
    renderer.render(scene, camera);
  }

  const redraw = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  const turn = (around, up) => {
    orbit.around = (orbit.around + around) % 360;
    orbit.up = Math.max(-89.9, Math.min(89.9, orbit.up + up));
    redraw();
  };
  const zoom = (factor) => {
    orbit.zoom = Math.max(0.15, Math.min(10, orbit.zoom * factor));
    redraw();
  };

  let last = null;
  const down = (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    canvas.style.cursor = "grabbing";
  };
  const move = (event) => {
    if (!last) return;
    turn(-(event.clientX - last.x) * 0.5, (event.clientY - last.y) * 0.4);
    last = { x: event.clientX, y: event.clientY };
  };
  const up = () => {
    last = null;
    canvas.style.cursor = "";
  };
  const wheel = (event) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1 / 1.12 : 1.12);
  };
  const listeners = [
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", up],
  ];
  for (const [type, fn] of listeners) canvas.addEventListener(type, fn);
  canvas.addEventListener("wheel", wheel, { passive: false });
  const resize = new ResizeObserver(redraw);
  resize.observe(canvas);

  const empty = () => {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
  };

  const build = (model) => {
    const { positions, normals } = creasedGeometry(model.vertices, model.triangles);
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new three.BufferAttribute(normals, 3));
    return geometry;
  };

  const shade = (colour) =>
    new three.MeshStandardMaterial({ color: new three.Color(colour), roughness: 0.62, metalness: 0.02 });

  return {
    /** Shows the engine's solids. `colourOf(model)` gives each one its colour; `fit` recentres the camera. */
    show(models, { colourOf, fit = true } = {}) {
      empty();
      const box = new three.Box3();
      for (const model of models) {
        const geometry = build(model);
        const mesh = new three.Mesh(geometry, shade(colourOf?.(model) ?? "#b9c2cf"));
        group.add(mesh);
        geometry.computeBoundingBox();
        box.union(geometry.boundingBox);
      }
      if (!box.isEmpty() && fit) {
        box.getCenter(centre);
        radius = Math.max(6, box.getSize(new three.Vector3()).length() / 2);
      }
      redraw();
    },
    clear() {
      empty();
      redraw();
    },
    redraw,
    /** The canvas as a picture, for the cover of a saved model. */
    toBlob: (type = "image/png") =>
      new Promise((resolve) => {
        draw();
        canvas.toBlob(resolve, type);
      }),
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener("wheel", wheel);
      empty();
      renderer.dispose();
    },
  };
}
