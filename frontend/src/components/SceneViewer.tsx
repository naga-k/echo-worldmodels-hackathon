import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

type ViewerVariant = "echo" | "reference";

interface SceneViewerProps {
  spzUrl: string;
  colliderMeshUrl?: string;
  semantics?: {
    ground_plane_offset?: number;
    metric_scale_factor?: number;
  };
  showDebug?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  variant?: ViewerVariant;
}

function applyWorldLabsTransform(object: THREE.Object3D, variant: ViewerVariant) {
  if (variant === "reference") {
    object.rotation.x = Math.PI;
    return;
  }
  object.scale.set(1, -1, -1);
}

function computeReferenceSpawn(bbox: THREE.Box3, semantics?: SceneViewerProps["semantics"]) {
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const groundOffset = semantics?.ground_plane_offset ?? 0;
  const groundY = center.y - size.y / 2 + groundOffset;
  const eyeHeight = Math.max(size.y * 0.18, 0.2);
  const distance = Math.max(size.z * 0.65, size.x * 0.35, 0.75);

  return {
    position: new THREE.Vector3(center.x, groundY + eyeHeight, center.z + distance),
    target: new THREE.Vector3(center.x, groundY + Math.max(size.y * 0.3, 0.25), center.z),
  };
}

export default function SceneViewer({
  spzUrl,
  colliderMeshUrl,
  semantics,
  showDebug = true,
  onCanvasReady,
  variant = "echo",
}: SceneViewerProps) {
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
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111111);

      const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.001, 1000);
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.autoClear = false;
      container.appendChild(renderer.domElement);
      onCanvasReady?.(renderer.domElement);

      const sparkRenderer = new SparkRenderer({
        renderer,
        focalAdjustment: variant === "reference" ? 2.0 : 1.0,
        view: variant === "reference" ? { sortRadial: false } : undefined,
      });
      scene.add(sparkRenderer);

      const splatMesh = new SplatMesh({ url: spzUrl });
      await splatMesh.initialized;
      applyWorldLabsTransform(splatMesh, variant);
      splatMesh.opacity = variant === "reference" ? 1 : 1.5;
      scene.add(splatMesh);
      splatMesh.updateMatrixWorld(true);

      if (cancelled) {
        renderer.dispose();
        if (renderer.domElement.parentNode) container.removeChild(renderer.domElement);
        return;
      }

      const bbox = new THREE.Box3().setFromObject(splatMesh);
      const bboxCenter = bbox.getCenter(new THREE.Vector3());
      const bboxSize = bbox.getSize(new THREE.Vector3());
      const sceneSize = bbox.isEmpty() ? 1 : Math.max(bboxSize.length(), 1);

      const debugGroup = new THREE.Group();
      debugGroup.visible = showDebug;

      const gridSize = Math.max(sceneSize * 3, 5);
      const grid = new THREE.GridHelper(gridSize, 30, 0x555555, 0x333333);
      const groundY = bboxCenter.y - bboxSize.y / 2 + (semantics?.ground_plane_offset ?? 0);
      grid.position.set(bboxCenter.x, groundY, bboxCenter.z);
      grid.renderOrder = 999;
      (grid.material as THREE.Material).depthTest = false;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.4;
      debugGroup.add(grid);

      const axes = new THREE.AxesHelper(Math.max(sceneSize * 0.4, 0.5));
      axes.position.copy(bboxCenter);
      axes.renderOrder = 1000;
      axes.material.depthTest = false;
      debugGroup.add(axes);
      scene.add(debugGroup);

      const gizmoScene = new THREE.Scene();
      const gizmoSize = 120;
      const gizmoCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
      gizmoCamera.position.set(0, 0, 3);
      gizmoCamera.lookAt(0, 0, 0);

      const gizmoGroup = new THREE.Group();
      gizmoScene.add(gizmoGroup);
      const gizmoAxes = new THREE.AxesHelper(1);
      gizmoAxes.material.depthTest = false;
      gizmoGroup.add(gizmoAxes);

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

        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 12, 12),
          new THREE.MeshBasicMaterial({ color, depthTest: false }),
        );
        dot.position.set(pos[0] * 0.72, pos[1] * 0.72, pos[2] * 0.72);
        dot.renderOrder = 1001;
        gizmoGroup.add(dot);
      }

      const origin = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x888888, depthTest: false }),
      );
      origin.renderOrder = 1001;
      gizmoGroup.add(origin);

      let colliderMeshes: THREE.Mesh[] = [];
      const colliderRaycaster = new THREE.Raycaster();
      const collisionRadius = 0.15;

      if (colliderMeshUrl) {
        const loader = new GLTFLoader();
        try {
          const gltf = await new Promise<any>((resolve, reject) => {
            loader.load(colliderMeshUrl, resolve, undefined, reject);
          });
          const colliderGroup = gltf.scene;
          applyWorldLabsTransform(colliderGroup, variant);
          scene.add(colliderGroup);
          colliderGroup.updateMatrixWorld(true);

          colliderGroup.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
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
        } catch (error) {
          console.warn("[SceneViewer] Failed to load collider mesh:", error);
        }
      }

      let yaw = Math.PI;
      let pitch = 0;
      if (variant === "reference" && !bbox.isEmpty()) {
        const spawn = computeReferenceSpawn(bbox, semantics);
        camera.position.copy(spawn.position);
        camera.lookAt(spawn.target);
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
        yaw = euler.y;
        pitch = euler.x;
      } else {
        camera.position.set(0, 0.16, -0.27);
      }

      let isPointerDown = false;
      let prevX = 0;
      let prevY = 0;
      const moveSpeed = Math.max(sceneSize * 0.001, 0.003);
      const lookSpeed = 0.0015;

      function updateCameraRotation() {
        const quaternion = new THREE.Quaternion();
        quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
        camera.quaternion.copy(quaternion);
      }
      updateCameraRotation();

      const onPointerDown = (event: PointerEvent) => {
        isPointerDown = true;
        prevX = event.clientX;
        prevY = event.clientY;
        container.style.cursor = "grabbing";
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!isPointerDown) return;
        const dx = event.clientX - prevX;
        const dy = event.clientY - prevY;
        prevX = event.clientX;
        prevY = event.clientY;
        yaw -= dx * lookSpeed;
        pitch -= dy * lookSpeed;
        pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
        updateCameraRotation();
      };

      const onPointerUp = () => {
        isPointerDown = false;
        container.style.cursor = "grab";
      };

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const scrollMove = forward.multiplyScalar(-event.deltaY * moveSpeed * 0.5);

        if (scrollMove.length() > 0 && colliderMeshes.length > 0) {
          const dir = scrollMove.clone().normalize();
          colliderRaycaster.set(camera.position, dir);
          colliderRaycaster.far = collisionRadius + scrollMove.length();
          const hits = colliderRaycaster.intersectObjects(colliderMeshes, true);
          if (hits.length > 0 && hits[0].distance < collisionRadius + scrollMove.length()) {
            return;
          }
        }
        camera.position.add(scrollMove);
      };

      const keys = new Set<string>();
      const onKeyDown = (event: KeyboardEvent) => keys.add(event.key.toLowerCase());
      const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());

      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerup", onPointerUp);
      container.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      container.style.cursor = "grab";

      let frameCount = 0;
      let animationId = 0;

      function animate() {
        animationId = requestAnimationFrame(animate);
        frameCount++;

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const move = new THREE.Vector3();

        if (keys.has("w")) move.addScaledVector(forward, moveSpeed);
        if (keys.has("s")) move.addScaledVector(forward, -moveSpeed);
        if (keys.has("a")) move.addScaledVector(right, -moveSpeed);
        if (keys.has("d")) move.addScaledVector(right, moveSpeed);
        if (keys.has("q") || keys.has("shift")) move.y -= moveSpeed;
        if (keys.has("e") || keys.has(" ")) move.y += moveSpeed;

        if (move.length() > 0 && colliderMeshes.length > 0) {
          const dir = move.clone().normalize();
          colliderRaycaster.set(camera.position, dir);
          colliderRaycaster.far = collisionRadius + move.length();
          const hits = colliderRaycaster.intersectObjects(colliderMeshes, true);
          if (hits.length > 0 && hits[0].distance < collisionRadius + move.length()) {
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

        const width = container.clientWidth;
        const height = container.clientHeight;
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, width, height);
        renderer.setScissorTest(true);
        renderer.clear();
        renderer.render(scene, camera);

        gizmoGroup.quaternion.copy(camera.quaternion).invert();
        const gx = width - gizmoSize - 16;
        const gy = 16;
        renderer.setViewport(gx, gy, gizmoSize, gizmoSize);
        renderer.setScissor(gx, gy, gizmoSize, gizmoSize);
        renderer.clear(false, true, false);
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
  }, [colliderMeshUrl, onCanvasReady, semantics, showDebug, spzUrl, variant]);

  return (
    <div ref={containerRef} className="w-full h-full relative" tabIndex={0} style={{ outline: "none" }}>
      {showDebug && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/60 text-green-400 font-mono text-[11px] px-3 py-2 rounded pointer-events-auto select-text z-50 leading-relaxed">
          <div>pos: {cameraInfo.x.toFixed(3)}, {cameraInfo.y.toFixed(3)}, {cameraInfo.z.toFixed(3)}</div>
          <div>yaw: {cameraInfo.yaw.toFixed(1)}° pitch: {cameraInfo.pitch.toFixed(1)}°</div>
          <div>scene: {cameraInfo.sceneSize?.toFixed(3)}</div>
          <div>variant: {variant}</div>
        </div>
      )}
    </div>
  );
}
