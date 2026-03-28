import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

interface SceneViewerProps {
  spzUrl: string;
  colliderMeshUrl?: string;
  showDebug?: boolean; // default true — shows grid, axes, camera pos. Set false for demo.
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

export default function SceneViewer({ spzUrl, colliderMeshUrl, showDebug = true, onCanvasReady }: SceneViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [cameraInfo, setCameraInfo] = useState({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, sceneSize: 0 });

  useEffect(() => {
    if (!containerRef.current || !spzUrl) return;

    cleanupRef.current?.();
    cleanupRef.current = null;

    let cancelled = false;

    async function init() {
      const container = containerRef.current!;

      // ─── Main scene ───
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111111);

      const camera = new THREE.PerspectiveCamera(
        70,
        container.clientWidth / container.clientHeight,
        0.001,
        1000
      );

      // preserveDrawingBuffer allows canvas.toDataURL() to work for frame capture.
      // Minor GPU optimization trade-off; acceptable at our render rate.
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.autoClear = false;
      container.appendChild(renderer.domElement);
      onCanvasReady?.(renderer.domElement);

      const sparkRenderer = new SparkRenderer({ renderer });
      scene.add(sparkRenderer);

      const splatMesh = new SplatMesh({ url: spzUrl });
      await splatMesh.initialized;

      // World Labs OpenCV → Three.js OpenGL coordinate transform
      splatMesh.scale.set(1, -1, -1);
      splatMesh.opacity = 1.5;
      scene.add(splatMesh);

      if (cancelled) {
        renderer.dispose();
        container.removeChild(renderer.domElement);
        return;
      }

      // ─── Compute scene bounds ───
      const bbox = splatMesh.getBoundingBox();
      const bboxCenter = new THREE.Vector3();
      const bboxSize = new THREE.Vector3();
      let sceneSize = 1;

      if (bbox && !bbox.isEmpty()) {
        bbox.getCenter(bboxCenter);
        bbox.getSize(bboxSize);
        sceneSize = bboxSize.length();
        console.log("[SceneViewer] bbox center:", bboxCenter.toArray().map(v => v.toFixed(3)),
          "size:", bboxSize.toArray().map(v => v.toFixed(3)), "diagonal:", sceneSize.toFixed(3));
      }

      // Transform center to match Y/Z flip
      const center = new THREE.Vector3(bboxCenter.x, -bboxCenter.y, -bboxCenter.z);

      // ─── Debug helpers: grid + axes (rendered AFTER splats via renderOrder) ───
      const debugGroup = new THREE.Group();
      debugGroup.visible = showDebug;

      // Grid at ground plane
      const gridSize = Math.max(sceneSize * 3, 5);
      const grid = new THREE.GridHelper(gridSize, 30, 0x555555, 0x333333);
      const groundY = center.y - bboxSize.y / 2;
      grid.position.set(center.x, groundY, center.z);
      grid.renderOrder = 999;
      (grid.material as THREE.Material).depthTest = false;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.4;
      debugGroup.add(grid);

      // Axes at scene center
      const axesSize = Math.max(sceneSize * 0.4, 0.5);
      const axes = new THREE.AxesHelper(axesSize);
      axes.position.copy(center);
      axes.renderOrder = 1000;
      axes.material.depthTest = false;
      debugGroup.add(axes);

      scene.add(debugGroup);

      // ─── XYZ Orientation gizmo (bottom-right corner) ───
      const gizmoScene = new THREE.Scene();
      const gizmoSize = 120;
      const gizmoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
      gizmoCamera.position.set(0, 0, 3);
      gizmoCamera.lookAt(0, 0, 0);

      // Group that rotates to match camera
      const gizmoGroup = new THREE.Group();
      gizmoScene.add(gizmoGroup);

      const gizmoAxes = new THREE.AxesHelper(1);
      gizmoAxes.material.depthTest = false;
      gizmoGroup.add(gizmoAxes);

      // Labeled axis endpoints
      const axisLabels: [string, number[], number][] = [
        ["X", [1.4, 0, 0], 0xff4444],
        ["Y", [0, 1.4, 0], 0x44ff44],
        ["Z", [0, 0, 1.4], 0x4488ff],
      ];
      for (const [text, pos, color] of axisLabels) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
        ctx.font = "bold 44px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 32, 32);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(pos[0], pos[1], pos[2]);
        sprite.scale.set(0.5, 0.5, 1);
        gizmoGroup.add(sprite);

        // Small sphere at axis tip
        const dotGeo = new THREE.SphereGeometry(0.12, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(pos[0] * 0.72, pos[1] * 0.72, pos[2] * 0.72);
        dot.renderOrder = 1001;
        gizmoGroup.add(dot);
      }

      // Origin sphere
      const originGeo = new THREE.SphereGeometry(0.1, 12, 12);
      const originMat = new THREE.MeshBasicMaterial({ color: 0x888888, depthTest: false });
      const origin = new THREE.Mesh(originGeo, originMat);
      origin.renderOrder = 1001;
      gizmoGroup.add(origin);

      // ─── Collider mesh (used for camera collision) ───
      let colliderMeshes: THREE.Mesh[] = [];
      const colliderRaycaster = new THREE.Raycaster();
      const collisionRadius = 0.15; // min distance from walls

      if (colliderMeshUrl) {
        const loader = new GLTFLoader();
        try {
          const gltf = await new Promise<any>((resolve, reject) => {
            loader.load(colliderMeshUrl, resolve, undefined, reject);
          });
          const colliderGroup = gltf.scene;
          // Same OpenCV → OpenGL coordinate flip
          colliderGroup.scale.set(1, -1, -1);
          scene.add(colliderGroup);
          // Update world matrices AFTER adding to scene
          colliderGroup.updateMatrixWorld(true);

          colliderGroup.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              // Wireframe in debug, fully transparent otherwise (must stay visible for raycasting)
              mesh.material = new THREE.MeshBasicMaterial({
                wireframe: showDebug,
                color: 0x00ff00,
                transparent: true,
                opacity: showDebug ? 0.15 : 0,
                depthWrite: false,
              });
              mesh.renderOrder = 998;
              colliderMeshes.push(mesh);
            }
          });
          console.log(`[SceneViewer] Collider mesh loaded: ${colliderMeshes.length} meshes`);
        } catch (e) {
          console.warn("[SceneViewer] Failed to load collider mesh:", e);
        }
      }

