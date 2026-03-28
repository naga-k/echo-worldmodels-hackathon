"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface SceneViewerProps {
  spzUrl: string;
}

export default function SceneViewer({ spzUrl }: SceneViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current || !spzUrl) return;

    let cancelled = false;

    async function init() {
      const container = containerRef.current!;

      // Load Spark.js via CDN to bypass webpack's asset module issues
      const cdnUrl =
        "https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@0.1.10/dist/spark.module.js";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spark: any = await (Function(
        `return import("${cdnUrl}")`
      )() as Promise<any>);

      if (cancelled) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111111);

      const camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
      );
      camera.position.set(0, 1, 3);

      const renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      // SparkRenderer is a THREE.Mesh that manages splat rendering
      const sparkRenderer = new spark.SparkRenderer({ renderer });
      scene.add(sparkRenderer);

      // Load SPZ file
      const splatMesh = new spark.SplatMesh({ url: spzUrl });
      await splatMesh.initialized;
      scene.add(splatMesh);

      if (cancelled) {
        renderer.dispose();
        container.removeChild(renderer.domElement);
        return;
      }

      // Orbit controls
      let isPointerDown = false;
      let prevX = 0;
      let prevY = 0;
      let theta = 0;
      let phi = Math.PI / 4;
      let radius = 3;
      const target = new THREE.Vector3(0, 0, 0);

      const bbox = splatMesh.getBoundingBox();
      if (bbox && !bbox.isEmpty()) {
        bbox.getCenter(target);
        const size = bbox.getSize(new THREE.Vector3()).length();
        radius = Math.max(size * 1.5, 2);
      }

      function updateCamera() {
        camera.position.x =
          target.x + radius * Math.sin(phi) * Math.sin(theta);
        camera.position.y = target.y + radius * Math.cos(phi);
        camera.position.z =
          target.z + radius * Math.sin(phi) * Math.cos(theta);
        camera.lookAt(target);
      }

      updateCamera();

      const onPointerDown = (e: PointerEvent) => {
        isPointerDown = true;
        prevX = e.clientX;
        prevY = e.clientY;
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!isPointerDown) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;
        theta += dx * 0.005;
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + dy * 0.005));
        updateCamera();
      };
      const onPointerUp = () => {
        isPointerDown = false;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        radius = Math.max(0.5, Math.min(50, radius + e.deltaY * 0.01));
        updateCamera();
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

      let animationId: number;
      function animate() {
        animationId = requestAnimationFrame(animate);

        const speed = 0.05;
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const right = new THREE.Vector3()
          .crossVectors(forward, camera.up)
          .normalize();

        if (keys.has("w")) camera.position.addScaledVector(forward, speed);
        if (keys.has("s")) camera.position.addScaledVector(forward, -speed);
        if (keys.has("a")) camera.position.addScaledVector(right, -speed);
        if (keys.has("d")) camera.position.addScaledVector(right, speed);
        if (keys.has("q")) camera.position.y -= speed;
        if (keys.has("e")) camera.position.y += speed;

        renderer.render(scene, camera);
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
  }, [spzUrl]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      tabIndex={0}
      style={{ outline: "none" }}
    />
  );
}
