/**
 * TaskFlow — Floating Productivity Workspace 3D Environment
 *
 * Implements a real-time, high-fidelity Three.js 3D background recreating
 * the reference productivity workspace:
 * - Soft cyan/sky-blue cinematic atmosphere & gradient backdrop
 * - Modern desk with tapered cylindrical legs
 * - Holographic emitter pad with upward curved light beams
 * - Sleek laptop with angled display screen and keyboard
 * - Ergonomic modern chair in foreground right
 * - Pale cyan ceramic coffee mug with curved handle on desk
 * - 4 floating holographic productivity panels with custom textures:
 *     1. AI TO-DO LIST (checkmarks, task lines, glowing cyan border)
 *     2. DAILY SCHEDULE (header pill, time blocks, event lines)
 *     3. NOTES (header, horizontal paragraph lines)
 *     4. TOP PRIORITIES (header, circular bullet indicators)
 * - Drifting ambient cyan particles
 * - Clamped pointer parallax with smooth lerp easing
 * - Frame-rate independent delta time animation
 * - prefers-reduced-motion support (static rendering)
 * - Page visibility handling (pauses animation when tab is hidden)
 * - Resilient WebGL detection & static CSS fallback
 */

'use strict';

(function () {
  // Check if browser supports WebGL
  function isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (_) {
      return false;
    }
  }

  // Ensure Three.js is loaded
  function waitForThree(callback, attempts = 0) {
    if (typeof window.THREE !== 'undefined') {
      callback(window.THREE);
    } else if (attempts < 20) {
      setTimeout(() => waitForThree(callback, attempts + 1), 100);
    } else {
      console.warn('TaskFlow 3D: Three.js library not detected. Activating static visual fallback.');
      activateFallback();
    }
  }

  function activateFallback() {
    const container = document.getElementById('three-bg-container');
    if (container) {
      container.classList.add('fallback-active');
    }
  }

  // Main 3D Workspace Controller
  function init3DWorkspace(THREE) {
    const container = document.getElementById('three-bg-container');
    if (!container) return;

    if (!isWebGLAvailable()) {
      console.warn('TaskFlow 3D: WebGL is not available on this device. Displaying visual fallback.');
      activateFallback();
      return;
    }

    // --- Scene, Camera, & Renderer ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x527694, 0.038);

    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
    // Camera positioned with a slight cinematic angle matching the reference
    const defaultCameraPos = new THREE.Vector3(0, 1.45, 9.8);
    camera.position.copy(defaultCameraPos);
    camera.lookAt(0, 1.05, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (e) {
      console.error('TaskFlow 3D: WebGLRenderer creation failed:', e);
      activateFallback();
      return;
    }

    // Limit DPR for high performance on student laptops and integrated GPUs
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // --- State & Animation Parameters ---
    const state = {
      isTabVisible: true,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      mouse: { x: 0, y: 0, targetX: 0, targetY: 0 },
      panels: [],
      particles: null,
      lightRays: [],
      emitterGlow: null,
      clock: new THREE.Clock(),
      animId: null,
    };

    // -------------------------------------------------------------------------
    // 1. Lighting System
    // -------------------------------------------------------------------------
    // Soft cool ambient light matching room tones
    const ambientLight = new THREE.AmbientLight(0x8cb1d1, 1.3);
    scene.add(ambientLight);

    // Main key directional light (top-left)
    const keyLight = new THREE.DirectionalLight(0xe2f3ff, 1.6);
    keyLight.position.set(-4, 7, 6);
    scene.add(keyLight);

    // Soft fill light from the right
    const fillLight = new THREE.DirectionalLight(0x76a2c5, 0.85);
    fillLight.position.set(5, 4, 3);
    scene.add(fillLight);

    // Hologram Emitter point light: shines upward onto floating panels with glowing cyan hue
    const emitterLight = new THREE.PointLight(0x67e8f9, 2.8, 8, 1.6);
    emitterLight.position.set(-0.6, -0.2, 1.0);
    scene.add(emitterLight);

    // -------------------------------------------------------------------------
    // 2. Room Wall & Background Elements
    // -------------------------------------------------------------------------
    // Soft atmospheric backdrop
    const wallGeo = new THREE.PlaneGeometry(32, 20);
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x4f7291,
      transparent: true,
      opacity: 0.95,
    });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.set(0, 2, -6.5);
    scene.add(wallMesh);

    // Minimal floating shelf on upper-right wall (as in reference image)
    const shelfGroup = new THREE.Group();
    const shelfGeo = new THREE.BoxGeometry(3.6, 0.12, 0.8);
    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0x3d5d78,
      roughness: 0.5,
      metalness: 0.1,
    });
    const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat);
    shelfMesh.position.set(5.2, 3.2, -4.5);
    shelfGroup.add(shelfMesh);

    // Minimalist decorative books/boxes on shelf
    const bookGeo1 = new THREE.BoxGeometry(0.8, 0.9, 0.5);
    const bookMat1 = new THREE.MeshStandardMaterial({ color: 0x2e485e, roughness: 0.6 });
    const book1 = new THREE.Mesh(bookGeo1, bookMat1);
    book1.position.set(4.6, 3.7, -4.5);
    shelfGroup.add(book1);

    const bookGeo2 = new THREE.BoxGeometry(0.5, 0.7, 0.5);
    const bookMat2 = new THREE.MeshStandardMaterial({ color: 0x476a87, roughness: 0.5 });
    const book2 = new THREE.Mesh(bookGeo2, bookMat2);
    book2.position.set(5.4, 3.6, -4.5);
    shelfGroup.add(book2);
    scene.add(shelfGroup);

    // -------------------------------------------------------------------------
    // 3. Desk & Furniture Construction
    // -------------------------------------------------------------------------
    const deskGroup = new THREE.Group();

    // Desk surface: Wide, sleek, pale cyan-blue top with rounded bevel
    const deskTopGeo = new THREE.BoxGeometry(11.8, 0.24, 4.4);
    const deskMat = new THREE.MeshStandardMaterial({
      color: 0xcde7f7,
      roughness: 0.35,
      metalness: 0.08,
    });
    const deskTop = new THREE.Mesh(deskTopGeo, deskMat);
    deskTop.position.set(0, -0.68, 0.8);
    deskGroup.add(deskTop);

    // Desk bevel trim / under-rail
    const deskTrimGeo = new THREE.BoxGeometry(11.4, 0.14, 4.0);
    const deskTrimMat = new THREE.MeshStandardMaterial({
      color: 0xa9cce4,
      roughness: 0.4,
    });
    const deskTrim = new THREE.Mesh(deskTrimGeo, deskTrimMat);
    deskTrim.position.set(0, -0.84, 0.8);
    deskGroup.add(deskTrim);

    // Minimalist cylindrical tapered desk legs
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x769bba,
      roughness: 0.45,
      metalness: 0.15,
    });
    const legGeo = new THREE.CylinderGeometry(0.08, 0.05, 3.2, 16);

    const legPositions = [
      [-5.0, -2.4, 2.3], // Front Left
      [5.0, -2.4, 2.3],  // Front Right
      [-5.0, -2.4, -0.7], // Rear Left
      [5.0, -2.4, -0.7],  // Rear Right
    ];

    legPositions.forEach(([x, y, z]) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, y, z);
      // Slight outward flare for modern architectural look
      leg.rotation.z = x > 0 ? -0.06 : 0.06;
      leg.rotation.x = z > 0 ? 0.05 : -0.05;
      deskGroup.add(leg);
    });

    // -------------------------------------------------------------------------
    // 4. Holographic Projector Base & Upward Light Rays
    // -------------------------------------------------------------------------
    // Projector pad embedded/resting on desk center
    const padGroup = new THREE.Group();
    padGroup.position.set(-0.6, -0.55, 1.1);

    const padOuterGeo = new THREE.BoxGeometry(3.4, 0.03, 1.9);
    const padOuterMat = new THREE.MeshStandardMaterial({
      color: 0xb5e3f8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
    });
    const padOuter = new THREE.Mesh(padOuterGeo, padOuterMat);
    padGroup.add(padOuter);

    // Inner glowing core
    const padInnerGeo = new THREE.PlaneGeometry(3.0, 1.5);
    const padInnerMat = new THREE.MeshBasicMaterial({
      color: 0xe0f7fe,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    const padInner = new THREE.Mesh(padInnerGeo, padInnerMat);
    padInner.rotation.x = -Math.PI / 2;
    padInner.position.y = 0.02;
    padGroup.add(padInner);

    // Hologram light emitter glow ring
    const glowGeo = new THREE.PlaneGeometry(4.2, 2.6);
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d');
    const grad = gctx.createRadialGradient(64, 64, 10, 64, 64, 60);
    grad.addColorStop(0, 'rgba(103, 232, 249, 0.55)');
    grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.25)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);

    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const padGlow = new THREE.Mesh(glowGeo, glowMat);
    padGlow.rotation.x = -Math.PI / 2;
    padGlow.position.y = 0.025;
    padGroup.add(padGlow);
    state.emitterGlow = padGlow;

    deskGroup.add(padGroup);

    // Upward curved holographic projection light beams
    // As seen in reference image: 4 elegant luminous rays arching from desk pad to each panel
    const rayTargetPoints = [
      new THREE.Vector3(-4.4, 1.5, -0.8), // Ray to To-Do List
      new THREE.Vector3(-2.2, 1.7, -1.4), // Ray to Daily Schedule
      new THREE.Vector3(2.2, 1.6, -1.6),  // Ray to Notes
      new THREE.Vector3(4.4, 1.4, -1.2),  // Ray to Top Priorities
    ];

    const rayMaterial = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      wireframe: false,
    });

    rayTargetPoints.forEach((target, idx) => {
      // Emitter origin on pad
      const startX = -1.6 + idx * 0.7;
      const start = new THREE.Vector3(startX, -0.54, 1.1);
      const mid = new THREE.Vector3(
        (start.x + target.x) * 0.5 + (idx < 2 ? -0.4 : 0.4),
        0.3,
        (start.z + target.z) * 0.5 + 0.3
      );
      const curve = new THREE.QuadraticBezierCurve3(start, mid, target);
      const rayGeo = new THREE.TubeGeometry(curve, 32, 0.025 + (idx === 0 ? 0.015 : 0.008), 8, false);
      const rayMesh = new THREE.Mesh(rayGeo, rayMaterial.clone());
      deskGroup.add(rayMesh);
      state.lightRays.push(rayMesh);
    });

    // -------------------------------------------------------------------------
    // 5. Laptop on Right Desk
    // -------------------------------------------------------------------------
    const laptopGroup = new THREE.Group();
    laptopGroup.position.set(3.0, -0.55, 1.25);
    laptopGroup.rotation.y = -0.32; // Turned gently toward center

    // Laptop base / bottom chassis
    const lapBaseGeo = new THREE.BoxGeometry(1.75, 0.045, 1.25);
    const lapBaseMat = new THREE.MeshStandardMaterial({
      color: 0x223246,
      roughness: 0.4,
      metalness: 0.25,
    });
    const lapBase = new THREE.Mesh(lapBaseGeo, lapBaseMat);
    laptopGroup.add(lapBase);

    // Keyboard bed & chiclet keys (texture representation)
    const kbCanvas = document.createElement('canvas');
    kbCanvas.width = 256;
    kbCanvas.height = 128;
    const kctx = kbCanvas.getContext('2d');
    kctx.fillStyle = '#1c2838';
    kctx.fillRect(0, 0, 256, 128);
    // Keys grid
    kctx.fillStyle = '#2d3e52';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 12; c++) {
        kctx.beginPath();
        kctx.roundRect(14 + c * 19, 10 + r * 14, 16, 11, 2);
        kctx.fill();
      }
    }
    // Trackpad
    kctx.fillStyle = '#26374a';
    kctx.strokeStyle = '#384d63';
    kctx.lineWidth = 1.5;
    kctx.beginPath();
    kctx.roundRect(88, 88, 80, 36, 4);
    kctx.fill();
    kctx.stroke();

    const kbTexture = new THREE.CanvasTexture(kbCanvas);
    const kbGeo = new THREE.PlaneGeometry(1.6, 1.05);
    const kbMat = new THREE.MeshBasicMaterial({ map: kbTexture });
    const kbMesh = new THREE.Mesh(kbGeo, kbMat);
    kbMesh.rotation.x = -Math.PI / 2;
    kbMesh.position.set(0, 0.025, 0.02);
    laptopGroup.add(kbMesh);

    // Laptop Screen Lid (hinged at rear, tilted at ~108 degrees)
    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, 0.025, -0.6);
    lidGroup.rotation.x = -1.22; // Open screen angle

    const lidBackGeo = new THREE.BoxGeometry(1.75, 1.2, 0.035);
    const lidBackMat = new THREE.MeshStandardMaterial({
      color: 0x1e2c3c,
      roughness: 0.35,
      metalness: 0.3,
    });
    const lidBack = new THREE.Mesh(lidBackGeo, lidBackMat);
    lidBack.position.set(0, 0.6, 0);
    lidGroup.add(lidBack);

    // Display screen with subtle cyan-blue glow
    const screenGeo = new THREE.PlaneGeometry(1.65, 1.1);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x162231,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.12,
      roughness: 0.25,
      metalness: 0.1,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0, 0.6, 0.02);
    lidGroup.add(screenMesh);

    laptopGroup.add(lidGroup);
    deskGroup.add(laptopGroup);

    // -------------------------------------------------------------------------
    // 6. Coffee Mug on Left Desk
    // -------------------------------------------------------------------------
    const mugGroup = new THREE.Group();
    mugGroup.position.set(-3.8, -0.34, 1.7);

    // Ceramic pale cyan-blue mug body
    const mugMat = new THREE.MeshStandardMaterial({
      color: 0xd6ecfa,
      roughness: 0.25,
      metalness: 0.05,
    });
    const mugGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.65, 24);
    const mug = new THREE.Mesh(mugGeo, mugMat);
    mugGroup.add(mug);

    // Mug interior coffee liquid
    const coffeeGeo = new THREE.CircleGeometry(0.29, 20);
    const coffeeMat = new THREE.MeshStandardMaterial({
      color: 0x2b1e17,
      roughness: 0.2,
    });
    const coffee = new THREE.Mesh(coffeeGeo, coffeeMat);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.28;
    mugGroup.add(coffee);

    // Mug handle (curved torus)
    const handleGeo = new THREE.TorusGeometry(0.18, 0.05, 12, 24, Math.PI);
    const handle = new THREE.Mesh(handleGeo, mugMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(-0.33, 0.02, 0);
    mugGroup.add(handle);

    deskGroup.add(mugGroup);
    scene.add(deskGroup);

    // -------------------------------------------------------------------------
    // 7. Chair in Foreground Right
    // -------------------------------------------------------------------------
    const chairGroup = new THREE.Group();
    chairGroup.position.set(4.3, -1.35, 3.7);
    chairGroup.rotation.y = -0.45;

    const chairMat = new THREE.MeshStandardMaterial({
      color: 0x4f708c,
      roughness: 0.45,
      metalness: 0.1,
    });

    // Ergonomic backrest (smooth rounded contour)
    const backGeo = new THREE.BoxGeometry(1.6, 2.2, 0.22);
    const back = new THREE.Mesh(backGeo, chairMat);
    back.position.set(0, 1.1, -0.35);
    back.rotation.x = -0.12;
    chairGroup.add(back);

    // Chair seat cushion
    const seatGeo = new THREE.BoxGeometry(1.7, 0.22, 1.6);
    const seat = new THREE.Mesh(seatGeo, chairMat);
    seat.position.set(0, 0.1, 0.3);
    chairGroup.add(seat);

    // Minimalist chair support column & base
    const stemGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 16);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x2e465c, roughness: 0.4 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(0, -0.5, 0.3);
    chairGroup.add(stem);

    scene.add(chairGroup);

    // -------------------------------------------------------------------------
    // 8. Holographic Productivity Panels
    // -------------------------------------------------------------------------
    // Helper to draw rounded rectangle on 2D canvas
    function drawRoundRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
    }

    // --- Panel A: "AI TO-DO LIST" Texture ---
    function createToDoTexture() {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 720;
      const ctx = c.getContext('2d');

      // Glass body gradient with cyan glow
      const bgGrad = ctx.createLinearGradient(0, 0, 512, 720);
      bgGrad.addColorStop(0, 'rgba(125, 211, 252, 0.28)');
      bgGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.18)');
      bgGrad.addColorStop(1, 'rgba(14, 165, 233, 0.24)');
      ctx.fillStyle = bgGrad;
      drawRoundRect(ctx, 16, 16, 480, 688, 36);
      ctx.fill();

      // Glowing Cyan Border
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Header: "AI" (large bold display)
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 84px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AI', 256, 130);

      // Subtitle: "TO-DO LIST"
      ctx.fillStyle = '#e0f2fe';
      ctx.font = '700 28px system-ui, -apple-system, sans-serif';
      ctx.letterSpacing = '3px';
      ctx.fillText('TO-DO LIST', 256, 185);

      // 3 Tasks with Checkboxes and checkmarks
      const taskY = [265, 395, 525];
      taskY.forEach((y) => {
        // Checkbox box
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 4.5;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        drawRoundRect(ctx, 60, y - 28, 48, 48, 12);
        ctx.fill();
        ctx.stroke();

        // Checkmark glyph inside
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(71, y - 3);
        ctx.lineTo(80, y + 6);
        ctx.lineTo(97, y - 13);
        ctx.stroke();

        // Horizontal task line
        ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
        drawRoundRect(ctx, 130, y - 10, 310, 14, 7);
        ctx.fill();
      });

      return new THREE.CanvasTexture(c);
    }

    // --- Panel B: "DAILY SCHEDULE" Texture ---
    function createScheduleTexture() {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 780;
      const ctx = c.getContext('2d');

      // Glass body
      const bgGrad = ctx.createLinearGradient(0, 0, 480, 780);
      bgGrad.addColorStop(0, 'rgba(56, 189, 248, 0.24)');
      bgGrad.addColorStop(1, 'rgba(14, 165, 233, 0.16)');
      ctx.fillStyle = bgGrad;
      drawRoundRect(ctx, 14, 14, 452, 752, 34);
      ctx.fill();

      // Border
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#0284c7';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Top pill/search bar
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 4;
      drawRoundRect(ctx, 50, 45, 380, 56, 28);
      ctx.stroke();

      // Heading: "DAILY SCHEDULE"
      ctx.fillStyle = '#f0f9ff';
      ctx.font = '700 26px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DAILY SCHEDULE', 240, 165);

      // Schedule blocks (3 rows: time pill + 2 task lines)
      const blockY = [240, 370, 500];
      blockY.forEach((y) => {
        // Left rounded rectangular time block
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 3;
        drawRoundRect(ctx, 45, y - 26, 95, 52, 10);
        ctx.fill();
        ctx.stroke();

        // Right content lines
        ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
        drawRoundRect(ctx, 160, y - 18, 265, 12, 6);
        ctx.fill();

        ctx.fillStyle = 'rgba(186, 230, 253, 0.7)';
        drawRoundRect(ctx, 160, y + 8, 190, 10, 5);
        ctx.fill();
      });

      // Bottom summary bar
      ctx.fillStyle = 'rgba(240, 249, 255, 0.85)';
      drawRoundRect(ctx, 45, 660, 390, 10, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(186, 230, 253, 0.65)';
      drawRoundRect(ctx, 45, 685, 260, 8, 4);
      ctx.fill();

      return new THREE.CanvasTexture(c);
    }

    // --- Panel C: "NOTES" Texture ---
    function createNotesTexture() {
      const c = document.createElement('canvas');
      c.width = 440;
      c.height = 620;
      const ctx = c.getContext('2d');

      // Glass body
      const bgGrad = ctx.createLinearGradient(0, 0, 440, 620);
      bgGrad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
      bgGrad.addColorStop(1, 'rgba(14, 165, 233, 0.15)');
      ctx.fillStyle = bgGrad;
      drawRoundRect(ctx, 14, 14, 412, 592, 30);
      ctx.fill();

      // Border
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Header: "NOTES"
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 28px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('NOTES', 48, 85);

      // Multiple horizontal note lines
      const lineY = [140, 195, 250, 305, 360, 415, 470];
      const widths = [340, 310, 340, 280, 330, 300, 240];
      lineY.forEach((y, i) => {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(240, 249, 255, 0.9)' : 'rgba(186, 230, 253, 0.7)';
        drawRoundRect(ctx, 48, y, widths[i], 12, 6);
        ctx.fill();
      });

      return new THREE.CanvasTexture(c);
    }

    // --- Panel D: "TOP PRIORITIES" Texture ---
    function createPrioritiesTexture() {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 540;
      const ctx = c.getContext('2d');

      // Glass body
      const bgGrad = ctx.createLinearGradient(0, 0, 400, 540);
      bgGrad.addColorStop(0, 'rgba(56, 189, 248, 0.2)');
      bgGrad.addColorStop(1, 'rgba(14, 165, 233, 0.14)');
      ctx.fillStyle = bgGrad;
      drawRoundRect(ctx, 14, 14, 372, 512, 28);
      ctx.fill();

      // Border
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Header: "TOP PRIORITIES"
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 24px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('TOP PRIORITIES', 45, 80);

      // 3 Priority bullet points with horizontal lines
      const pY = [160, 260, 360];
      pY.forEach((y) => {
        // Circular bullet
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.arc(62, y, 9, 0, Math.PI * 2);
        ctx.fill();

        // Priority text line
        ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
        drawRoundRect(ctx, 95, y - 7, 250, 14, 7);
        ctx.fill();
      });

      return new THREE.CanvasTexture(c);
    }

    // --- Assemble Holographic Panel Meshes ---
    const panelsData = [
      {
        name: 'todo',
        texture: createToDoTexture(),
        width: 2.35,
        height: 3.3,
        basePos: new THREE.Vector3(-4.4, 2.3, -0.8),
        baseRot: new THREE.Euler(0, 0.14, 0),
        phase: 0.0,
        speed: 0.9,
      },
      {
        name: 'schedule',
        texture: createScheduleTexture(),
        width: 2.2,
        height: 3.55,
        basePos: new THREE.Vector3(-2.2, 2.55, -1.4),
        baseRot: new THREE.Euler(0, 0.08, 0),
        phase: 1.3,
        speed: 0.85,
      },
      {
        name: 'notes',
        texture: createNotesTexture(),
        width: 2.0,
        height: 2.8,
        basePos: new THREE.Vector3(2.2, 2.35, -1.6),
        baseRot: new THREE.Euler(0, -0.08, 0),
        phase: 2.5,
        speed: 0.95,
      },
      {
        name: 'priorities',
        texture: createPrioritiesTexture(),
        width: 1.8,
        height: 2.45,
        basePos: new THREE.Vector3(4.4, 2.05, -1.2),
        baseRot: new THREE.Euler(0, -0.14, 0),
        phase: 3.8,
        speed: 0.8,
      },
    ];

    panelsData.forEach((p) => {
      const geo = new THREE.PlaneGeometry(p.width, p.height);
      const mat = new THREE.MeshStandardMaterial({
        map: p.texture,
        transparent: true,
        opacity: 0.95,
        roughness: 0.1,
        metalness: 0.05,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.28,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p.basePos);
      mesh.rotation.copy(p.baseRot);

      // Back glowing aura plane for holographic bloom effect
      const glowPlaneGeo = new THREE.PlaneGeometry(p.width * 1.08, p.height * 1.08);
      const glowPlaneMat = new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const glowPlane = new THREE.Mesh(glowPlaneGeo, glowPlaneMat);
      glowPlane.position.z = -0.02;
      mesh.add(glowPlane);

      scene.add(mesh);
      state.panels.push({
        mesh,
        basePos: p.basePos.clone(),
        baseRot: p.baseRot.clone(),
        phase: p.phase,
        speed: p.speed,
      });
    });

    // -------------------------------------------------------------------------
    // 9. Ambient Cyan Particles (Sparkles Rising from Emitter)
    // -------------------------------------------------------------------------
    const particleCount = 65;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const particleVelocities = [];

    for (let i = 0; i < particleCount; i++) {
      // Disperse mostly around the holographic pad and floating area
      positions[i * 3 + 0] = -3.8 + Math.random() * 7.5;
      positions[i * 3 + 1] = -0.5 + Math.random() * 4.5;
      positions[i * 3 + 2] = -2.0 + Math.random() * 4.0;

      particleVelocities.push({
        y: 0.25 + Math.random() * 0.45,
        swaySpeed: 0.8 + Math.random() * 1.2,
        swayAmp: 0.06 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
      });
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Circular particle sprite texture
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 32;
    pCanvas.height = 32;
    const pctx = pCanvas.getContext('2d');
    const pGrad = pctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    pGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    pGrad.addColorStop(0.4, 'rgba(103, 232, 249, 0.8)');
    pGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    pctx.fillStyle = pGrad;
    pctx.fillRect(0, 0, 32, 32);
    const pTex = new THREE.CanvasTexture(pCanvas);

    const particleMat = new THREE.PointsMaterial({
      size: 0.12,
      map: pTex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);
    state.particles = { system: particleSystem, velocities: particleVelocities };

    // -------------------------------------------------------------------------
    // 10. Pointer Interaction & Parallax Handlers
    // -------------------------------------------------------------------------
    function onPointerMove(e) {
      if (state.reducedMotion) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      // Clamp parallax target coordinates to avoid excessive or dizzying motion
      state.mouse.targetX = Math.max(-0.6, Math.min(0.6, nx));
      state.mouse.targetY = Math.max(-0.4, Math.min(0.4, ny));
    }
    window.addEventListener('mousemove', onPointerMove, { passive: true });

    // Handle Resize smoothly
    function onWindowResize() {
      if (!camera || !renderer) return;
      const width = window.innerWidth;
      const height = window.innerHeight;

      camera.aspect = width / height;

      // Adjust camera distance on narrow mobile screens so workspace remains visible
      if (width < 600) {
        camera.position.z = 12.5;
        camera.position.y = 1.6;
        camera.fov = 48;
      } else if (width < 900) {
        camera.position.z = 11.0;
        camera.position.y = 1.5;
        camera.fov = 43;
      } else {
        camera.position.z = defaultCameraPos.z;
        camera.position.y = defaultCameraPos.y;
        camera.fov = 40;
      }

      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

      // Trigger static frame render if reduced motion is active
      if (state.reducedMotion) {
        renderer.render(scene, camera);
      }
    }
    window.addEventListener('resize', onWindowResize, { passive: true });
    // Run initial responsive sizing
    onWindowResize();

    // Respect prefers-reduced-motion media query
    const motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    function handleMotionPreference(e) {
      state.reducedMotion = e.matches;
      if (state.reducedMotion) {
        renderer.render(scene, camera);
      }
    }
    if (motionMediaQuery.addEventListener) {
      motionMediaQuery.addEventListener('change', handleMotionPreference);
    }

    // Page Visibility handling: pause when tab hidden
    function onVisibilityChange() {
      state.isTabVisible = !document.hidden;
      if (state.isTabVisible && !state.reducedMotion) {
        state.clock.start();
        animate();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // -------------------------------------------------------------------------
    // 11. Animation Loop
    // -------------------------------------------------------------------------
    function animate() {
      if (!state.isTabVisible || state.reducedMotion) {
        state.animId = null;
        return;
      }

      state.animId = requestAnimationFrame(animate);

      const delta = state.clock.getDelta();
      const elapsed = state.clock.getElapsedTime();

      // Smooth camera parallax with lerp easing
      state.mouse.x += (state.mouse.targetX - state.mouse.x) * 0.04;
      state.mouse.y += (state.mouse.targetY - state.mouse.y) * 0.04;

      camera.position.x = defaultCameraPos.x + state.mouse.x * 0.45;
      camera.position.y = (window.innerWidth < 600 ? 1.6 : defaultCameraPos.y) + state.mouse.y * 0.25;
      camera.lookAt(state.mouse.x * 0.15, 1.05 + state.mouse.y * 0.1, 0);

      // Animate floating panels (smooth vertical sine motion + subtle yaw oscillation)
      state.panels.forEach((p) => {
        const floatY = Math.sin(elapsed * p.speed + p.phase) * 0.075;
        p.mesh.position.y = p.basePos.y + floatY;

        const subtleYaw = Math.sin(elapsed * (p.speed * 0.8) + p.phase) * 0.025;
        p.mesh.rotation.y = p.baseRot.y + subtleYaw;
      });

      // Animate emitter glow and light rays (subtle breathing pulse)
      const rayPulse = 0.38 + Math.sin(elapsed * 1.8) * 0.08;
      state.lightRays.forEach((ray) => {
        ray.material.opacity = rayPulse;
      });

      if (state.emitterGlow) {
        state.emitterGlow.material.opacity = 0.7 + Math.sin(elapsed * 2.2) * 0.12;
      }

      // Animate rising particles
      if (state.particles) {
        const posAttr = state.particles.system.geometry.attributes.position;
        const posArr = posAttr.array;

        for (let i = 0; i < particleCount; i++) {
          const vel = state.particles.velocities[i];
          // Rise upward
          posArr[i * 3 + 1] += vel.y * delta;

          // Subtle horizontal drift
          posArr[i * 3 + 0] += Math.sin(elapsed * vel.swaySpeed + vel.phase) * 0.003;

          // Reset when reaching top threshold
          if (posArr[i * 3 + 1] > 4.6) {
            posArr[i * 3 + 1] = -0.5;
            posArr[i * 3 + 0] = -3.6 + Math.random() * 7.2;
            posArr[i * 3 + 2] = -1.8 + Math.random() * 3.8;
          }
        }
        posAttr.needsUpdate = true;
      }

      renderer.render(scene, camera);
    }

    // Start initial render / loop
    if (state.reducedMotion) {
      renderer.render(scene, camera);
    } else {
      animate();
    }

    console.log('TaskFlow 3D: Floating Productivity Workspace successfully initialized.');
  }

  // Bootstrap when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForThree(init3DWorkspace));
  } else {
    waitForThree(init3DWorkspace);
  }
})();