      // ─── Camera start position ───
      // World Labs scenes have the camera origin near (0,0,0) looking into the scene.
      // Start close to origin, slightly above, looking forward.
      camera.position.set(0, 0.16, -0.27);

      // ─── First-person controls ───
      let yaw = Math.PI;
      let pitch = 0;
      let isPointerDown = false;
      let prevX = 0;
      let prevY = 0;

      const moveSpeed = sceneSize * 0.001;
      const lookSpeed = 0.0015;

      function updateCameraRotation() {
        const q = new THREE.Quaternion();
        q.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
        camera.quaternion.copy(q);
      }
      updateCameraRotation();

      const onPointerDown = (e: PointerEvent) => {
        isPointerDown = true;
        prevX = e.clientX;
        prevY = e.clientY;
        container.style.cursor = "grabbing";
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!isPointerDown) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;
        yaw -= dx * lookSpeed;
        pitch -= dy * lookSpeed;
        pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
        updateCameraRotation();
      };
      const onPointerUp = () => {
        isPointerDown = false;
        container.style.cursor = "grab";
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const scrollMove = fwd.multiplyScalar(-e.deltaY * moveSpeed * 0.5);

        if (scrollMove.length() > 0 && colliderMeshes.length > 0) {
          const dir = scrollMove.clone().normalize();
          colliderRaycaster.set(camera.position, dir);
          colliderRaycaster.far = collisionRadius + scrollMove.length();
          const hits = colliderRaycaster.intersectObjects(colliderMeshes, true);
          if (hits.length > 0 && hits[0].distance < collisionRadius + scrollMove.length()) {
            return; // block scroll into wall
          }
        }
        camera.position.add(scrollMove);
      };

      const keys = new Set<string>();
      const onKeyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
      const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerup", onPointerUp);
      container.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      container.style.cursor = "grab";

      // ─── Render loop ───
      let frameCount = 0;
      let animationId: number;

      function animate() {
        animationId = requestAnimationFrame(animate);
        frameCount++;

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

        // Build desired movement
        const move = new THREE.Vector3();
        if (keys.has("w")) move.addScaledVector(forward, moveSpeed);
        if (keys.has("s")) move.addScaledVector(forward, -moveSpeed);
        if (keys.has("a")) move.addScaledVector(right, -moveSpeed);
        if (keys.has("d")) move.addScaledVector(right, moveSpeed);
        if (keys.has("q") || keys.has("shift")) move.y -= moveSpeed;
        if (keys.has("e") || keys.has(" ")) move.y += moveSpeed;

        // Collision check: cast ray in movement direction, block if wall is too close
        if (move.length() > 0 && colliderMeshes.length > 0) {
          const dir = move.clone().normalize();
          colliderRaycaster.set(camera.position, dir);
          colliderRaycaster.far = collisionRadius + move.length();
          const hits = colliderRaycaster.intersectObjects(colliderMeshes, true);
          if (hits.length > 0 && hits[0].distance < collisionRadius + move.length()) {
            // Slide: zero out the component toward the wall
            const wallNormal = hits[0].face?.normal?.clone();
            if (wallNormal) {
              wallNormal.transformDirection(hits[0].object.matrixWorld);
              const dot = move.dot(wallNormal);
              if (dot < 0) {
                move.addScaledVector(wallNormal, -dot);
              }
            }
          }
        }

        camera.position.add(move);

        // Update camera info HUD every 10 frames
        if (showDebug && frameCount % 10 === 0) {
          setCameraInfo({
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            yaw: THREE.MathUtils.radToDeg(yaw) % 360,
            pitch: THREE.MathUtils.radToDeg(pitch),
            sceneSize,
          });
        }

        // ── Main scene render ──
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setViewport(0, 0, w, h);
        renderer.setScissor(0, 0, w, h);
        renderer.setScissorTest(true);
        renderer.clear();
        renderer.render(scene, camera);

        // ── Gizmo inset render ──
        // Rotate gizmo group to match camera view (inverse of camera quaternion)
        gizmoGroup.quaternion.copy(camera.quaternion).invert();

        const gx = w - gizmoSize - 16;
        const gy = 16;
        renderer.setViewport(gx, gy, gizmoSize, gizmoSize);
        renderer.setScissor(gx, gy, gizmoSize, gizmoSize);
        renderer.clear(false, true, false); // clear depth only
        renderer.render(gizmoScene, gizmoCamera);

        renderer.setScissorTest(false);
      }
      animate();

      const onResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", onResize);

      cleanupRef.current = () => {
        cancelAnimationFrame(animationId);
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerup", onPointerUp);
        container.removeEventListener("wheel", onWheel);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("resize", onResize);
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          container.removeChild(renderer.domElement);
        }
      };
    }

    init().catch(console.error);

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, [spzUrl, colliderMeshUrl, showDebug]);

  return (
    <div ref={containerRef} className="w-full h-full relative" tabIndex={0} style={{ outline: "none" }}>
      {/* Camera position HUD */}
      {showDebug && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/60 text-green-400 font-mono text-[11px] px-3 py-2 rounded pointer-events-auto select-text z-50 leading-relaxed">
          <div>pos: {cameraInfo.x.toFixed(3)}, {cameraInfo.y.toFixed(3)}, {cameraInfo.z.toFixed(3)}</div>
          <div>yaw: {cameraInfo.yaw.toFixed(1)}° pitch: {cameraInfo.pitch.toFixed(1)}°</div>
          <div>scene: {cameraInfo.sceneSize?.toFixed(3)}</div>
        </div>
      )}
    </div>
  );
}
