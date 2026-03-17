// Playgen Logic - Farm World with OpenClaw Agents
window.Playgen = (function() {
    let scene, camera, renderer, controls, animationId;
    let agents = []; // Array of agent objects
    let raycaster, mouse;
    let container, uiLayer;
    let isActive = false;

    // Chat Windows - concurrent chats with multiple agents
    let openChats = {}; // agentId -> { element, ws, messages, isLoading, startX, startY, offsetX, offsetY }

    // Request queue to avoid OpenClaw lock
    const agentQueues = {}; // agentId -> Promise chain

    // Assets
    let agentSprites = {};

    // Texture loader
    const textureLoader = new THREE.TextureLoader();

    // ===== Day/Night Cycle System =====
    const DAY_DURATION = 180000;       // 3 minutes day
    const NIGHT_DURATION = 180000;     // 3 minutes night
    const TRANSITION_DURATION = 10000; // 10 seconds smooth transition
    const worldLights = {};            // ambient, sun, moon, moonLight
    const nightObjects = {
        windowMeshes: [],   // house/building window meshes to glow at night
        lampPosts: [],      // lamp post groups (have PointLight children)
        screenMeshes: [],   // computer screen meshes
    };
    let dayNightState = {
        isNight: false,
        cycleStart: 0,      // timestamp when current phase started
        transition: 0,       // 0 = full day, 1 = full night
        initialized: false
    };

    // Sky colors for lerp
    const DAY_SKY = new THREE.Color(0x87CEEB);
    const NIGHT_SKY = new THREE.Color(0x0a0a2e);
    const DAY_FOG = new THREE.Color(0x87CEEB);
    const NIGHT_FOG = new THREE.Color(0x0a0a2e);
    const SUNSET_SKY = new THREE.Color(0xFF7043); // transition color

    function init(containerEl, uiLayerEl) {
        if (isActive) return;
        isActive = true;
        container = containerEl;
        uiLayer = uiLayerEl;

        // Clean up
        container.innerHTML = '';
        uiLayer.innerHTML = '';

        // Scene - Farm World
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 30, 150);

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        container.appendChild(renderer.domElement);

        // Camera
        camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 55, 55);
        camera.lookAt(0, 0, 0);

        // OrbitControls for map movement and zoom
        if (window.THREE && window.THREE.OrbitControls) {
            controls = new window.THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.minDistance = 20;
            controls.maxDistance = 100;
            controls.maxPolarAngle = Math.PI / 2 - 0.1;
            controls.target.set(0, 0, 0);
        }

        // Lights (stored for day/night cycle)
        worldLights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(worldLights.ambient);

        worldLights.sun = new THREE.DirectionalLight(0xfffaed, 1.0);
        worldLights.sun.position.set(30, 50, 30);
        worldLights.sun.castShadow = true;
        worldLights.sun.shadow.mapSize.width = 2048;
        worldLights.sun.shadow.mapSize.height = 2048;
        worldLights.sun.shadow.camera.near = 0.5;
        worldLights.sun.shadow.camera.far = 150;
        worldLights.sun.shadow.camera.left = -50;
        worldLights.sun.shadow.camera.right = 50;
        worldLights.sun.shadow.camera.top = 50;
        worldLights.sun.shadow.camera.bottom = -50;
        scene.add(worldLights.sun);

        // Moon (hidden during day)
        const moonGeo = new THREE.SphereGeometry(3, 16, 16);
        const moonMat = new THREE.MeshBasicMaterial({ color: 0xFFFACD });
        worldLights.moon = new THREE.Mesh(moonGeo, moonMat);
        worldLights.moon.position.set(-40, 60, -30);
        worldLights.moon.visible = false;
        scene.add(worldLights.moon);

        // Moonlight
        worldLights.moonLight = new THREE.DirectionalLight(0x4466AA, 0);
        worldLights.moonLight.position.set(-40, 60, -30);
        scene.add(worldLights.moonLight);

        // Create Farm World
        createFarmWorld();

        // Raycaster for clicking
        raycaster = new THREE.Raycaster();
        mouse = new THREE.Vector2();

        // Event Listeners
        container.addEventListener('click', onClick);
        window.addEventListener('resize', onWindowResize);

        // Day/Night indicator
        const dayNightHud = document.createElement('div');
        dayNightHud.id = 'daynight-hud';
        dayNightHud.style.cssText = 'position:absolute;top:12px;left:12px;background:rgba(0,0,0,0.5);color:#fff;padding:6px 14px;border-radius:20px;font-size:16px;font-family:Arial,sans-serif;pointer-events:none;z-index:10;backdrop-filter:blur(4px);transition:background 2s;';
        dayNightHud.textContent = '☀️ Day';
        container.style.position = 'relative';
        container.appendChild(dayNightHud);
        dayNightState.hudElement = dayNightHud;

        // Load Agents
        loadAgents();

        // Start Animation
        animate();
    }

    function createFarmWorld() {
        // Ground - Grass
        const groundGeo = new THREE.PlaneGeometry(200, 200, 50, 50);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x7cfc00,
            roughness: 0.8,
            metalness: 0.1
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Dirt Paths (cross pattern from center)
        createPath(0, 0, 3, 60);
        createPath(0, 0, 60, 3);

        // Trees along the paths (line both sides)
        const pathTrees = [
            // Horizontal path trees
            [-20, 5], [-20, -5], [-10, 5], [-10, -5],
            [10, 5], [10, -5], [20, 5], [20, -5],
            // Vertical path trees
            [5, -10], [-5, -10], [5, 10], [-5, 10],
            [5, 20], [-5, 20], [5, -20], [-5, -20]
        ];
        pathTrees.forEach(([x, z]) => createTree(x, 0, z, 0.4 + Math.random() * 0.4));

        // Pond (bottom center)
        createPond(LOCATIONS.pond.x, LOCATIONS.pond.z);

        // === Many decorative trees in empty areas ===
        // Trees around pond (bottom)
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI + Math.PI;
            const r = 15 + Math.random() * 5;
            createTree(Math.cos(angle) * r, 0, LOCATIONS.pond.z + Math.sin(angle) * r, 0.8 + Math.random() * 0.6);
        }

        // Trees around farm (right side)
        for (let i = 0; i < 8; i++) {
            const angle = Math.PI + (i / 8) * Math.PI;
            const r = 12 + Math.random() * 5;
            createTree(LOCATIONS.farm.x + Math.cos(angle) * r, 0, LOCATIONS.farm.z + Math.sin(angle) * r, 0.8 + Math.random() * 0.6);
        }

        // Trees around forest (left)
        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + (i / 6) * Math.PI;
            const r = 12 + Math.random() * 4;
            createTree(LOCATIONS.forest.x + Math.cos(angle) * r, 0, LOCATIONS.forest.z + Math.sin(angle) * r, 0.8 + Math.random() * 0.5);
        }

        // Trees around house (more trees for cozy feel)
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const r = 7 + Math.random() * 5;
            createTree(LOCATIONS.house.x + Math.cos(angle) * r, 0, LOCATIONS.house.z + Math.sin(angle) * r, 0.5 + Math.random() * 0.7);
        }

        // Extra trees near house entrance and right side
        createTree(LOCATIONS.house.x + 6, 0, LOCATIONS.house.z + 2, 0.6);
        createTree(LOCATIONS.house.x - 6, 0, LOCATIONS.house.z + 3, 0.7);
        createTree(LOCATIONS.house.x + 4, 0, LOCATIONS.house.z - 4, 0.5);
        // Right side of house (more trees)
        createTree(LOCATIONS.house.x + 8, 0, LOCATIONS.house.z, 0.8);
        createTree(LOCATIONS.house.x + 10, 0, LOCATIONS.house.z + 3, 0.6);
        createTree(LOCATIONS.house.x + 9, 0, LOCATIONS.house.z - 3, 0.7);
        createTree(LOCATIONS.house.x + 12, 0, LOCATIONS.house.z - 1, 0.9);
        createTree(LOCATIONS.house.x + 14, 0, LOCATIONS.house.z + 5, 0.6);

        // Right side of house (towards farm) - small cute bushes
        const rightSideBushes = [
            [15, -22], [18, -20], [14, -18], [20, -25],
            [16, -28], [22, -22], [19, -30], [25, -18],
            [17, -15], [23, -28], [21, -32], [27, -25],
            [14, -32], [28, -20], [16, -35], [24, -35]
        ];
        rightSideBushes.forEach(([x, z]) => createSmallBush(x, 0, z));

        // Big trees scattered around
        const bigTreePositions = [
            [-35, -30], [-40, -10], [-45, 10], [-42, 30],
            [40, -30], [45, -5], [42, 20], [38, 35],
            [-20, 40], [25, 40], [0, -45], [-30, 45]
        ];
        bigTreePositions.forEach(([x, z]) => createBigTree(x, 0, z));

        // Benches
        createBench(-20, 0, -15, Math.PI / 4);
        createBench(15, 0, -10, -Math.PI / 4);
        createBench(-5, 0, 35, 0);
        createBench(30, 0, 15, Math.PI / 2);

        // Sign posts
        createSignPost(-25, 0, 0, Math.PI / 2);
        createSignPost(0, 0, 35, 0);
        createSignPost(35, 0, 0, -Math.PI / 2);
        createSignPost(-15, 0, -35, Math.PI);

        // Lamp posts
        createLampPost(-12, 0, -10);
        createLampPost(10, 0, -15);
        createLampPost(5, 0, 10);
        createLampPost(-18, 0, 10);

        // Mushrooms scattered
        for (let i = 0; i < 15; i++) {
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 80;
            const nearHouse = Math.sqrt((x - LOCATIONS.house.x) ** 2 + (z - LOCATIONS.house.z) ** 2) < 10;
            const nearPond = Math.sqrt((x - LOCATIONS.pond.x) ** 2 + (z - LOCATIONS.pond.z) ** 2) < 12;
            if (!nearHouse && !nearPond) {
                createMushroom(x, 0, z);
            }
        }

        // Corner trees (fill empty spaces)
        const cornerTrees = [
            [-45, -35], [-40, -40], [-45, 35], [-35, 45],
            [45, -35], [40, -40], [45, 35], [35, 45],
            [-50, 0], [50, 0], [0, -50], [0, 50]
        ];
        cornerTrees.forEach(([x, z]) => createTree(x, 0, z, 1 + Math.random() * 0.7));

        // More scattered trees across the map
        for (let i = 0; i < 50; i++) {
            const x = (Math.random() - 0.5) * 90;
            const z = (Math.random() - 0.5) * 90;
            // Avoid main areas
            const nearPond = Math.sqrt((x - LOCATIONS.pond.x) ** 2 + (z - LOCATIONS.pond.z) ** 2) < 18;
            const nearFarm = Math.sqrt((x - LOCATIONS.farm.x) ** 2 + (z - LOCATIONS.farm.z) ** 2) < 15;
            const nearHouse = Math.sqrt((x - LOCATIONS.house.x) ** 2 + (z - LOCATIONS.house.z) ** 2) < 12;
            const nearForest = Math.sqrt((x - LOCATIONS.forest.x) ** 2 + (z - LOCATIONS.forest.z) ** 2) < 15;
            const nearMine = Math.sqrt((x - LOCATIONS.mine.x) ** 2 + (z - LOCATIONS.mine.z) ** 2) < 12;
            const inPath = Math.abs(x) < 8 || Math.abs(z) < 8;
            if (!nearPond && !nearFarm && !nearHouse && !nearForest && !nearMine && !inPath) {
                createTree(x, 0, z, 0.5 + Math.random() * 1.0);
            }
        }

        // Trees along the edges
        const edgeTrees = [
            // Top edge
            [-30, -45], [-15, -48], [0, -45], [15, -48], [30, -45],
            // Bottom edge
            [-35, 45], [-20, 48], [20, 48], [35, 45],
            // Left edge
            [-48, -20], [-45, 0], [-48, 20],
            // Right edge
            [48, -20], [45, 0], [48, 20]
        ];
        edgeTrees.forEach(([x, z]) => createTree(x, 0, z, 0.7 + Math.random() * 0.8));

        // Flowers scattered (more for color)
        for (let i = 0; i < 150; i++) {
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 80;
            // Avoid main areas
            const inPath = Math.abs(x) < 8 || Math.abs(z) < 8;
            const nearPond = Math.sqrt((x - LOCATIONS.pond.x) ** 2 + (z - LOCATIONS.pond.z) ** 2) < 15;
            const nearFarm = Math.sqrt((x - LOCATIONS.farm.x) ** 2 + (z - LOCATIONS.farm.z) ** 2) < 12;
            const nearHouse = Math.sqrt((x - LOCATIONS.house.x) ** 2 + (z - LOCATIONS.house.z) ** 2) < 10;
            const nearForest = Math.sqrt((x - LOCATIONS.forest.x) ** 2 + (z - LOCATIONS.forest.z) ** 2) < 12;
            if (!inPath && !nearPond && !nearFarm && !nearHouse && !nearForest) {
                createFlower(x, 0, z);
            }
        }

        // Farm patches (right side - organized grid)
        const farmPatches = [
            [17, -8], [21, -8], [17, -4], [21, -4],
            [17, 0], [21, 0]
        ];
        farmPatches.forEach(([x, z]) => createFarmPatch(x, 0, z));

        // Fences around farm
        createFence(14, -6, 10, true);
        createFence(14, 2, 10, true);
        createFence(24, -6, 10, false);
        createFence(24, 2, 10, false);

        // Main house near center
        createFarmHouse(LOCATIONS.house.x, 0, LOCATIONS.house.z);

        // Office/Tech area (bottom-right)
        createOfficeArea(LOCATIONS.office.x, LOCATIONS.office.z);

        // Village area (along the road - back right)
        createVillageArea(LOCATIONS.village.x, LOCATIONS.village.z);

        // Rocket launch pad (back-center)
        createRocketPad(LOCATIONS.rocketPad.x, LOCATIONS.rocketPad.z);

        // High-speed rail (right edge)
        initHighSpeedRail();

        // Special mining events (meteor, helicopter, UFO)
        scheduleMinePEvents();

        // Star field (hidden during day, visible at night)
        createStarField();

        // Particle pool (fireworks, fire, smoke, sparkle - single draw call)
        initParticlePool();

        // Mountains in the distance
        createMountains();
    }

    function createMountains() {
        const mountainPositions = [
            // Left-back (behind forest)
            { x: -70, z: -40, scale: 1.0, emoji: '⛰️' },
            { x: -80, z: -25, scale: 0.9, emoji: '🏔️' },
            { x: -75, z: -50, scale: 1.1, emoji: '⛰️' },
            // Right-back (behind farm)
            { x: 70, z: -40, scale: 1.0, emoji: '🏔️' },
            { x: 80, z: -25, scale: 0.9, emoji: '⛰️' },
            { x: 75, z: -50, scale: 1.1, emoji: '🏔️' },
            // Top (behind everything)
            { x: -40, z: -70, scale: 0.9, emoji: '⛰️' },
            { x: -20, z: -80, scale: 1.2, emoji: '🏔️' },
            { x: 0, z: -75, scale: 1.4, emoji: '⛰️' },
            { x: 20, z: -80, scale: 1.2, emoji: '🏔️' },
            { x: 40, z: -70, scale: 0.9, emoji: '⛰️' },
            // Far corners
            { x: -60, z: -65, scale: 0.8, emoji: '⛰️' },
            { x: 60, z: -65, scale: 0.8, emoji: '🏔️' }
        ];

        mountainPositions.forEach(m => {
            const group = new THREE.Group();

            // Mountain peak (cone)
            const peakGeo = new THREE.ConeGeometry(8 * m.scale, 15 * m.scale, 6);
            const peakMat = new THREE.MeshStandardMaterial({
                color: 0x808080,
                roughness: 0.9,
                flatShading: true
            });
            const peak = new THREE.Mesh(peakGeo, peakMat);
            peak.position.y = 7 * m.scale;
            peak.castShadow = true;
            group.add(peak);

            // Snow cap
            const snowGeo = new THREE.ConeGeometry(3 * m.scale, 5 * m.scale, 6);
            const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const snow = new THREE.Mesh(snowGeo, snowMat);
            snow.position.y = 12 * m.scale;
            group.add(snow);

            // Emoji sprite for detail
            const sprite = createEmojiSprite(m.emoji);
            sprite.position.y = 18 * m.scale;
            sprite.scale.set(3, 3, 3);
            group.add(sprite);

            group.position.set(m.x, 0, m.z);
            scene.add(group);
        });
    }

    function createPath(x, z, width, length) {
        const pathGeo = new THREE.PlaneGeometry(width, length);
        const pathMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 1 });
        const path = new THREE.Mesh(pathGeo, pathMat);
        path.rotation.x = -Math.PI / 2;
        path.position.set(x, 0.01, z);
        path.receiveShadow = true;
        scene.add(path);
    }

    function createPond(x, z) {
        const pondGeo = new THREE.CircleGeometry(12, 32);
        const pondMat = new THREE.MeshStandardMaterial({
            color: 0x4169E1,
            roughness: 0.1,
            metalness: 0.3,
            transparent: true,
            opacity: 0.8
        });
        const pond = new THREE.Mesh(pondGeo, pondMat);
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(x, 0.02, z);
        scene.add(pond);

        // Lily pads
        for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 8;
            createLilyPad(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
        }
    }

    function createLilyPad(x, z) {
        const padGeo = new THREE.CircleGeometry(0.5, 16);
        const padMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(x, 0.03, z);
        scene.add(pad);
    }

    function createTree(x, y, z, scale) {
        const group = new THREE.Group();

        // Random tree type
        const treeType = Math.random();

        // Trunk
        const trunkHeight = 1.5 + Math.random() * 1.5;
        const trunkGeo = new THREE.CylinderGeometry(0.2 * scale, 0.4 * scale, trunkHeight * scale, 6);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 + Math.random() * 0x202020 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = (trunkHeight / 2) * scale;
        trunk.castShadow = true;
        group.add(trunk);

        // Different foliage styles
        const foliageColors = [0x2E7D32, 0x388E3C, 0x43A047, 0x1B5E20, 0x4CAF50];
        const foliageColor = foliageColors[Math.floor(Math.random() * foliageColors.length)];
        const foliageMat = new THREE.MeshStandardMaterial({ color: foliageColor });

        if (treeType < 0.4) {
            // Round sphere tree
            const foliageGeo = new THREE.SphereGeometry(1.8 * scale, 8, 8);
            const foliage = new THREE.Mesh(foliageGeo, foliageMat);
            foliage.position.y = (trunkHeight + 1) * scale;
            foliage.castShadow = true;
            group.add(foliage);
        } else if (treeType < 0.7) {
            // Cone pine tree
            const foliageGeo = new THREE.ConeGeometry(1.5 * scale, 3 * scale, 8);
            const foliage = new THREE.Mesh(foliageGeo, foliageMat);
            foliage.position.y = (trunkHeight + 1.5) * scale;
            foliage.castShadow = true;
            group.add(foliage);
        } else {
            // Multi-layer tree
            for (let i = 0; i < 3; i++) {
                const layerGeo = new THREE.ConeGeometry((1.5 - i * 0.3) * scale, (1.2 - i * 0.2) * scale, 8);
                const layer = new THREE.Mesh(layerGeo, foliageMat);
                layer.position.y = (trunkHeight + 0.5 + i * 0.8) * scale;
                layer.castShadow = true;
                group.add(layer);
            }
        }

        group.position.set(x, y, z);
        scene.add(group);
    }

    // Small cute bush
    function createSmallBush(x, y, z) {
        const group = new THREE.Group();
        const bushColors = [0x4CAF50, 0x66BB6A, 0x81C784, 0x2E7D32, 0x388E3C];
        const color = bushColors[Math.floor(Math.random() * bushColors.length)];
        const bushMat = new THREE.MeshStandardMaterial({ color: color });

        // Multiple small spheres for fluffy bush
        const numBalls = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < numBalls; i++) {
            const radius = 0.3 + Math.random() * 0.3;
            const ballGeo = new THREE.SphereGeometry(radius, 8, 8);
            const ball = new THREE.Mesh(ballGeo, bushMat);
            ball.position.set(
                (Math.random() - 0.5) * 0.6,
                radius + Math.random() * 0.2,
                (Math.random() - 0.5) * 0.6
            );
            ball.castShadow = true;
            group.add(ball);
        }

        group.position.set(x, y, z);
        scene.add(group);
    }

    // Bench
    function createBench(x, y, z, rotation = 0) {
        const group = new THREE.Group();

        // Seat
        const seatGeo = new THREE.BoxGeometry(1.5, 0.1, 0.5);
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const seat = new THREE.Mesh(seatGeo, woodMat);
        seat.position.y = 0.4;
        seat.castShadow = true;
        group.add(seat);

        // Back
        const backGeo = new THREE.BoxGeometry(1.5, 0.6, 0.08);
        const back = new THREE.Mesh(backGeo, woodMat);
        back.position.set(0, 0.7, -0.2);
        back.castShadow = true;
        group.add(back);

        // Legs
        const legGeo = new THREE.BoxGeometry(0.08, 0.4, 0.4);
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        [[-0.6, 0.2], [0.6, 0.2]].forEach(([dx, dz]) => {
            const leg = new THREE.Mesh(legGeo, metalMat);
            leg.position.set(dx, 0.2, dz);
            group.add(leg);
        });

        group.position.set(x, y, z);
        group.rotation.y = rotation;
        scene.add(group);
    }

    // Sign post
    function createSignPost(x, y, z, rotation = 0) {
        const group = new THREE.Group();

        // Pole
        const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 0.75;
        pole.castShadow = true;
        group.add(pole);

        // Sign board
        const signGeo = new THREE.BoxGeometry(0.6, 0.4, 0.05);
        const signMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const sign = new THREE.Mesh(signGeo, signMat);
        sign.position.y = 1.4;
        sign.castShadow = true;
        group.add(sign);

        // Arrow emoji on sign
        const arrowEmojis = ['➡️', '⬅️', '⬆️', '⬇️', '🧭'];
        const emoji = arrowEmojis[Math.floor(Math.random() * arrowEmojis.length)];
        const sprite = createEmojiSprite(emoji);
        sprite.position.y = 1.4;
        sprite.scale.set(0.5, 0.5, 0.5);
        group.add(sprite);

        group.position.set(x, y, z);
        group.rotation.y = rotation;
        scene.add(group);
    }

    // Lamp post
    function createLampPost(x, y, z) {
        const group = new THREE.Group();

        // Pole
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 2.5, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x2C2C2C });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.25;
        pole.castShadow = true;
        group.add(pole);

        // Lamp head
        const lampGeo = new THREE.SphereGeometry(0.25, 8, 8);
        const lampMat = new THREE.MeshBasicMaterial({ color: 0xFFE4B5 });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.y = 2.6;
        group.add(lamp);

        // Light glow
        const light = new THREE.PointLight(0xFFE4B5, 0.5, 8);
        light.position.y = 2.6;
        group.add(light);

        group.position.set(x, y, z);
        group.userData.isLampPost = true;
        group.userData.lampHead = lamp;
        group.userData.pointLight = light;
        nightObjects.lampPosts.push(group);
        scene.add(group);
    }

    // Big tree (much larger than normal trees)
    function createBigTree(x, y, z) {
        return createTree(x, y, z, 1.8 + Math.random() * 0.8);
    }

    // Mushroom decoration
    function createMushroom(x, y, z) {
        const group = new THREE.Group();

        // Stem
        const stemGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.3, 6);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xFFFAF0 });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.y = 0.15;
        group.add(stem);

        // Cap
        const capGeo = new THREE.SphereGeometry(0.2, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const capColors = [0xFF0000, 0xFFA500, 0x8B4513];
        const capMat = new THREE.MeshStandardMaterial({ color: capColors[Math.floor(Math.random() * capColors.length)] });
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 0.3;
        group.add(cap);

        group.position.set(x, y, z);
        scene.add(group);
    }

    function createFlower(x, y, z) {
        const colors = [0xFF69B4, 0xFFD700, 0xFF6347, 0xDA70D6, 0xFFFFFF];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.set(x, y + 0.25, z);

        const flowerGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const flowerMat = new THREE.MeshStandardMaterial({ color: color });
        const flower = new THREE.Mesh(flowerGeo, flowerMat);
        flower.position.set(x, y + 0.5, z);

        scene.add(stem);
        scene.add(flower);
    }

    function createFarmPatch(x, y, z) {
        const patchGeo = new THREE.BoxGeometry(4, 0.1, 4);
        const patchMat = new THREE.MeshStandardMaterial({ color: 0x654321 });
        const patch = new THREE.Mesh(patchGeo, patchMat);
        patch.position.set(x, y + 0.05, z);
        patch.receiveShadow = true;
        scene.add(patch);

        // Crops
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const cropGeo = new THREE.BoxGeometry(0.5, 0.3, 0.5);
                const cropMat = new THREE.MeshStandardMaterial({ color: 0x90EE90 });
                const crop = new THREE.Mesh(cropGeo, cropMat);
                crop.position.set(x - 1 + i * 1, y + 0.2, z - 1 + j * 1);
                scene.add(crop);
            }
        }
    }

    // Office/Tech area with computers
    function createOfficeArea(x, z) {
        const group = new THREE.Group();

        // Platform/floor
        const floorGeo = new THREE.BoxGeometry(14, 0.2, 10);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x607D8B });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.set(x, 0.1, z);
        floor.receiveShadow = true;
        scene.add(floor);

        // Desk with computers
        for (let i = 0; i < 3; i++) {
            createComputerDesk(x - 4 + i * 4, 0, z + 1);
        }

        // Office chair
        const chairGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.5, 8);
        const chairMat = new THREE.MeshStandardMaterial({ color: 0x424242 });
        const chair = new THREE.Mesh(chairGeo, chairMat);
        chair.position.set(x, 0.35, z - 1);
        scene.add(chair);

        // Add some small bushes around office
        const bushOffsets = [
            [x + 8, z - 5], [x + 8, z + 5], [x - 8, z - 5], [x - 8, z + 5]
        ];
        bushOffsets.forEach(([bx, bz]) => createSmallBush(bx, 0, bz));
    }

    function createComputerDesk(x, y, z) {
        const group = new THREE.Group();

        // Desk
        const deskGeo = new THREE.BoxGeometry(2.5, 0.1, 1);
        const deskMat = new THREE.MeshStandardMaterial({ color: 0x8D6E63 });
        const desk = new THREE.Mesh(deskGeo, deskMat);
        desk.position.set(x, 0.8, z);
        desk.castShadow = true;
        scene.add(desk);

        // Desk legs
        const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 });
        [[-1, -0.3], [-1, 0.3], [1, -0.3], [1, 0.3]].forEach(([dx, dz]) => {
            const leg = new THREE.Mesh(legGeo, legMat);
            leg.position.set(x + dx, 0.4, z + dz);
            scene.add(leg);
        });

        // Monitor
        const monitorGeo = new THREE.BoxGeometry(0.8, 0.6, 0.05);
        const monitorMat = new THREE.MeshStandardMaterial({ color: 0x212121 });
        const monitor = new THREE.Mesh(monitorGeo, monitorMat);
        monitor.position.set(x, 1.2, z - 0.4);
        scene.add(monitor);

        // Screen glow
        const screenGeo = new THREE.PlaneGeometry(0.7, 0.5);
        const screenMat = new THREE.MeshBasicMaterial({ color: 0x4FC3F7, transparent: true, opacity: 0.8 });
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.position.set(x, 1.2, z - 0.37);
        screen.userData.isScreen = true;
        nightObjects.screenMeshes.push(screen);
        scene.add(screen);

        // Keyboard
        const keyGeo = new THREE.BoxGeometry(0.6, 0.05, 0.2);
        const keyMat = new THREE.MeshStandardMaterial({ color: 0x424242 });
        const keyboard = new THREE.Mesh(keyGeo, keyMat);
        keyboard.position.set(x, 0.83, z + 0.2);
        scene.add(keyboard);
    }

    // ===== Unified Particle Pool System (GPU-friendly, single draw call) =====
    const MAX_PARTICLES = 600;
    const particlePool = {
        positions: null,  // Float32Array
        colors: null,     // Float32Array
        sizes: null,      // Float32Array
        velocities: [],   // per-particle { vx, vy, vz }
        lifetimes: [],    // per-particle { start, duration, fadeStyle }
        active: [],       // boolean per slot
        geometry: null,
        points: null,
        count: 0
    };

    function initParticlePool() {
        const pp = particlePool;
        pp.positions = new Float32Array(MAX_PARTICLES * 3);
        pp.colors = new Float32Array(MAX_PARTICLES * 3);
        pp.sizes = new Float32Array(MAX_PARTICLES);
        pp.velocities = new Array(MAX_PARTICLES);
        pp.lifetimes = new Array(MAX_PARTICLES);
        pp.active = new Array(MAX_PARTICLES).fill(false);
        pp.count = 0;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            pp.positions[i * 3] = 0;
            pp.positions[i * 3 + 1] = -9999; // hidden below ground
            pp.positions[i * 3 + 2] = 0;
            pp.colors[i * 3] = 1; pp.colors[i * 3 + 1] = 1; pp.colors[i * 3 + 2] = 1;
            pp.sizes[i] = 0;
            pp.velocities[i] = { vx: 0, vy: 0, vz: 0 };
            pp.lifetimes[i] = { start: 0, duration: 1000, gravity: 0, expand: 0 };
        }

        pp.geometry = new THREE.BufferGeometry();
        pp.geometry.setAttribute('position', new THREE.BufferAttribute(pp.positions, 3));
        pp.geometry.setAttribute('color', new THREE.BufferAttribute(pp.colors, 3));
        pp.geometry.setAttribute('size', new THREE.BufferAttribute(pp.sizes, 1));

        // Use a soft circle texture for particles
        const pCanvas = document.createElement('canvas');
        pCanvas.width = 32; pCanvas.height = 32;
        const pCtx = pCanvas.getContext('2d');
        const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        pCtx.fillStyle = grad;
        pCtx.fillRect(0, 0, 32, 32);
        const pTexture = new THREE.CanvasTexture(pCanvas);

        const pMaterial = new THREE.PointsMaterial({
            size: 1,
            map: pTexture,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });

        pp.points = new THREE.Points(pp.geometry, pMaterial);
        pp.points.frustumCulled = false;
        scene.add(pp.points);
    }

    function spawnParticle(x, y, z, vx, vy, vz, r, g, b, size, duration, gravity, expand) {
        const pp = particlePool;
        // Find free slot
        let idx = -1;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!pp.active[i]) { idx = i; break; }
        }
        if (idx === -1) return; // Pool full

        pp.active[idx] = true;
        pp.positions[idx * 3] = x;
        pp.positions[idx * 3 + 1] = y;
        pp.positions[idx * 3 + 2] = z;
        pp.colors[idx * 3] = r;
        pp.colors[idx * 3 + 1] = g;
        pp.colors[idx * 3 + 2] = b;
        pp.sizes[idx] = size;
        pp.velocities[idx] = { vx, vy, vz };
        pp.lifetimes[idx] = {
            start: Date.now(), duration,
            gravity: gravity || 0, expand: expand || 0,
            origR: r, origG: g, origB: b, origSize: size
        };
        pp.count = Math.max(pp.count, idx + 1);
    }

    function updateParticlePool() {
        const pp = particlePool;
        if (!pp.geometry) return;
        const now = Date.now();
        let maxActive = 0;

        for (let i = 0; i < pp.count; i++) {
            if (!pp.active[i]) continue;

            const lt = pp.lifetimes[i];
            const t = (now - lt.start) / lt.duration;

            if (t >= 1) {
                // Kill particle
                pp.active[i] = false;
                pp.positions[i * 3 + 1] = -9999;
                pp.sizes[i] = 0;
                continue;
            }

            maxActive = i + 1;
            const vel = pp.velocities[i];

            // Update position
            pp.positions[i * 3] += vel.vx;
            pp.positions[i * 3 + 1] += vel.vy;
            pp.positions[i * 3 + 2] += vel.vz;

            // Apply gravity
            vel.vy -= lt.gravity;

            // Size: expand then shrink in last 30%
            const fade = t < 0.7 ? 1 : (1 - t) / 0.3;
            pp.sizes[i] = lt.origSize * (1 + lt.expand * t) * fade;

            // Color: keep vivid original color, fade brightness only in last 40%
            const colorFade = t < 0.6 ? 1 : (1 - t) / 0.4;
            pp.colors[i * 3] = lt.origR * colorFade;
            pp.colors[i * 3 + 1] = lt.origG * colorFade;
            pp.colors[i * 3 + 2] = lt.origB * colorFade;
        }

        pp.count = maxActive;
        pp.geometry.attributes.position.needsUpdate = true;
        pp.geometry.attributes.color.needsUpdate = true;
        pp.geometry.attributes.size.needsUpdate = true;
    }

    // Helper: hex color to RGB (0-1)
    function hexToRgb(hex) {
        return {
            r: ((hex >> 16) & 0xFF) / 255,
            g: ((hex >> 8) & 0xFF) / 255,
            b: (hex & 0xFF) / 255
        };
    }

    // Sparkle effect for valuable ores
    function createSparkleEffect(x, y, z, oreType) {
        let color;
        switch (oreType) {
            case 'gold': color = 0xFFD700; break;
            case 'diamond': color = 0x00FFFF; break;
            case 'emerald': color = 0x00FF00; break;
            case 'amethyst': color = 0xFF00FF; break;
            default: color = 0xFFFFFF;
        }
        const c = hexToRgb(color);
        for (let i = 0; i < 8; i++) {
            spawnParticle(
                x + (Math.random() - 0.5) * 1.5,
                y + Math.random() * 1.5,
                z + (Math.random() - 0.5) * 1.5,
                0, 0.03, 0,
                c.r, c.g, c.b,
                0.6, 1500, 0, 0
            );
        }
    }

    // Village area with houses along road
    const builtHouses = []; // Track built houses

    function createVillageArea(x, z) {
        // Create a village layout with houses along the road
        // Row 1 (closest to road)
        createVillagePlot(x - 12, z + 2, 1);
        createVillagePlot(x - 6, z + 2, 1);
        createVillagePlot(x, z + 2, 1);
        createVillagePlot(x + 6, z + 2, 1);
        createVillagePlot(x + 12, z + 2, 1);

        // Row 2
        createVillagePlot(x - 12, z + 8, 2);
        createVillagePlot(x - 6, z + 8, 2);
        createVillagePlot(x, z + 8, 2);
        createVillagePlot(x + 6, z + 8, 2);
        createVillagePlot(x + 12, z + 8, 2);

        // Row 3
        createVillagePlot(x - 9, z + 14, 3);
        createVillagePlot(x, z + 14, 3);
        createVillagePlot(x + 9, z + 14, 3);
    }

    function createVillagePlot(x, z, row) {
        const group = new THREE.Group();

        // Foundation
        const foundationGeo = new THREE.BoxGeometry(5, 0.3, 4);
        const foundationMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
        const foundation = new THREE.Mesh(foundationGeo, foundationMat);
        foundation.position.y = 0.15;
        foundation.receiveShadow = true;
        group.add(foundation);

        // Plot marker (empty foundation waiting for house)
        group.userData = {
            type: 'villagePlot',
            hasHouse: false,
            houseType: null,
            row: row,
            x: x,
            z: z
        };

        group.position.set(x, 0, z);
        scene.add(group);
    }

    const MAX_FLOORS = 6; // Max floors per building
    const BUILD_COOLDOWN = 12000; // 12 seconds cooldown per plot after building
    const GLOBAL_BUILD_COOLDOWN = 8000; // 8s global cooldown - only one build at a time
    let lastGlobalBuildTime = 0;

    function buildHouse(plot, buildingType = 'wood') {
        const data = plot.userData;
        const now = Date.now();

        // Global cooldown - only one build across the whole village at a time
        if ((now - lastGlobalBuildTime) < GLOBAL_BUILD_COOLDOWN) {
            return false;
        }

        // Per-plot cooldown
        if (data.lastBuildTime && (now - data.lastBuildTime) < BUILD_COOLDOWN) {
            return false;
        }

        // Check max floors
        if (data.currentFloor && data.currentFloor >= MAX_FLOORS) {
            return false; // Already at max height
        }

        // Higher floors cost more resources
        const floorMultiplier = 1 + (data.currentFloor || 0);
        let needed = (buildingType === 'wood' ? WOOD_NEEDED_PER_HOUSE : ORE_NEEDED_PER_HOUSE) * floorMultiplier;
        let inventory = buildingType === 'wood' ? woodInventory : oreInventory;

        if (inventory < needed) {
            return false; // Not enough resources
        }

        // Initialize house data if first floor
        if (!data.currentFloor) {
            // Choose house type based on row (higher rows = bigger houses)
            const houseType = HOUSE_TYPES[Math.min(data.row - 1, HOUSE_TYPES.length - 1)];
            data.houseType = houseType;
            data.buildingType = buildingType;
            data.currentFloor = 0;
        }

        // Consume resources for one floor
        if (buildingType === 'wood') {
            woodInventory -= needed;
        } else {
            oreInventory -= needed;
        }

        // Build one floor
        buildHouseOnPlot(plot, data.houseType, buildingType, data.currentFloor);

        data.currentFloor++;
        data.lastBuildTime = now; // Set per-plot cooldown
        lastGlobalBuildTime = now; // Set global cooldown
        data.hasHouse = true;

        // Only drop celebration on first floor
        if (data.currentFloor === 1) {
            dropItem(plot.position.x, plot.position.z + 2, 'ore', '🎉');
            dropItem(plot.position.x + 1, plot.position.z + 1, 'ore', '🎊');
        }

        return true;
    }

    function buildHouseOnPlot(plot, houseType, buildingType = 'wood', floorToBuild = 0) {
        const x = plot.position.x;
        const z = plot.position.z;
        const floor = floorToBuild;

        // Different colors based on building type
        let color, roofColor;
        if (buildingType === 'wood') {
            // Wood houses - warm colors
            color = houseType.color;
            roofColor = houseType.roofColor;
        } else {
            // Ore houses - metallic/crystal colors
            const oreColors = [
                { color: 0x708090, roofColor: 0x2F4F4F }, // Stone/slate
                { color: 0xB0C4DE, roofColor: 0x4682B4 }, // Steel blue
                { color: 0xD8BFD8, roofColor: 0x8B008B }, // Amethyst
                { color: 0x98FB98, roofColor: 0x228B22 }, // Emerald
                { color: 0xFFD700, roofColor: 0xB8860B }, // Gold
            ];
            const oreStyle = oreColors[Math.floor(Math.random() * oreColors.length)];
            color = oreStyle.color;
            roofColor = oreStyle.roofColor;
        }

        // Build only the specified floor (towers get narrower as they go up)
        const floorHeight = floor * 2.5;
        const floorWidth = Math.max(1.5, 4 - floor * 0.15); // Can go higher before getting too narrow
        const floorDepth = Math.max(1.2, 3 - floor * 0.1);

        // Floor
        const floorGeo = new THREE.BoxGeometry(floorWidth, 2, floorDepth);
        const floorMat = new THREE.MeshStandardMaterial({
            color: color,
            metalness: buildingType === 'ore' ? 0.5 : 0.1,
            roughness: buildingType === 'ore' ? 0.3 : 0.8
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.position.set(x, 1 + floorHeight, z);
        floorMesh.castShadow = true;
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);

        // Windows (different colors for ore houses)
        for (let w = -1; w <= 1; w += 2) {
            const windowGeo = new THREE.PlaneGeometry(0.5, 0.7);
            const windowColor = buildingType === 'ore' ? 0x00FFFF : 0x87CEEB; // Cyan for ore, blue for wood
            const windowMat = new THREE.MeshBasicMaterial({ color: windowColor });
            const windowMesh = new THREE.Mesh(windowGeo, windowMat);
            windowMesh.position.set(x + w * 1.2, 1.5 + floorHeight, z + floorDepth / 2 + 0.01);
            windowMesh.userData.isWindow = true;
            windowMesh.userData.dayColor = windowColor;
            nightObjects.windowMeshes.push(windowMesh);
            scene.add(windowMesh);
        }

        // Add roof/cap to each floor (so it looks like building up)
        const roofGeo = new THREE.ConeGeometry(floorWidth * 0.7, 1.5, 4);
        const roofMat = new THREE.MeshStandardMaterial({
            color: roofColor,
            metalness: buildingType === 'ore' ? 0.6 : 0.1,
            roughness: buildingType === 'ore' ? 0.2 : 0.7
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(x, 2 + floorHeight + 0.75, z);
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        scene.add(roof);

        // Add floor to built houses
        builtHouses.push({ plot: plot, type: houseType, buildingType: buildingType, floor: floor });
    }

    // ===== Rocket Launch Pad System =====
    const ROCKET_STAGES = 3;
    const ROCKET_WOOD_PER_STAGE = [2, 3, 3];
    const ROCKET_ORE_PER_STAGE = [1, 2, 2];
    const ROCKET_BUILD_COOLDOWN = 8000;
    let rocketState = {
        currentStage: 0,
        isLaunching: false,
        lastBuildTime: 0,
        meshes: [],
        padGroup: null,
        rocketGroup: null
    };

    function spawnFireParticle(x, y, z) {
        const colors = [0xFF4500, 0xFF6600, 0xFFAA00, 0xFFFF00];
        const c = hexToRgb(colors[Math.floor(Math.random() * colors.length)]);
        spawnParticle(
            x + (Math.random() - 0.5) * 2,
            y + (Math.random() - 0.5),
            z + (Math.random() - 0.5) * 2,
            0, -0.02, 0,
            c.r, c.g, c.b,
            0.8 + Math.random() * 0.5, 800 + Math.random() * 600, 0, 0
        );
    }

    function spawnSmokeParticle(x, y, z) {
        spawnParticle(
            x + (Math.random() - 0.5) * 3, y,
            z + (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 0.02, 0.02, (Math.random() - 0.5) * 0.02,
            0.8, 0.8, 0.8,
            1.5 + Math.random() * 1.5, 2000 + Math.random() * 1000, 0, 2
        );
    }

    // ===== Fireworks System =====
    const FIREWORK_COLORS = [
        [0xFF1744, 0xFF5252, 0xFF8A80],   // Red
        [0x2979FF, 0x448AFF, 0x82B1FF],   // Blue
        [0x00E676, 0x69F0AE, 0xB9F6CA],   // Green
        [0xFFD600, 0xFFFF00, 0xFFFF8D],   // Yellow
        [0xE040FB, 0xEA80FC, 0xF8BBD0],   // Pink/Purple
        [0xFF9100, 0xFFAB40, 0xFFD180],   // Orange
        [0x00E5FF, 0x18FFFF, 0x84FFFF],   // Cyan
        [0xFFFFFF, 0xE0E0E0, 0xFFD700],   // White/Gold
    ];

    // Shared lightweight geometries for firework rockets (reused, never disposed per-launch)
    const _fwRocketGeo = new THREE.SphereGeometry(0.2, 6, 6);

    function launchFirework(x, z) {
        const palette = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        const peakY = 15 + Math.random() * 10;
        const launchDur = 700 + Math.random() * 400;

        // Visible ascending rocket (single reusable geo, cheap MeshBasicMaterial)
        const rocketMat = new THREE.MeshBasicMaterial({ color: palette[0] });
        const rocket = new THREE.Mesh(_fwRocketGeo, rocketMat);
        rocket.position.set(x, 0, z);
        scene.add(rocket);

        const launchStart = Date.now();
        const trailC = hexToRgb(palette[0]);

        (function animRocket() {
            const elapsed = Date.now() - launchStart;
            const t = elapsed / launchDur;
            if (t >= 1) {
                scene.remove(rocket);
                rocketMat.dispose();
                explodeFirework(x, peakY, z, palette);
                return;
            }
            // Accelerating rise (quadratic ease-in)
            rocket.position.y = peakY * t * t;
            rocket.position.x = x + Math.sin(elapsed * 0.02) * 0.1; // slight wobble

            // Tail trail particles (every few frames)
            if (Math.random() < 0.5) {
                spawnParticle(
                    rocket.position.x + (Math.random() - 0.5) * 0.2,
                    rocket.position.y - 0.3,
                    rocket.position.z + (Math.random() - 0.5) * 0.2,
                    (Math.random() - 0.5) * 0.01, -0.04, (Math.random() - 0.5) * 0.01,
                    trailC.r, trailC.g * 0.7, trailC.b * 0.3,
                    0.6, 500, 0, 0
                );
            }
            requestAnimationFrame(animRocket);
        })();
    }

    function explodeFirework(x, y, z, palette) {
        const sparkCount = 40 + Math.floor(Math.random() * 20);
        const pattern = Math.random();
        const isNight = dayNightState.transition > 0.4;
        const brightness = isNight ? 3.0 : 1.5;

        // Mix multiple palettes for more colorful explosions
        const extraPalette = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        const allColors = [...palette, ...extraPalette];

        for (let i = 0; i < sparkCount; i++) {
            const color = allColors[Math.floor(Math.random() * allColors.length)];
            const c = hexToRgb(color);

            let vx, vy, vz;
            if (pattern < 0.3) {
                // Sphere burst
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const speed = 0.1 + Math.random() * 0.15;
                vx = Math.sin(phi) * Math.cos(theta) * speed;
                vy = Math.sin(phi) * Math.sin(theta) * speed;
                vz = Math.cos(phi) * speed;
            } else if (pattern < 0.6) {
                // Ring burst
                const theta = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.3;
                const speed = 0.12 + Math.random() * 0.04;
                vx = Math.cos(theta) * speed;
                vy = (Math.random() - 0.5) * 0.05;
                vz = Math.sin(theta) * speed;
            } else {
                // Willow (drooping)
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const speed = 0.07 + Math.random() * 0.09;
                vx = Math.sin(phi) * Math.cos(theta) * speed;
                vy = Math.abs(Math.sin(phi) * Math.sin(theta)) * speed * 0.6;
                vz = Math.cos(phi) * speed;
            }

            spawnParticle(
                x + (Math.random() - 0.5) * 0.5,
                y + (Math.random() - 0.5) * 0.5,
                z + (Math.random() - 0.5) * 0.5,
                vx, vy, vz,
                c.r * brightness, c.g * brightness, c.b * brightness,
                1.0 + Math.random() * 0.8,
                1500 + Math.random() * 1200,
                0.0008, 0
            );
        }
    }

    // ===== Special Mining Events System =====
    const RARE_ORES = ['💎', '🔮', '🟢', '🪙', '✨', '⭐'];
    const MINE_EVENT_INTERVAL = 25000 + Math.random() * 20000; // 25-45s
    let lastMineEvent = 0;

    function scheduleMinePEvents() {
        function tick() {
            if (!isActive) return; // Stop event loop if disposed
            const now = Date.now();
            if (now - lastMineEvent > MINE_EVENT_INTERVAL) {
                lastMineEvent = now;
                const roll = Math.random();
                if (roll < 0.4) {
                    spawnMeteor();
                } else if (roll < 0.7) {
                    spawnHelicopterDrop();
                } else {
                    spawnUFO();
                }
            }
            setTimeout(tick, 5000 + Math.random() * 5000);
        }
        setTimeout(tick, 15000); // First event after 15s
    }

    // --- EVENT 1: Meteor Strike ---
    function spawnMeteor() {
        const mx = LOCATIONS.mine.x + (Math.random() - 0.5) * 12;
        const mz = LOCATIONS.mine.z + (Math.random() - 0.5) * 12;

        // Meteor mesh - irregular rocky sphere
        const meteorGroup = new THREE.Group();

        // Core rock
        const coreGeo = new THREE.DodecahedronGeometry(1.2, 1);
        const coreMat = new THREE.MeshStandardMaterial({
            color: 0x4A3728, roughness: 0.7, metalness: 0.4
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        meteorGroup.add(core);

        // Glowing magma cracks
        const crackGeo = new THREE.DodecahedronGeometry(1.25, 0);
        const crackMat = new THREE.MeshBasicMaterial({
            color: 0xFF4500, wireframe: true
        });
        const cracks = new THREE.Mesh(crackGeo, crackMat);
        meteorGroup.add(cracks);

        // Emissive glow halo
        const glowGeo = new THREE.SphereGeometry(1.6, 8, 8);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xFF6600, transparent: true, opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        meteorGroup.add(glow);

        // Start high up and to the side
        const startX = mx + 30, startY = 50, startZ = mz - 20;
        meteorGroup.position.set(startX, startY, startZ);
        scene.add(meteorGroup);

        const fallDur = 1500;
        const fallStart = Date.now();

        // Fire trail while falling
        (function animMeteor() {
            if (!isActive) return;
            const t = (Date.now() - fallStart) / fallDur;
            if (t >= 1) {
                scene.remove(meteorGroup);
                coreGeo.dispose(); coreMat.dispose();
                crackGeo.dispose(); crackMat.dispose();
                glowGeo.dispose(); glowMat.dispose();
                meteorImpact(mx, mz);
                return;
            }

            // Diagonal fall path
            meteorGroup.position.x = startX + (mx - startX) * t;
            meteorGroup.position.y = startY + (0.5 - startY) * (t * t); // accelerate
            meteorGroup.position.z = startZ + (mz - startZ) * t;
            meteorGroup.rotation.x += 0.1;
            meteorGroup.rotation.z += 0.08;

            // Scale down as it approaches
            const s = 1 - t * 0.3;
            meteorGroup.scale.setScalar(s);

            // Fire trail particles
            if (Math.random() < 0.7) {
                const c = hexToRgb([0xFF4500, 0xFF6600, 0xFFAA00][Math.floor(Math.random() * 3)]);
                spawnParticle(
                    meteorGroup.position.x + (Math.random() - 0.5),
                    meteorGroup.position.y + (Math.random() - 0.5),
                    meteorGroup.position.z + (Math.random() - 0.5),
                    (Math.random() - 0.5) * 0.03, 0.02, (Math.random() - 0.5) * 0.03,
                    c.r, c.g, c.b,
                    1.2, 600, 0, 0
                );
            }
            requestAnimationFrame(animMeteor);
        })();
    }

    function meteorImpact(x, z) {
        // Big explosion particles
        for (let i = 0; i < 25; i++) {
            const c = hexToRgb([0xFF4500, 0xFF8C00, 0xFFD700, 0xFF6347][Math.floor(Math.random() * 4)]);
            const theta = Math.random() * Math.PI * 2;
            const speed = 0.08 + Math.random() * 0.15;
            spawnParticle(
                x, 1, z,
                Math.cos(theta) * speed, 0.05 + Math.random() * 0.1, Math.sin(theta) * speed,
                c.r, c.g, c.b,
                1.5 + Math.random(), 1200, 0.002, 0
            );
        }
        // Smoke cloud
        for (let i = 0; i < 10; i++) {
            spawnParticle(
                x + (Math.random() - 0.5) * 3, 0.5, z + (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 0.02, 0.03, (Math.random() - 0.5) * 0.02,
                0.6, 0.5, 0.4,
                2, 2000, 0, 3
            );
        }

        // Drop rare ores scattered from impact
        oreInventory += 5 + Math.floor(Math.random() * 4);
        const numDrops = 6 + Math.floor(Math.random() * 5);
        for (let i = 0; i < numDrops; i++) {
            const ox = x + (Math.random() - 0.5) * 8;
            const oz = z + (Math.random() - 0.5) * 8;
            const emoji = RARE_ORES[Math.floor(Math.random() * RARE_ORES.length)];
            setTimeout(() => {
                dropItem(ox, oz, 'ore', emoji);
                createSparkleEffect(ox, 0.5, oz, 'gold');
            }, i * 150);
        }

        // Create a small crater mesh (temporary)
        const craterGeo = new THREE.CylinderGeometry(2.5, 2, 0.4, 12);
        const craterMat = new THREE.MeshStandardMaterial({ color: 0x2C1810, roughness: 1 });
        const crater = new THREE.Mesh(craterGeo, craterMat);
        crater.position.set(x, 0.1, z);
        scene.add(crater);
        setTimeout(() => { scene.remove(crater); craterGeo.dispose(); craterMat.dispose(); }, 20000);
    }

    // --- EVENT 2: Helicopter Airdrop ---
    function spawnHelicopterDrop() {
        const dropX = LOCATIONS.mine.x + (Math.random() - 0.5) * 10;
        const dropZ = LOCATIONS.mine.z + (Math.random() - 0.5) * 10;

        const heli = new THREE.Group();

        // Fuselage
        // Use CylinderGeometry as fallback for older Three.js versions without CapsuleGeometry
        const bodyGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.5, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2E7D32, metalness: 0.4, roughness: 0.5 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.rotation.z = Math.PI / 2;
        body.position.y = 0;
        heli.add(body);

        // Cockpit glass
        const cockpitGeo = new THREE.SphereGeometry(0.55, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const cockpitMat = new THREE.MeshStandardMaterial({
            color: 0x81D4FA, metalness: 0.7, roughness: 0.1, transparent: true, opacity: 0.6
        });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(1.2, 0.2, 0);
        cockpit.rotation.z = -Math.PI / 4;
        heli.add(cockpit);

        // Tail boom
        const tailGeo = new THREE.CylinderGeometry(0.15, 0.25, 2.5, 6);
        const tailMat = new THREE.MeshStandardMaterial({ color: 0x388E3C });
        const tail = new THREE.Mesh(tailGeo, tailMat);
        tail.rotation.z = Math.PI / 2;
        tail.position.set(-2.2, 0.2, 0);
        heli.add(tail);

        // Tail fin
        const finGeo = new THREE.BoxGeometry(0.05, 0.8, 0.5);
        const finMat = new THREE.MeshStandardMaterial({ color: 0xFF0000 });
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(-3.3, 0.5, 0);
        heli.add(fin);

        // Tail rotor
        const tailRotorGeo = new THREE.BoxGeometry(0.05, 0.7, 0.08);
        const tailRotorMat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, metalness: 0.8 });
        const tailRotor = new THREE.Mesh(tailRotorGeo, tailRotorMat);
        tailRotor.position.set(-3.3, 0.5, 0.3);
        heli.add(tailRotor);
        heli.userData.tailRotor = tailRotor;

        // Main rotor (disc for efficiency)
        const rotorGroup = new THREE.Group();
        for (let b = 0; b < 4; b++) {
            const bladeGeo = new THREE.BoxGeometry(3.5, 0.03, 0.2);
            const bladeMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7 });
            const blade = new THREE.Mesh(bladeGeo, bladeMat);
            blade.rotation.y = (b / 4) * Math.PI;
            rotorGroup.add(blade);
        }
        rotorGroup.position.y = 0.65;
        heli.add(rotorGroup);
        heli.userData.rotor = rotorGroup;

        // Landing skids
        const skidMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        [-0.5, 0.5].forEach(sz => {
            const skidGeo = new THREE.CylinderGeometry(0.04, 0.04, 2, 6);
            const skid = new THREE.Mesh(skidGeo, skidMat);
            skid.rotation.z = Math.PI / 2;
            skid.position.set(0, -0.7, sz);
            heli.add(skid);
            // Struts
            [-0.5, 0.5].forEach(sx => {
                const strutGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4);
                const strut = new THREE.Mesh(strutGeo, skidMat);
                strut.position.set(sx, -0.45, sz);
                heli.add(strut);
            });
        });

        // Gift box hanging below
        const boxGroup = new THREE.Group();
        const boxGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        const boxCanvas = document.createElement('canvas');
        boxCanvas.width = 64; boxCanvas.height = 64;
        const bCtx = boxCanvas.getContext('2d');
        bCtx.fillStyle = '#E53935';
        bCtx.fillRect(0, 0, 64, 64);
        bCtx.fillStyle = '#FFD600';
        bCtx.fillRect(28, 0, 8, 64); // vertical ribbon
        bCtx.fillRect(0, 28, 64, 8); // horizontal ribbon
        const boxTex = new THREE.CanvasTexture(boxCanvas);
        const boxMat = new THREE.MeshStandardMaterial({ map: boxTex });
        const box = new THREE.Mesh(boxGeo, boxMat);
        boxGroup.add(box);

        // Bow on top
        const bowGeo = new THREE.SphereGeometry(0.3, 6, 6);
        const bowMat = new THREE.MeshStandardMaterial({ color: 0xFFD600 });
        const bow = new THREE.Mesh(bowGeo, bowMat);
        bow.position.y = 0.7;
        bow.scale.set(1, 0.5, 1);
        boxGroup.add(bow);

        // Rope
        const ropeGeo = new THREE.CylinderGeometry(0.02, 0.02, 2, 4);
        const ropeMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
        const rope = new THREE.Mesh(ropeGeo, ropeMat);
        rope.position.y = 1.6;
        boxGroup.add(rope);

        boxGroup.position.y = -3;
        heli.add(boxGroup);
        heli.userData.boxGroup = boxGroup;

        // Start from far left, fly to drop point, hover, drop, fly away
        const startX = LOCATIONS.mine.x - 60;
        const flyY = 18;
        heli.position.set(startX, flyY, dropZ);
        scene.add(heli);

        const flyInDur = 3000;
        const hoverDur = 2000;
        const flyOutDur = 3000;
        const totalDur = flyInDur + hoverDur + flyOutDur;
        const animStart = Date.now();
        let dropped = false;

        (function animHeli() {
            if (!isActive) return;
            const elapsed = Date.now() - animStart;
            if (elapsed > totalDur) {
                // Cleanup
                scene.remove(heli);
                heli.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                });
                return;
            }

            // Rotor spin
            heli.userData.rotor.rotation.y += 0.5;
            heli.userData.tailRotor.rotation.z += 0.8;

            if (elapsed < flyInDur) {
                // Fly in
                const t = elapsed / flyInDur;
                const eased = t * t * (3 - 2 * t);
                heli.position.x = startX + (dropX - startX) * eased;
                heli.position.y = flyY + Math.sin(t * 4) * 0.3;
            } else if (elapsed < flyInDur + hoverDur) {
                // Hover over drop point
                heli.position.x = dropX;
                heli.position.y = flyY + Math.sin(elapsed * 0.005) * 0.2;

                // Drop the box at midpoint of hover
                if (!dropped && elapsed > flyInDur + hoverDur * 0.5) {
                    dropped = true;
                    dropGiftBox(dropX, flyY - 3, dropZ);
                    heli.remove(boxGroup);
                    boxGroup.traverse(child => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (child.material.map) child.material.map.dispose();
                            child.material.dispose();
                        }
                    });
                }
            } else {
                // Fly out to the right
                const t = (elapsed - flyInDur - hoverDur) / flyOutDur;
                const eased = t * t;
                heli.position.x = dropX + (dropX + 60 - dropX) * eased;
                heli.position.y = flyY + t * 5;
            }

            requestAnimationFrame(animHeli);
        })();
    }

    function dropGiftBox(x, y, z) {
        // Falling gift box
        const boxGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        const boxCanvas = document.createElement('canvas');
        boxCanvas.width = 64; boxCanvas.height = 64;
        const bCtx = boxCanvas.getContext('2d');
        bCtx.fillStyle = '#E53935';
        bCtx.fillRect(0, 0, 64, 64);
        bCtx.fillStyle = '#FFD600';
        bCtx.fillRect(28, 0, 8, 64);
        bCtx.fillRect(0, 28, 64, 8);
        const boxTex = new THREE.CanvasTexture(boxCanvas);
        const boxMat = new THREE.MeshStandardMaterial({ map: boxTex });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(x, y, z);
        scene.add(box);

        // Parachute
        const chuteGeo = new THREE.SphereGeometry(1.5, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const chuteMat = new THREE.MeshStandardMaterial({
            color: 0xFFFFFF, transparent: true, opacity: 0.8, side: THREE.DoubleSide
        });
        const chute = new THREE.Mesh(chuteGeo, chuteMat);
        chute.position.set(x, y + 2, z);
        scene.add(chute);

        // Strings
        const stringGroup = new THREE.Group();
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const sGeo = new THREE.CylinderGeometry(0.01, 0.01, 2, 3);
            const sMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
            const s = new THREE.Mesh(sGeo, sMat);
            s.position.set(x + Math.cos(angle) * 0.8, y + 1, z + Math.sin(angle) * 0.8);
            s.rotation.set(Math.sin(angle) * 0.3, 0, Math.cos(angle) * 0.3);
            stringGroup.add(s);
        }
        scene.add(stringGroup);

        const fallStart = Date.now();
        const fallDur = 2500;

        (function animFall() {
            const t = (Date.now() - fallStart) / fallDur;
            if (t >= 1) {
                scene.remove(box); scene.remove(chute); scene.remove(stringGroup);
                boxGeo.dispose(); boxMat.dispose(); boxTex.dispose();
                chuteGeo.dispose(); chuteMat.dispose();
                stringGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
                giftBoxLand(x, z);
                return;
            }
            // Slow parachute descent
            const curY = y + (0.5 - y) * (t * t * 0.5 + t * 0.5);
            box.position.y = curY;
            box.rotation.y += 0.02;
            chute.position.set(x, curY + 2, z);
            chute.scale.setScalar(1 - t * 0.2);
            stringGroup.position.y = curY - y;
            // Sway
            box.position.x = x + Math.sin(t * 6) * 0.3;
            chute.position.x = x + Math.sin(t * 6) * 0.3;

            requestAnimationFrame(animFall);
        })();
    }

    function giftBoxLand(x, z) {
        // Burst open — celebration particles
        for (let i = 0; i < 15; i++) {
            const colors = [0xFFD600, 0xFF1744, 0x00E676, 0x2979FF, 0xE040FB];
            const c = hexToRgb(colors[Math.floor(Math.random() * colors.length)]);
            const theta = Math.random() * Math.PI * 2;
            const speed = 0.06 + Math.random() * 0.1;
            spawnParticle(
                x, 1.5, z,
                Math.cos(theta) * speed, 0.08 + Math.random() * 0.06, Math.sin(theta) * speed,
                c.r, c.g, c.b,
                1.2, 1500, 0.002, 0
            );
        }

        // Drop ores
        oreInventory += 4 + Math.floor(Math.random() * 3);
        const numDrops = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < numDrops; i++) {
            const ox = x + (Math.random() - 0.5) * 6;
            const oz = z + (Math.random() - 0.5) * 6;
            const emoji = RARE_ORES[Math.floor(Math.random() * RARE_ORES.length)];
            setTimeout(() => {
                dropItem(ox, oz, 'ore', emoji);
                if (Math.random() < 0.5) createSparkleEffect(ox, 0.5, oz, 'diamond');
            }, i * 200);
        }
        // Bonus gift emoji
        dropItem(x, z, 'ore', '🎁');
    }

    // --- EVENT 3: UFO Flyover ---
    function spawnUFO() {
        const ufo = new THREE.Group();

        // Main saucer body (metallic disc)
        const saucerGeo = new THREE.CylinderGeometry(2.5, 2.5, 0.4, 24);
        const saucerMat = new THREE.MeshStandardMaterial({
            color: 0xB0BEC5, metalness: 0.9, roughness: 0.1
        });
        const saucer = new THREE.Mesh(saucerGeo, saucerMat);
        ufo.add(saucer);

        // Bottom dome
        const bottomGeo = new THREE.SphereGeometry(2.5, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        const bottomMat = new THREE.MeshStandardMaterial({
            color: 0x78909C, metalness: 0.8, roughness: 0.2
        });
        const bottom = new THREE.Mesh(bottomGeo, bottomMat);
        bottom.position.y = -0.2;
        ufo.add(bottom);

        // Top dome (cockpit glass)
        const domeGeo = new THREE.SphereGeometry(1.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        const domeMat = new THREE.MeshStandardMaterial({
            color: 0x69F0AE, metalness: 0.5, roughness: 0.1, transparent: true, opacity: 0.6
        });
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.y = 0.2;
        ufo.add(dome);

        // Ring of lights around saucer edge
        const lightRing = new THREE.Group();
        const lightColors = [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF];
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const lGeo = new THREE.SphereGeometry(0.12, 4, 4);
            const lMat = new THREE.MeshBasicMaterial({ color: lightColors[i % lightColors.length] });
            const light = new THREE.Mesh(lGeo, lMat);
            light.position.set(Math.cos(angle) * 2.3, 0, Math.sin(angle) * 2.3);
            lightRing.add(light);
        }
        ufo.add(lightRing);
        ufo.userData.lightRing = lightRing;

        // Tractor beam (cone below, appears during ore drop)
        const beamGeo = new THREE.ConeGeometry(3, 10, 16, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x69F0AE, transparent: true, opacity: 0, side: THREE.DoubleSide
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = -5.2;
        beam.rotation.x = Math.PI; // point down
        ufo.add(beam);
        ufo.userData.beam = beam;
        ufo.userData.beamMat = beamMat;

        // Flight path: fly across the mine area
        const flyY = 14;
        const startX = -70, endX = 70;
        const flyZ = LOCATIONS.mine.z + (Math.random() - 0.5) * 10;
        const dropX = LOCATIONS.mine.x + (Math.random() - 0.5) * 8;
        ufo.position.set(startX, flyY, flyZ);
        scene.add(ufo);

        const flyDur = 6000;
        const flyStart = Date.now();
        let oresDropped = false;

        (function animUFO() {
            const elapsed = Date.now() - flyStart;
            if (elapsed > flyDur) {
                scene.remove(ufo);
                ufo.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                });
                return;
            }

            const t = elapsed / flyDur;
            // Smooth flight with slight sine wave
            ufo.position.x = startX + (endX - startX) * t;
            ufo.position.y = flyY + Math.sin(t * 8) * 0.5;

            // Wobble and rotate lights
            ufo.rotation.y += 0.03;
            lightRing.rotation.y -= 0.06; // counter-rotate for effect
            // Slight tilt in flight direction
            ufo.rotation.z = Math.sin(t * 5) * 0.05;

            // When over drop zone, activate beam and drop ores
            const distToDrop = Math.abs(ufo.position.x - dropX);
            if (distToDrop < 5) {
                beamMat.opacity = Math.min(0.3, beamMat.opacity + 0.02);

                // Green tractor beam particles
                if (Math.random() < 0.4) {
                    spawnParticle(
                        ufo.position.x + (Math.random() - 0.5) * 3,
                        ufo.position.y - 2 - Math.random() * 8,
                        flyZ + (Math.random() - 0.5) * 3,
                        0, -0.03, 0,
                        0.3, 1, 0.5,
                        0.8, 800, 0, 0
                    );
                }

                if (!oresDropped && distToDrop < 2) {
                    oresDropped = true;
                    // Drop alien ores
                    oreInventory += 3 + Math.floor(Math.random() * 3);
                    const numDrops = 4 + Math.floor(Math.random() * 4);
                    for (let i = 0; i < numDrops; i++) {
                        const ox = dropX + (Math.random() - 0.5) * 8;
                        const oz = flyZ + (Math.random() - 0.5) * 8;
                        const alienOres = ['🔮', '💎', '🟢', '🛸', '👽', '⭐'];
                        const emoji = alienOres[Math.floor(Math.random() * alienOres.length)];
                        setTimeout(() => {
                            dropItem(ox, oz, 'ore', emoji);
                            createSparkleEffect(ox, 0.5, oz, 'amethyst');
                        }, i * 250);
                    }
                }
            } else {
                beamMat.opacity = Math.max(0, beamMat.opacity - 0.01);
            }

            requestAnimationFrame(animUFO);
        })();
    }

    function createRocketPad(x, z) {
        const group = new THREE.Group();

        // Concrete platform
        const platGeo = new THREE.CylinderGeometry(6, 6.5, 0.5, 8);
        const platMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.9 });
        const plat = new THREE.Mesh(platGeo, platMat);
        plat.position.y = 0.25; plat.receiveShadow = true;
        group.add(plat);

        // Red target ring
        const ringGeo = new THREE.RingGeometry(2, 3, 32);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0xFF0000, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.52;
        group.add(ring);

        // White inner ring
        const innerGeo = new THREE.RingGeometry(0.5, 1, 32);
        const innerMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, side: THREE.DoubleSide });
        const inner = new THREE.Mesh(innerGeo, innerMat);
        inner.rotation.x = -Math.PI / 2; inner.position.y = 0.53;
        group.add(inner);

        // 4 scaffolding towers
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const sx = Math.cos(a) * 5, sz = Math.sin(a) * 5;
            const poleMat = new THREE.MeshStandardMaterial({ color: 0xFFCC00 });
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 6), poleMat);
            pole.position.set(sx, 5, sz); pole.castShadow = true;
            group.add(pole);
            for (let h = 2; h <= 8; h += 3) {
                const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 5), poleMat);
                beam.position.set(sx, h, sz);
                beam.lookAt(new THREE.Vector3(0, h, 0));
                group.add(beam);
            }
        }

        // Control tower
        const towerMat = new THREE.MeshStandardMaterial({ color: 0xE0E0E0 });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), towerMat);
        tower.position.set(8, 1.5, 0); tower.castShadow = true;
        group.add(tower);
        const towerRoof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 2.5), towerMat);
        towerRoof.position.set(8, 3.15, 0);
        group.add(towerRoof);
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 6),
            new THREE.MeshStandardMaterial({ color: 0xCC0000 }));
        antenna.position.set(8, 4.3, 0);
        group.add(antenna);

        // Rocket assembly point
        const rocketGroup = new THREE.Group();
        rocketGroup.position.set(0, 0.5, 0);
        group.add(rocketGroup);

        // Label
        const label = createEmojiSprite('🚀');
        label.position.set(0, 11, 0); label.scale.set(2, 2, 1);
        group.add(label);

        group.position.set(x, 0, z);
        rocketState.padGroup = group;
        rocketState.rocketGroup = rocketGroup;
        scene.add(group);
    }

    function buildRocketStage1() {
        const s = new THREE.Group();
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6, roughness: 0.3 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 1.5, 16), baseMat);
        base.position.y = 0.75; base.castShadow = true; s.add(base);
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 8),
                new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 }));
            nozzle.position.set(Math.cos(a) * 1.2, -0.2, Math.sin(a) * 1.2);
            nozzle.rotation.x = Math.PI; s.add(nozzle);
        }
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xE8E8E8 }));
        body.position.y = 2.5; body.castShadow = true; s.add(body);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.3, 16),
            new THREE.MeshStandardMaterial({ color: 0xFF0000 }));
        stripe.position.y = 2.0; s.add(stripe);
        return s;
    }

    function buildRocketStage2() {
        const s = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 4, 16),
            new THREE.MeshStandardMaterial({ color: 0xF0F0F0 }));
        body.position.y = 2; body.castShadow = true; s.add(body);
        for (let i = 0; i < 3; i++) {
            const win = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16),
                new THREE.MeshStandardMaterial({ color: 0x4FC3F7, emissive: 0x4FC3F7, emissiveIntensity: 0.2 }));
            win.position.set(1.32, 1 + i * 1.2, 0); win.rotation.y = Math.PI / 2; s.add(win);
        }
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.3, 16),
            new THREE.MeshStandardMaterial({ color: 0x1565C0 }));
        stripe.position.y = 3.5; s.add(stripe);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5),
            new THREE.MeshStandardMaterial({ color: 0xFF6600, side: THREE.DoubleSide }));
        flag.position.set(-1.32, 2.5, 0); flag.rotation.y = -Math.PI / 2; s.add(flag);
        s.position.y = 3.5;
        return s;
    }

    function buildRocketStage3() {
        const s = new THREE.Group();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3, 16),
            new THREE.MeshStandardMaterial({ color: 0xFF3300, metalness: 0.4, roughness: 0.3 }));
        cone.position.y = 1.5; cone.castShadow = true; s.add(cone);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8),
            new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.8, roughness: 0.1 }));
        tip.position.y = 3.2; s.add(tip);
        s.position.y = 7.5;
        return s;
    }

    function buildRocketStage() {
        const now = Date.now();
        if ((now - rocketState.lastBuildTime) < ROCKET_BUILD_COOLDOWN) return false;
        if ((now - lastGlobalBuildTime) < GLOBAL_BUILD_COOLDOWN) return false;
        if (rocketState.isLaunching || rocketState.currentStage >= ROCKET_STAGES) return false;

        const idx = rocketState.currentStage;
        const wNeed = ROCKET_WOOD_PER_STAGE[idx], oNeed = ROCKET_ORE_PER_STAGE[idx];
        if (woodInventory < wNeed || oreInventory < oNeed) return false;

        woodInventory -= wNeed;
        oreInventory -= oNeed;

        let mesh;
        if (idx === 0) mesh = buildRocketStage1();
        else if (idx === 1) mesh = buildRocketStage2();
        else mesh = buildRocketStage3();

        rocketState.rocketGroup.add(mesh);
        rocketState.meshes.push(mesh);
        rocketState.currentStage++;
        rocketState.lastBuildTime = now;
        lastGlobalBuildTime = now;

        // Celebration
        const px = rocketState.padGroup.position.x, pz = rocketState.padGroup.position.z;
        dropItem(px + 2, pz + 2, 'ore', '🔧');

        if (rocketState.currentStage >= ROCKET_STAGES) {
            setTimeout(() => launchRocket(), 5000);
        }
        return true;
    }

    function launchRocket() {
        if (rocketState.isLaunching) return;
        rocketState.isLaunching = true;
        const px = rocketState.padGroup.position.x, pz = rocketState.padGroup.position.z;
        const rg = rocketState.rocketGroup;
        const start = Date.now();
        const countdownDur = 3000, launchDur = 6000;

        dropItem(px + 2, pz + 2, 'ore', '🎉');
        dropItem(px - 2, pz + 2, 'ore', '🎊');
        dropItem(px, pz + 3, 'ore', '🚀');

        (function animLaunch() {
            const elapsed = Date.now() - start;
            if (elapsed < countdownDur) {
                rg.position.x = (Math.random() - 0.5) * 0.15;
                rg.position.z = (Math.random() - 0.5) * 0.15;
                if (Math.random() < 0.3) spawnSmokeParticle(px, 1, pz);
                if (Math.random() < elapsed / countdownDur * 0.5) spawnFireParticle(px, 1, pz);
                requestAnimationFrame(animLaunch);
            } else if (elapsed < countdownDur + launchDur) {
                const t = (elapsed - countdownDur) / launchDur;
                rg.position.y = 0.5 + t * t * 80;
                rg.position.x = 0; rg.position.z = 0;
                rg.scale.setScalar(Math.max(0.1, 1 - t * 0.8));
                if (Math.random() < 0.6) {
                    spawnFireParticle(px, rg.position.y, pz);
                    spawnFireParticle(px + (Math.random() - 0.5), rg.position.y - 1, pz + (Math.random() - 0.5));
                }
                if (Math.random() < 0.4) spawnSmokeParticle(px, rg.position.y - 2, pz);
                requestAnimationFrame(animLaunch);
            } else {
                resetRocket();
            }
        })();
    }

    function resetRocket() {
        rocketState.meshes.forEach(mesh => {
            rocketState.rocketGroup.remove(mesh);
            mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });
        rocketState.meshes = [];
        rocketState.currentStage = 0;
        rocketState.isLaunching = false;
        rocketState.rocketGroup.position.set(0, 0.5, 0);
        rocketState.rocketGroup.scale.setScalar(1);
    }

    // ===== High-Speed Rail System =====
    const RAIL_X = 55;           // Right edge of map
    const RAIL_Z_START = 70;     // Train enters from front
    const RAIL_Z_END = -70;      // Train exits at back
    const RAIL_LENGTH = RAIL_Z_START - RAIL_Z_END; // 140 units
    const TRAIN_INTERVAL = 15000 + Math.random() * 10000; // 15-25s between trains
    let trainState = {
        group: null,
        stationGroup: null,
        isRunning: false,
        lastTrainTime: 0,
        direction: 1 // 1 = front-to-back, -1 = back-to-front
    };

    function createRailTrack(x) {
        const trackGroup = new THREE.Group();

        // Rail bed (gravel strip)
        const bedGeo = new THREE.BoxGeometry(4, 0.15, RAIL_LENGTH);
        const bedMat = new THREE.MeshStandardMaterial({ color: 0x696969, roughness: 0.95 });
        const bed = new THREE.Mesh(bedGeo, bedMat);
        bed.position.set(x, 0.08, (RAIL_Z_START + RAIL_Z_END) / 2);
        bed.receiveShadow = true;
        trackGroup.add(bed);

        // Two steel rails
        const railMat = new THREE.MeshStandardMaterial({ color: 0xA0A0A0, metalness: 0.8, roughness: 0.3 });
        [-0.75, 0.75].forEach(offset => {
            const railGeo = new THREE.BoxGeometry(0.1, 0.1, RAIL_LENGTH);
            const rail = new THREE.Mesh(railGeo, railMat);
            rail.position.set(x + offset, 0.2, (RAIL_Z_START + RAIL_Z_END) / 2);
            trackGroup.add(rail);
        });

        // Sleepers (ties) - every 3 units
        const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.9 });
        for (let z = RAIL_Z_END; z <= RAIL_Z_START; z += 3) {
            const sleeperGeo = new THREE.BoxGeometry(3, 0.08, 0.4);
            const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
            sleeper.position.set(x, 0.12, z);
            trackGroup.add(sleeper);
        }

        scene.add(trackGroup);
        return trackGroup;
    }

    function createTrainStation(x, z) {
        const group = new THREE.Group();

        // Platform
        const platGeo = new THREE.BoxGeometry(8, 0.6, 12);
        const platMat = new THREE.MeshStandardMaterial({ color: 0xBDBDBD, roughness: 0.8 });
        const platform = new THREE.Mesh(platGeo, platMat);
        platform.position.set(x - 5, 0.3, z);
        platform.receiveShadow = true;
        group.add(platform);

        // Yellow safety line on platform edge
        const lineGeo = new THREE.BoxGeometry(0.3, 0.02, 12);
        const lineMat = new THREE.MeshStandardMaterial({ color: 0xFFD600 });
        const safeLine = new THREE.Mesh(lineGeo, lineMat);
        safeLine.position.set(x - 1.2, 0.62, z);
        group.add(safeLine);

        // Station canopy (roof)
        const roofGeo = new THREE.BoxGeometry(7, 0.15, 14);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xF5F5F5, metalness: 0.3 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(x - 5, 4.5, z);
        roof.castShadow = true;
        group.add(roof);

        // 4 support pillars
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x607D8B, metalness: 0.5 });
        [[-8.2, z - 5], [-8.2, z + 5], [-1.8, z - 5], [-1.8, z + 5]].forEach(([px, pz]) => {
            const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 4, 8);
            const pillar = new THREE.Mesh(pillarGeo, pillarMat);
            pillar.position.set(x + px + 5, 2.3, pz);
            group.add(pillar);
        });

        // Station sign
        const signCanvas = document.createElement('canvas');
        signCanvas.width = 256; signCanvas.height = 64;
        const sCtx = signCanvas.getContext('2d');
        sCtx.fillStyle = '#1565C0';
        sCtx.fillRect(0, 0, 256, 64);
        sCtx.fillStyle = '#FFFFFF';
        sCtx.font = 'bold 28px Arial';
        sCtx.textAlign = 'center';
        sCtx.textBaseline = 'middle';
        sCtx.fillText('🚄 Meco Station', 128, 32);
        const signTex = new THREE.CanvasTexture(signCanvas);
        const signGeo = new THREE.PlaneGeometry(4, 1);
        const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide });
        const sign = new THREE.Mesh(signGeo, signMat);
        sign.position.set(x - 5, 3.5, z);
        sign.rotation.y = Math.PI / 2;
        group.add(sign);

        // Benches on platform
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x795548 });
        [-3, 0, 3].forEach(bz => {
            const seatGeo = new THREE.BoxGeometry(1.5, 0.1, 0.5);
            const seat = new THREE.Mesh(seatGeo, benchMat);
            seat.position.set(x - 6, 0.95, z + bz);
            group.add(seat);
            // Legs
            [[-0.6, -0.15], [0.6, -0.15]].forEach(([lx, lz]) => {
                const legGeo = new THREE.BoxGeometry(0.08, 0.3, 0.08);
                const leg = new THREE.Mesh(legGeo, benchMat);
                leg.position.set(x - 6 + lx, 0.75, z + bz + lz);
                group.add(leg);
            });
        });

        scene.add(group);
        trainState.stationGroup = group;
        return group;
    }

    function createTrainModel() {
        const train = new THREE.Group();
        const carLength = 7;
        const numCars = 4; // Head + 2 passenger + tail
        const totalLength = numCars * (carLength + 0.3);

        for (let i = 0; i < numCars; i++) {
            const car = new THREE.Group();
            const zOff = i * (carLength + 0.3) - totalLength / 2;
            const isHead = (i === 0);
            const isTail = (i === numCars - 1);

            // Main body
            const bodyGeo = new THREE.BoxGeometry(2.4, 2.2, carLength);
            const bodyMat = new THREE.MeshStandardMaterial({
                color: isHead || isTail ? 0x1565C0 : 0xF5F5F5,
                metalness: 0.4, roughness: 0.3
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 1.8;
            body.castShadow = true;
            car.add(body);

            // Blue stripe on white cars
            if (!isHead && !isTail) {
                const stripeGeo = new THREE.BoxGeometry(2.45, 0.3, carLength + 0.02);
                const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1565C0, metalness: 0.4 });
                const stripe = new THREE.Mesh(stripeGeo, stripeMat);
                stripe.position.y = 2.2;
                car.add(stripe);
            }

            // Roof (rounded appearance)
            const roofGeo = new THREE.CylinderGeometry(1.2, 1.2, carLength, 8, 1, false, 0, Math.PI);
            const roofMat = new THREE.MeshStandardMaterial({
                color: isHead || isTail ? 0x0D47A1 : 0xE0E0E0,
                metalness: 0.3
            });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = 2.9;
            roof.rotation.x = Math.PI / 2;
            roof.rotation.z = Math.PI;
            car.add(roof);

            // Windows
            if (!isHead && !isTail) {
                const windowMat = new THREE.MeshStandardMaterial({
                    color: 0x81D4FA, metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.7
                });
                for (let w = -2; w <= 2; w++) {
                    [-1, 1].forEach(side => {
                        const winGeo = new THREE.PlaneGeometry(0.8, 0.6);
                        const win = new THREE.Mesh(winGeo, windowMat);
                        win.position.set(side * 1.21, 2.0, w * 1.3);
                        win.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
                        car.add(win);
                    });
                }
            }

            // Nose cone for head car
            if (isHead) {
                const noseGeo = new THREE.ConeGeometry(1.3, 2.5, 4);
                const noseMat = new THREE.MeshStandardMaterial({ color: 0x1565C0, metalness: 0.5, roughness: 0.2 });
                const nose = new THREE.Mesh(noseGeo, noseMat);
                nose.position.set(0, 1.8, -carLength / 2 - 1);
                nose.rotation.x = -Math.PI / 2;
                nose.rotation.z = Math.PI / 4;
                car.add(nose);

                // Headlights
                const lightMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00 });
                [-0.5, 0.5].forEach(lx => {
                    const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), lightMat);
                    light.position.set(lx, 1.5, -carLength / 2 - 1.8);
                    car.add(light);
                });

                // Windshield
                const wsMat = new THREE.MeshStandardMaterial({
                    color: 0x263238, metalness: 0.8, roughness: 0.1, transparent: true, opacity: 0.8
                });
                const wsGeo = new THREE.PlaneGeometry(1.6, 0.8);
                const ws = new THREE.Mesh(wsGeo, wsMat);
                ws.position.set(0, 2.3, -carLength / 2 - 0.6);
                ws.rotation.x = 0.2;
                car.add(ws);
            }

            // Tail cone
            if (isTail) {
                const tailGeo = new THREE.ConeGeometry(1.3, 2, 4);
                const tailMat = new THREE.MeshStandardMaterial({ color: 0x1565C0, metalness: 0.5, roughness: 0.2 });
                const tail = new THREE.Mesh(tailGeo, tailMat);
                tail.position.set(0, 1.8, carLength / 2 + 0.8);
                tail.rotation.x = Math.PI / 2;
                tail.rotation.z = Math.PI / 4;
                car.add(tail);

                // Tail lights
                const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xFF0000 });
                [-0.5, 0.5].forEach(lx => {
                    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), tailLightMat);
                    tl.position.set(lx, 1.5, carLength / 2 + 1.5);
                    car.add(tl);
                });
            }

            // Bogies (wheels/undercarriage)
            const bogieMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 });
            [-carLength / 3, carLength / 3].forEach(bz => {
                const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.2), bogieMat);
                bogie.position.set(0, 0.4, bz);
                car.add(bogie);
                // Wheels
                const wheelMat = new THREE.MeshStandardMaterial({ color: 0x212121, metalness: 0.8 });
                [-0.9, 0.9].forEach(wx => {
                    [-0.35, 0.35].forEach(wz => {
                        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12), wheelMat);
                        wheel.position.set(wx, 0.3, bz + wz);
                        wheel.rotation.z = Math.PI / 2;
                        car.add(wheel);
                    });
                });
            });

            car.position.z = zOff;
            train.add(car);
        }

        train.userData.totalLength = totalLength + 2.5; // Including nose/tail
        return train;
    }

    function launchTrain() {
        if (!isActive) return; // Prevent launch if disposed
        if (trainState.isRunning) return;
        trainState.isRunning = true;

        const train = createTrainModel();
        const trainLen = train.userData.totalLength;
        const dir = trainState.direction;
        trainState.direction *= -1; // Alternate direction

        const startZ = dir > 0 ? RAIL_Z_START + trainLen : RAIL_Z_END - trainLen;
        const endZ = dir > 0 ? RAIL_Z_END - trainLen : RAIL_Z_START + trainLen;
        train.position.set(RAIL_X, 0, startZ);
        if (dir < 0) train.rotation.y = Math.PI; // Face the other way
        scene.add(train);
        trainState.group = train;

        const totalDist = Math.abs(endZ - startZ);
        // Speed phases: accelerate → cruise → decelerate
        const accelDist = 25, decelDist = 25;
        const cruiseDist = totalDist - accelDist - decelDist;
        const cruiseSpeed = 0.8; // units per frame
        const accelFrames = accelDist / (cruiseSpeed / 2);
        const cruiseFrames = cruiseDist / cruiseSpeed;
        const decelFrames = decelDist / (cruiseSpeed / 2);
        const totalFrames = accelFrames + cruiseFrames + decelFrames;

        let frame = 0;
        (function animTrain() {
            if (!isActive) return;
            frame++;
            const progress = frame / totalFrames;
            if (progress >= 1) {
                scene.remove(train);
                train.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (child.material.map) child.material.map.dispose();
                        child.material.dispose();
                    }
                });
                trainState.group = null;
                trainState.isRunning = false;
                trainState.lastTrainTime = Date.now();
                return;
            }

            // Eased position: accelerate then cruise then decelerate
            let dist;
            const accelP = accelFrames / totalFrames;
            const cruiseP = (accelFrames + cruiseFrames) / totalFrames;
            if (progress < accelP) {
                // Accelerating (quadratic ease-in)
                const t = progress / accelP;
                dist = (accelDist * t * t) / totalDist;
            } else if (progress < cruiseP) {
                // Cruising (linear)
                const t = (progress - accelP) / (cruiseP - accelP);
                dist = (accelDist + cruiseDist * t) / totalDist;
            } else {
                // Decelerating (quadratic ease-out)
                const t = (progress - cruiseP) / (1 - cruiseP);
                dist = (accelDist + cruiseDist + decelDist * (2 * t - t * t)) / totalDist;
            }

            train.position.z = startZ + (endZ - startZ) * dist;

            requestAnimationFrame(animTrain);
        })();
    }

    function initHighSpeedRail() {
        createRailTrack(RAIL_X);
        createTrainStation(RAIL_X, 0); // Station at center of map

        // Periodic train dispatch
        function scheduleTrain() {
            setTimeout(() => {
                if (!isActive) return; // Stop if disposed
                if (!trainState.isRunning) {
                    launchTrain();
                }
                scheduleTrain();
            }, 15000 + Math.random() * 15000);
        }
        scheduleTrain();

        // First train after a short delay
        setTimeout(() => launchTrain(), 5000);
    }

    // Document/Note icons for dropping
    const DOC_ICONS = ['📄', '📝', '📊', '📋', '💼', '📚', '📰', '🗞️'];

    function dropDocument(x, z) {
        const emoji = DOC_ICONS[Math.floor(Math.random() * DOC_ICONS.length)];
        dropItem(x, z, 'doc', emoji);
    }

    // Create decorative items (pumpkins, lanterns, etc.)
    function createDecoration(type, x, z) {
        const decorData = CREATIVE_TYPES.find(c => c.name === type);
        if (!decorData) return null;

        // Check minimum distance from other decorations (at least 5 units)
        const minDist = 5;
        for (const decor of placedDecorations) {
            const dx = decor.position.x - x;
            const dz = decor.position.z - z;
            if (Math.sqrt(dx * dx + dz * dz) < minDist) {
                return null; // Too close, don't place
            }
        }

        // Also check distance from village (don't place in village area)
        const distToVillage = Math.sqrt(
            Math.pow(x - LOCATIONS.village.x, 2) +
            Math.pow(z - LOCATIONS.village.z, 2)
        );
        if (distToVillage < 12) {
            return null; // Too close to village
        }

        // Also check distance from rocket pad
        const distToRocket = Math.sqrt(
            Math.pow(x - LOCATIONS.rocketPad.x, 2) +
            Math.pow(z - LOCATIONS.rocketPad.z, 2)
        );
        if (distToRocket < 12) {
            return null; // Too close to rocket pad
        }

        // Don't place near rail track
        if (Math.abs(x - RAIL_X) < 6) {
            return null;
        }

        // Create the decoration based on type
        const group = new THREE.Group();

        if (type === 'pumpkin') {
            // Halloween pumpkin - orange sphere with face
            const bodyGeo = new THREE.SphereGeometry(1.2, 16, 16);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0xFF6600 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 1.2;
            body.castShadow = true;
            group.add(body);

            // Stem
            const stemGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.4, 8);
            const stemMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.y = 2.5;
            group.add(stem);

            // Face (simplified with dark spots)
            const eyeGeo = new THREE.BoxGeometry(0.25, 0.35, 0.1);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
            leftEye.position.set(-0.4, 1.3, 1.15);
            group.add(leftEye);
            const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
            rightEye.position.set(0.4, 1.3, 1.15);
            group.add(rightEye);
            const mouthGeo = new THREE.BoxGeometry(0.6, 0.3, 0.1);
            const mouth = new THREE.Mesh(mouthGeo, eyeMat);
            mouth.position.set(0, 0.7, 1.15);
            group.add(mouth);
        } else if (type.includes('lantern')) {
            // Red/gold lantern
            const bodyGeo = new THREE.CylinderGeometry(0.6, 0.7, 1.2, 16);
            const bodyMat = new THREE.MeshStandardMaterial({
                color: decorData.color,
                emissive: decorData.color,
                emissiveIntensity: 0.3
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 2;
            group.add(body);

            // Top cap
            const capGeo = new THREE.CylinderGeometry(0.3, 0.5, 0.3, 16);
            const capMat = new THREE.MeshStandardMaterial({ color: 0xFFD700 });
            const cap = new THREE.Mesh(capGeo, capMat);
            cap.position.y = 2.8;
            group.add(cap);

            // Hanging string
            const stringGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
            const stringMat = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
            const string = new THREE.Mesh(stringGeo, stringMat);
            string.position.y = 3.5;
            group.add(string);
        } else if (type === 'lamp') {
            // Street lamp
            const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 4, 8);
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.y = 2;
            pole.castShadow = true;
            group.add(pole);

            // Lamp head
            const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
            const headMat = new THREE.MeshStandardMaterial({
                color: 0xFFFFAA,
                emissive: 0xFFFFAA,
                emissiveIntensity: 0.5
            });
            const head = new THREE.Mesh(headGeo, headMat);
            head.position.y = 4.2;
            group.add(head);

            // Point light
            const light = new THREE.PointLight(0xFFFFAA, 0.5, 10);
            light.position.y = 4.2;
            group.add(light);
        } else if (type === 'fountain') {
            // Fountain with water
            const baseGeo = new THREE.CylinderGeometry(1.5, 1.8, 1, 16);
            const baseMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.y = 0.5;
            base.castShadow = true;
            group.add(base);

            // Water surface
            const waterGeo = new THREE.CircleGeometry(1.3, 32);
            const waterMat = new THREE.MeshStandardMaterial({
                color: 0x00BFFF,
                transparent: true,
                opacity: 0.7
            });
            const water = new THREE.Mesh(waterGeo, waterMat);
            water.rotation.x = -Math.PI / 2;
            water.position.y = 1.05;
            group.add(water);

            // Center spray
            const sprayGeo = new THREE.CylinderGeometry(0.1, 0.3, 2, 8);
            const sprayMat = new THREE.MeshStandardMaterial({
                color: 0x87CEEB,
                transparent: true,
                opacity: 0.8
            });
            const spray = new THREE.Mesh(sprayGeo, sprayMat);
            spray.position.y = 2;
            group.add(spray);
        } else if (type === 'bonsai' || type === 'christmas_tree') {
            // Potted tree
            const potGeo = new THREE.CylinderGeometry(0.6, 0.5, 0.8, 16);
            const potMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const pot = new THREE.Mesh(potGeo, potMat);
            pot.position.y = 0.4;
            group.add(pot);

            // Trunk
            const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 8);
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x654321 });
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.y = 1.5;
            group.add(trunk);

            // Foliage
            const foliageGeo = new THREE.SphereGeometry(1, 16, 16);
            const foliageMat = new THREE.MeshStandardMaterial({ color: decorData.color });
            const foliage = new THREE.Mesh(foliageGeo, foliageMat);
            foliage.position.y = 2.8;
            foliage.castShadow = true;
            group.add(foliage);
        } else if (type === 'snowman') {
            // Snowman
            const bottomGeo = new THREE.SphereGeometry(0.9, 16, 16);
            const snowMat = new THREE.MeshStandardMaterial({ color: 0xFFFAFA });
            const bottom = new THREE.Mesh(bottomGeo, snowMat);
            bottom.position.y = 0.9;
            group.add(bottom);

            const midGeo = new THREE.SphereGeometry(0.6, 16, 16);
            const mid = new THREE.Mesh(midGeo, snowMat);
            mid.position.y = 2;
            group.add(mid);

            const headGeo = new THREE.SphereGeometry(0.4, 16, 16);
            const head = new THREE.Mesh(headGeo, snowMat);
            head.position.y = 2.8;
            group.add(head);

            // Carrot nose
            const noseGeo = new THREE.ConeGeometry(0.1, 0.4, 8);
            const noseMat = new THREE.MeshStandardMaterial({ color: 0xFF6600 });
            const nose = new THREE.Mesh(noseGeo, noseMat);
            nose.rotation.z = Math.PI / 2;
            nose.position.set(0.4, 2.8, 0);
            group.add(nose);

            // Eyes
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
            eye1.position.set(0.25, 2.95, 0.35);
            group.add(eye1);
            const eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
            eye2.position.set(0.55, 2.95, 0.35);
            group.add(eye2);
        } else if (type === 'flag') {
            // Flag pole
            const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4, 8);
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.y = 2;
            group.add(pole);

            // Flag
            const flagGeo = new THREE.PlaneGeometry(1.5, 1);
            const flagMat = new THREE.MeshStandardMaterial({
                color: decorData.color,
                side: THREE.DoubleSide
            });
            const flag = new THREE.Mesh(flagGeo, flagMat);
            flag.position.set(0.8, 3.2, 0);
            group.add(flag);
        } else if (type === 'bench') {
            // Wooden bench
            const seatGeo = new THREE.BoxGeometry(2.5, 0.15, 0.8);
            const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const seat = new THREE.Mesh(seatGeo, woodMat);
            seat.position.y = 0.6;
            seat.castShadow = true;
            group.add(seat);

            // Legs
            const legGeo = new THREE.BoxGeometry(0.15, 0.6, 0.6);
            const leg1 = new THREE.Mesh(legGeo, woodMat);
            leg1.position.set(-1, 0.3, 0);
            group.add(leg1);
            const leg2 = new THREE.Mesh(legGeo, woodMat);
            leg2.position.set(1, 0.3, 0);
            group.add(leg2);

            // Back
            const backGeo = new THREE.BoxGeometry(2.5, 0.8, 0.1);
            const back = new THREE.Mesh(backGeo, woodMat);
            back.position.set(0, 1.1, -0.35);
            group.add(back);
        } else if (type === 'statue') {
            // Simple statue
            const bodyGeo = new THREE.CylinderGeometry(0.5, 0.7, 2.5, 16);
            const stoneMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
            const body = new THREE.Mesh(bodyGeo, stoneMat);
            body.position.y = 1.25;
            body.castShadow = true;
            group.add(body);

            const headGeo = new THREE.SphereGeometry(0.6, 16, 16);
            const head = new THREE.Mesh(headGeo, stoneMat);
            head.position.y = 3;
            group.add(head);
        } else if (type === 'windmill') {
            // Windmill
            const bodyGeo = new THREE.CylinderGeometry(0.8, 1.2, 3, 16);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0xFFB6C1 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 1.5;
            body.castShadow = true;
            group.add(body);

            // Blades
            const bladeGroup = new THREE.Group();
            for (let i = 0; i < 4; i++) {
                const bladeGeo = new THREE.BoxGeometry(0.2, 2, 0.05);
                const bladeMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
                const blade = new THREE.Mesh(bladeGeo, bladeMat);
                blade.position.y = 1.2;
                blade.rotation.z = (Math.PI / 2) * i;
                bladeGroup.add(blade);
            }
            bladeGroup.position.y = 3.2;
            bladeGroup.rotation.z += Date.now() * 0.001;
            group.add(bladeGroup);

            // Store for animation
            group.userData.animate = 'windmill';
            group.userData.blades = bladeGroup;
        } else if (type === 'tent') {
            // Camping tent
            const tentGeo = new THREE.ConeGeometry(1.5, 2, 4);
            const tentMat = new THREE.MeshStandardMaterial({ color: 0xFFA500 });
            const tent = new THREE.Mesh(tentGeo, tentMat);
            tent.position.y = 1;
            tent.rotation.y = Math.PI / 4;
            tent.castShadow = true;
            group.add(tent);
        } else if (type.includes('flower')) {
            // Flower arrangement - simple stem with colored top
            const stemGeo = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 8);
            const stemMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
            const stem = new THREE.Mesh(stemGeo, stemMat);
            stem.position.y = 0.6;
            group.add(stem);

            const petalGeo = new THREE.SphereGeometry(0.4, 16, 16);
            const petalMat = new THREE.MeshStandardMaterial({
                color: decorData.color,
                emissive: decorData.color,
                emissiveIntensity: 0.1
            });
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.y = 1.4;
            group.add(petal);

            // Center
            const centerGeo = new THREE.SphereGeometry(0.15, 8, 8);
            const centerMat = new THREE.MeshStandardMaterial({ color: 0xFFD700 });
            const center = new THREE.Mesh(centerGeo, centerMat);
            center.position.y = 1.4;
            group.add(center);
        } else if (type === 'cake' || type === 'gift') {
            // Simple box for cake/gift
            const boxGeo = new THREE.BoxGeometry(1, 1, 1);
            const boxMat = new THREE.MeshStandardMaterial({ color: decorData.color });
            const box = new THREE.Mesh(boxGeo, boxMat);
            box.position.y = 0.5;
            box.castShadow = true;
            group.add(box);

            // Ribbon
            const ribbonGeo = new THREE.BoxGeometry(1.1, 0.1, 1.1);
            const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xFFD700 });
            const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
            ribbon.position.y = 1;
            group.add(ribbon);
        } else if (type === 'torii_gate') {
            // Japanese shrine gate
            const pillarMat = new THREE.MeshStandardMaterial({ color: 0xCC0000 });
            [-1.5, 1.5].forEach(xOff => {
                const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 4, 8), pillarMat);
                pillar.position.set(xOff, 2, 0); pillar.castShadow = true; group.add(pillar);
            });
            const topBeam = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 0.4), pillarMat);
            topBeam.position.y = 4; group.add(topBeam);
            const subBeam = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.15, 0.3), pillarMat);
            subBeam.position.y = 3.3; group.add(subBeam);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 0.6),
                new THREE.MeshStandardMaterial({ color: 0x1A1A1A }));
            cap.position.y = 4.2; group.add(cap);
        } else if (type === 'lighthouse') {
            // Tapered tower
            const towerMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
            const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 5, 16), towerMat);
            tower.position.y = 2.5; tower.castShadow = true; group.add(tower);
            [1.5, 3.0].forEach(h => {
                const r = 0.6 + (1 - 0.6) * (1 - h / 5);
                const stripe = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r - 0.02, 0.4, 16),
                    new THREE.MeshStandardMaterial({ color: 0xFF0000 }));
                stripe.position.y = h; group.add(stripe);
            });
            const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.6, 1, 16),
                new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.3 }));
            lampRoom.position.y = 5.5; group.add(lampRoom);
            const beamGroup = new THREE.Group();
            const beam = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 0.3),
                new THREE.MeshBasicMaterial({ color: 0xFFFF00, transparent: true, opacity: 0.5 }));
            beam.position.x = 1.5; beamGroup.add(beam);
            beamGroup.position.y = 5.5; group.add(beamGroup);
            const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshStandardMaterial({ color: 0x444444 }));
            dome.position.y = 6; group.add(dome);
            group.userData.animate = 'lighthouse';
            group.userData.beam = beamGroup;
        } else if (type === 'ferris_wheel') {
            // Support frame
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
            [-0.6, 0.6].forEach(zOff => {
                const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 6), frameMat);
                leg1.position.set(-0.8, 2.5, zOff); leg1.rotation.z = 0.15; group.add(leg1);
                const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 6), frameMat);
                leg2.position.set(0.8, 2.5, zOff); leg2.rotation.z = -0.15; group.add(leg2);
            });
            const wheelGroup = new THREE.Group();
            const rim = new THREE.Mesh(new THREE.TorusGeometry(2, 0.08, 8, 32),
                new THREE.MeshStandardMaterial({ color: 0xFF69B4 }));
            wheelGroup.add(rim);
            const seatColors = [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF];
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 4),
                    new THREE.MeshStandardMaterial({ color: 0xFF69B4 }));
                spoke.position.set(Math.cos(a), Math.sin(a), 0);
                spoke.rotation.z = a + Math.PI / 2; wheelGroup.add(spoke);
                const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3),
                    new THREE.MeshStandardMaterial({ color: seatColors[i] }));
                seat.position.set(Math.cos(a) * 2, Math.sin(a) * 2, 0);
                seat.userData.isSeat = true; wheelGroup.add(seat);
            }
            wheelGroup.position.y = 5; group.add(wheelGroup);
            group.userData.animate = 'ferris_wheel';
            group.userData.wheel = wheelGroup;
        } else if (type === 'carousel') {
            // Base
            const base = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 0.3, 16),
                new THREE.MeshStandardMaterial({ color: 0xFFD700 }));
            base.position.y = 0.15; group.add(base);
            const spinGroup = new THREE.Group();
            const poleMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0 });
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 8), poleMat);
            pole.position.y = 1.5; spinGroup.add(pole);
            const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1, 16),
                new THREE.MeshStandardMaterial({ color: 0xFF1493 }));
            canopy.position.y = 3.5; spinGroup.add(canopy);
            const horseColors = [0xFFFFFF, 0x8B4513, 0x000000, 0xDEB887];
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2;
                const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 6), poleMat);
                sp.position.set(Math.cos(a) * 1.5, 1.3, Math.sin(a) * 1.5); spinGroup.add(sp);
                const horse = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
                    new THREE.MeshStandardMaterial({ color: horseColors[i] }));
                horse.position.set(Math.cos(a) * 1.5, 0.8, Math.sin(a) * 1.5);
                horse.scale.set(1, 0.8, 1.5); spinGroup.add(horse);
            }
            spinGroup.position.y = 0.3; group.add(spinGroup);
            group.userData.animate = 'carousel';
            group.userData.spinGroup = spinGroup;
        } else if (type === 'hot_air_balloon') {
            // Balloon
            const balloon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 16),
                new THREE.MeshStandardMaterial({ color: 0xFF4500 }));
            balloon.position.y = 5; balloon.castShadow = true; group.add(balloon);
            const panelMat = new THREE.MeshStandardMaterial({ color: 0xFFFF00 });
            for (let i = 0; i < 4; i++) {
                const panel = new THREE.Mesh(new THREE.SphereGeometry(1.52, 16, 16, 0, Math.PI / 4), panelMat);
                panel.position.y = 5; panel.rotation.y = i * Math.PI / 2; group.add(panel);
            }
            const ropeMat = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.5, 4), ropeMat);
                rope.position.set(Math.cos(a) * 0.5, 2.8, Math.sin(a) * 0.5);
                rope.rotation.x = 0.15 * Math.cos(a); rope.rotation.z = 0.15 * Math.sin(a);
                group.add(rope);
            }
            const basket = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1),
                new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
            basket.position.y = 1.5; group.add(basket);
            group.userData.animate = 'balloon';
            group.userData.baseY = 0;
        } else if (type === 'pagoda') {
            // Multi-tier tower
            const tierColors = [0x8B0000, 0xA52A2A, 0xCC3333];
            const roofMat = new THREE.MeshStandardMaterial({ color: 0x1A1A1A });
            for (let i = 0; i < 3; i++) {
                const sz = 2 - i * 0.5, h = 1.5, yB = i * 2;
                const tier = new THREE.Mesh(new THREE.BoxGeometry(sz, h, sz),
                    new THREE.MeshStandardMaterial({ color: tierColors[i] }));
                tier.position.y = yB + h / 2; tier.castShadow = true; group.add(tier);
                const roof = new THREE.Mesh(new THREE.BoxGeometry(sz + 0.8, 0.15, sz + 0.8), roofMat);
                roof.position.y = yB + h; group.add(roof);
                [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([cx,cz]) => {
                    const corner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), roofMat);
                    corner.position.set(cx*(sz+0.4)/2, yB+h+0.15, cz*(sz+0.4)/2);
                    corner.rotation.x = Math.PI; group.add(corner);
                });
            }
            const spire = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1, 8),
                new THREE.MeshStandardMaterial({ color: 0xFFD700 }));
            spire.position.y = 7; group.add(spire);
        } else if (type === 'castle_tower') {
            // Stone tower with battlements
            const stoneMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.9 });
            const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 5, 16), stoneMat);
            tower.position.y = 2.5; tower.castShadow = true; group.add(tower);
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), stoneMat);
                merlon.position.set(Math.cos(a) * 1.2, 5.25, Math.sin(a) * 1.2); group.add(merlon);
            }
            const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2, 16),
                new THREE.MeshStandardMaterial({ color: 0x2F4F4F }));
            roof.position.y = 6.5; roof.castShadow = true; group.add(roof);
            const door = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1),
                new THREE.MeshStandardMaterial({ color: 0x5D4037, side: THREE.DoubleSide }));
            door.position.set(0, 0.5, 1.41); group.add(door);
        } else if (type === 'archway') {
            // Two pillars + arch
            const pillarMat = new THREE.MeshStandardMaterial({ color: 0xD2B48C, roughness: 0.8 });
            [-1.2, 1.2].forEach(xOff => {
                const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 3.5, 8), pillarMat);
                pillar.position.set(xOff, 1.75, 0); pillar.castShadow = true; group.add(pillar);
                const capM = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.8), pillarMat);
                capM.position.set(xOff, 3.6, 0); group.add(capM);
            });
            const arch = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.2, 8, 16, Math.PI), pillarMat);
            arch.position.y = 3.5; arch.rotation.x = Math.PI / 2; arch.rotation.z = Math.PI / 2;
            group.add(arch);
            const keystone = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.4),
                new THREE.MeshStandardMaterial({ color: 0xFFD700 }));
            keystone.position.y = 4.7; group.add(keystone);
        } else if (type === 'obelisk') {
            // Tapered pillar
            const stoneMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, metalness: 0.3 });
            const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), stoneMat);
            base.position.y = 0.15; group.add(base);
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 5, 4), stoneMat);
            shaft.position.y = 2.8; shaft.rotation.y = Math.PI / 4; shaft.castShadow = true; group.add(shaft);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4),
                new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.6 }));
            tip.position.y = 5.7; tip.rotation.y = Math.PI / 4; group.add(tip);
        } else if (type === 'clock_tower') {
            // Box tower with clock face
            const towerMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const tower = new THREE.Mesh(new THREE.BoxGeometry(1.5, 5, 1.5), towerMat);
            tower.position.y = 2.5; tower.castShadow = true; group.add(tower);
            // Canvas clock face
            const cc = document.createElement('canvas'); cc.width = 128; cc.height = 128;
            const cctx = cc.getContext('2d');
            cctx.fillStyle = '#FFFFFF'; cctx.beginPath(); cctx.arc(64,64,58,0,Math.PI*2); cctx.fill();
            cctx.strokeStyle = '#333'; cctx.lineWidth = 4; cctx.stroke();
            for (let i = 0; i < 12; i++) {
                const a = (i/12)*Math.PI*2 - Math.PI/2;
                cctx.fillStyle = '#333'; cctx.beginPath();
                cctx.arc(64+Math.cos(a)*48, 64+Math.sin(a)*48, 3, 0, Math.PI*2); cctx.fill();
            }
            cctx.strokeStyle = '#000'; cctx.lineWidth = 3;
            cctx.beginPath(); cctx.moveTo(64,64);
            cctx.lineTo(64+Math.cos(-Math.PI*2/3)*30, 64+Math.sin(-Math.PI*2/3)*30); cctx.stroke();
            cctx.lineWidth = 2; cctx.beginPath(); cctx.moveTo(64,64);
            cctx.lineTo(64+Math.cos(-Math.PI/6)*40, 64+Math.sin(-Math.PI/6)*40); cctx.stroke();
            const clockTex = new THREE.CanvasTexture(cc);
            const clockFaceMat = new THREE.MeshStandardMaterial({ map: clockTex });
            const cf1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), clockFaceMat);
            cf1.position.set(0, 4, 0.76); group.add(cf1);
            const cf2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), clockFaceMat);
            cf2.position.set(0, 4, -0.76); cf2.rotation.y = Math.PI; group.add(cf2);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 4),
                new THREE.MeshStandardMaterial({ color: 0x2F4F4F }));
            roof.position.y = 6; roof.rotation.y = Math.PI / 4; roof.castShadow = true; group.add(roof);
        } else {
            // Default: just use emoji as sprite
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.font = '80px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(decorData.emoji, 64, 64);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(2, 2, 1);
            sprite.position.y = 1.5;
            group.add(sprite);
        }

        group.position.set(x, 0, z);
        group.userData = {
            type: 'decoration',
            decorType: type,
            data: decorData,
            placedAt: Date.now()
        };

        scene.add(group);
        placedDecorations.push(group);

        return group;
    }

    // Remove a decoration (for mischief)
    function removeDecoration(decoration) {
        if (!decoration) return;

        const index = placedDecorations.indexOf(decoration);
        if (index > -1) {
            placedDecorations.splice(index, 1);
        }
        scene.remove(decoration);

        // Clean up any lights
        decoration.children.forEach(child => {
            if (child instanceof THREE.PointLight) {
                child.dispose();
            }
        });
    }

    function createFarmHouse(x, y, z) {
        const group = new THREE.Group();

        // Base
        const baseGeo = new THREE.BoxGeometry(8, 5, 8);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0xF5DEB3 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 2.5;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);

        // Roof
        const roofGeo = new THREE.ConeGeometry(6, 3, 4);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B0000 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = 6.5;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        // Door
        const doorGeo = new THREE.BoxGeometry(1.5, 2.5, 0.1);
        const doorMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, 1.25, 4.05);
        group.add(door);

        // Windows
        const windowGeo = new THREE.BoxGeometry(1, 1, 0.1);
        const windowMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB });
        const window1 = new THREE.Mesh(windowGeo, windowMat);
        window1.position.set(-2.5, 3, 4.05);
        window1.userData.isWindow = true;
        nightObjects.windowMeshes.push(window1);
        group.add(window1);
        const window2 = new THREE.Mesh(windowGeo, windowMat);
        window2.position.set(2.5, 3, 4.05);
        window2.userData.isWindow = true;
        nightObjects.windowMeshes.push(window2);
        group.add(window2);

        group.position.set(x, y, z);
        scene.add(group);
    }

    function createFence(x, z, length, isHorizontal) {
        const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6);
        const postMat = new THREE.MeshStandardMaterial({ color: 0xDEB887 });
        const railGeo = new THREE.BoxGeometry(isHorizontal ? length : 0.1, 0.1, isHorizontal ? 0.1 : length);
        const railMat = new THREE.MeshStandardMaterial({ color: 0xDEB887 });

        const numPosts = Math.floor(length / 2) + 1;
        for (let i = 0; i < numPosts; i++) {
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(
                isHorizontal ? x + i * 2 : x,
                0.6,
                isHorizontal ? z : z + i * 2
            );
            post.castShadow = true;
            scene.add(post);
        }

        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(
            isHorizontal ? x + length / 2 : x,
            0.9,
            isHorizontal ? z : z + length / 2
        );
        scene.add(rail);
    }

    async function loadAgents() {
        try {
            let agentData = window.allAgents || [];

            if (agentData.length === 0) {
                const res = await fetch('/api/agents');
                const data = await res.json();
                agentData = Object.values(data.agents);
            }

            // Add default OpenClaw agents if no custom agents
            if (agentData.length === 0) {
                agentData = [
                    { id: 'jobs', displayName: 'Steve Jobs', emoji: '🍎' },
                    { id: 'kobe', displayName: 'Kobe Bryant', emoji: '🐍' },
                    { id: 'munger', displayName: 'Charlie Munger', emoji: '🧠' },
                    { id: 'hawking', displayName: 'Stephen Hawking', emoji: '🔭' },
                    { id: 'gates', displayName: 'Bill Gates', emoji: '💻' }
                ];
            }

            agentData.forEach((data, i) => createAgentCharacter(data, i));

            // Create animals
            createAnimals();

            // Create farm plots
            createFarmPlots();

            // Create forest with trees
            createForest();

            // Create mining area
            createMiningArea();
        } catch (e) {
            console.error("Failed to load agents:", e);
        }
    }

    // ========== Animals ==========
    const animals = {
        dogs: [],
        birds: [],
        fish: []
    };

    function createAnimals() {
        // Create 3 dogs near the house
        for (let i = 0; i < 3; i++) {
            createDog();
        }

        // Create 5 birds in the sky
        for (let i = 0; i < 5; i++) {
            createBird();
        }

        // Create 8 fish in the pond
        for (let i = 0; i < 8; i++) {
            createFish();
        }
    }

    function createDog() {
        const group = new THREE.Group();
        group.userData = {
            type: 'dog',
            isAnimal: true,
            name: 'dog',
            moveTimer: Math.random() * 5000,
            targetX: 0,
            targetZ: 0,
            isMoving: false
        };

        // Body - brownish
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.4, 0.8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.3;
        body.castShadow = true;
        group.add(body);

        // Head
        const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
        const head = new THREE.Mesh(headGeo, bodyMat);
        head.position.set(0, 0.55, 0.35);
        head.castShadow = true;
        group.add(head);

        // Ears
        const earGeo = new THREE.BoxGeometry(0.1, 0.2, 0.1);
        const leftEar = new THREE.Mesh(earGeo, bodyMat);
        leftEar.position.set(-0.12, 0.7, 0.35);
        group.add(leftEar);
        const rightEar = new THREE.Mesh(earGeo, bodyMat);
        rightEar.position.set(0.12, 0.7, 0.35);
        group.add(rightEar);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 0.6, 0.52);
        group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 0.6, 0.52);
        group.add(rightEye);

        // Tail
        const tailGeo = new THREE.BoxGeometry(0.1, 0.1, 0.3);
        const tail = new THREE.Mesh(tailGeo, bodyMat);
        tail.position.set(0, 0.4, -0.5);
        tail.rotation.x = -0.3;
        group.add(tail);

        // Legs
        const legGeo = new THREE.BoxGeometry(0.12, 0.3, 0.12);
        const positions = [
            [-0.15, 0.15, 0.25],
            [0.15, 0.15, 0.25],
            [-0.15, 0.15, -0.25],
            [0.15, 0.15, -0.25]
        ];
        positions.forEach(pos => {
            const leg = new THREE.Mesh(legGeo, bodyMat);
            leg.position.set(...pos);
            leg.castShadow = true;
            group.add(leg);
        });

        // Random position near house
        const x = -8 + (Math.random() - 0.5) * 10;
        const z = -18 + (Math.random() - 0.5) * 8;
        group.position.set(x, 0, z);
        group.userData.targetX = x;
        group.userData.targetZ = z;

        scene.add(group);
        animals.dogs.push(group);
    }

    function createBird() {
        const group = new THREE.Group();
        group.userData = {
            type: 'bird',
            isAnimal: true,
            name: 'bird',
            moveTimer: Math.random() * 3000,
            targetX: 0,
            targetY: 10,
            targetZ: 0,
            isMoving: false,
            wingPhase: Math.random() * Math.PI * 2
        };

        // Random bird color
        const colors = [0xFF6B6B, 0x4ECDC4, 0xFFE66D, 0x95E1D3, 0xF7FFF7];
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Body
        const bodyGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: color });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.scale.set(1, 0.8, 1.2);
        group.add(body);

        // Wings
        const wingGeo = new THREE.BoxGeometry(0.5, 0.05, 0.2);
        const wingMat = new THREE.MeshStandardMaterial({ color: color });
        const leftWing = new THREE.Mesh(wingGeo, wingMat);
        leftWing.position.set(-0.25, 0.05, 0);
        leftWing.userData.isWing = true;
        leftWing.userData.side = 'left';
        group.add(leftWing);
        const rightWing = new THREE.Mesh(wingGeo, wingMat);
        rightWing.position.set(0.25, 0.05, 0);
        rightWing.userData.isWing = true;
        rightWing.userData.side = 'right';
        group.add(rightWing);

        // Head
        const headGeo = new THREE.SphereGeometry(0.1, 8, 8);
        const head = new THREE.Mesh(headGeo, bodyMat);
        head.position.set(0, 0.1, 0.2);
        group.add(head);

        // Beak
        const beakGeo = new THREE.ConeGeometry(0.04, 0.15, 4);
        const beakMat = new THREE.MeshStandardMaterial({ color: 0xFFA500 });
        const beak = new THREE.Mesh(beakGeo, beakMat);
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 0.08, 0.35);
        group.add(beak);

        // Tail
        const tailGeo = new THREE.BoxGeometry(0.15, 0.05, 0.2);
        const tail = new THREE.Mesh(tailGeo, bodyMat);
        tail.position.set(0, 0, -0.25);
        group.add(tail);

        // Random position in sky
        const x = (Math.random() - 0.5) * 60;
        const y = 8 + Math.random() * 8;
        const z = (Math.random() - 0.5) * 40;
        group.position.set(x, y, z);
        group.userData.targetX = x;
        group.userData.targetY = y;
        group.userData.targetZ = z;

        scene.add(group);
        animals.birds.push(group);
    }

    function createFish() {
        const group = new THREE.Group();
        group.userData = {
            type: 'fish',
            isAnimal: true,
            name: 'fish',
            moveTimer: Math.random() * 4000,
            targetX: 0,
            targetZ: 0,
            targetY: -1,
            isMoving: false,
            tailPhase: Math.random() * Math.PI * 2
        };

        // Random fish color
        const colors = [0xFF6B6B, 0x4ECDC4, 0xFFE66D, 0xFF8C42, 0xC9B1FF];
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Body
        const bodyGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: color });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.scale.set(1, 0.5, 2);
        group.add(body);

        // Tail
        const tailGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
        const tail = new THREE.Mesh(tailGeo, bodyMat);
        tail.rotation.x = Math.PI / 2;
        tail.position.set(0, 0, -0.4);
        tail.userData.isTail = true;
        group.add(tail);

        // Eye
        const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(0.1, 0.05, 0.15);
        group.add(eye);

        // Random position in pond
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 8;
        const x = LOCATIONS.pond.x + Math.cos(angle) * radius;
        const z = LOCATIONS.pond.z + Math.sin(angle) * radius;
        const y = -0.8 + Math.random() * 0.5;
        group.position.set(x, y, z);
        group.userData.targetX = x;
        group.userData.targetZ = z;
        group.userData.targetY = y;

        scene.add(group);
        animals.fish.push(group);
    }

    // ========== Farm Plots ==========
    const farmPlots = [];

    function createFarmPlots() {
        // Create 4x3 grid of farm plots
        const startX = LOCATIONS.farm.x - 6;
        const startZ = LOCATIONS.farm.z - 4;
        const spacing = 2.5;

        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 4; col++) {
                createFarmPlot(
                    startX + col * spacing,
                    startZ + row * spacing
                );
            }
        }
    }

    function createFarmPlot(x, z) {
        const group = new THREE.Group();
        group.userData = {
            type: 'farmPlot',
            state: 'empty', // empty, planted, growing, ready, watered
            crop: null,
            growthTimer: 0,
            growthStage: 0,
            maxGrowth: 3 // 3 stages
        };

        // Soil patch (brown rectangle)
        const soilGeo = new THREE.PlaneGeometry(2, 1.8);
        const soilMat = new THREE.MeshStandardMaterial({
            color: 0x5D4037,
            roughness: 1
        });
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.rotation.x = -Math.PI / 2;
        soil.position.y = 0.01;
        soil.receiveShadow = true;
        group.add(soil);

        // Dirt border
        const borderGeo = new THREE.BoxGeometry(2.2, 0.15, 2);
        const borderMat = new THREE.MeshStandardMaterial({ color: 0x3E2723 });
        const border1 = new THREE.Mesh(borderGeo, borderMat);
        border1.position.set(0, 0.05, 0);
        group.add(border1);

        // Water indicator (blue, hidden by default)
        const waterGeo = new THREE.PlaneGeometry(1.8, 1.6);
        const waterMat = new THREE.MeshBasicMaterial({
            color: 0x2196F3,
            transparent: true,
            opacity: 0
        });
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.02;
        water.userData.isWater = true;
        group.add(water);

        // Crop sprite (hidden by default)
        const cropSprite = createEmojiSprite('🌱');
        cropSprite.position.y = 0.5;
        cropSprite.scale.set(0, 0, 0);
        cropSprite.userData.isCrop = true;
        group.add(cropSprite);

        // Stage 2 crop sprite
        const cropSprite2 = createEmojiSprite('🌿');
        cropSprite2.position.y = 0.6;
        cropSprite2.scale.set(0, 0, 0);
        cropSprite2.userData.isCrop2 = true;
        group.add(cropSprite2);

        // Stage 3 crop sprite (ready to harvest)
        const readySprite = createEmojiSprite('🥬');
        readySprite.position.y = 0.7;
        readySprite.scale.set(0, 0, 0);
        readySprite.userData.isReadyCrop = true;
        group.add(readySprite);

        group.position.set(x, 0, z);
        scene.add(group);
        farmPlots.push(group);
    }

    // ========== Forest and Trees ==========
    const trees = [];
    const choppableTrees = []; // Trees that can be chopped

    function createForest() {
        // Create trees scattered in forest area
        for (let i = 0; i < 25; i++) {
            createTree();
        }
    }

    function createTree() {
        if (!isActive) return; // Prevent creation if disposed
        const group = new THREE.Group();
        const emoji = TREE_TYPES[Math.floor(Math.random() * TREE_TYPES.length)];
        const sprite = createEmojiSprite(emoji);
        sprite.position.y = 2;
        sprite.scale.set(2, 2, 2);
        group.add(sprite);

        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.75;
        trunk.castShadow = true;
        group.add(trunk);

        // Random position in forest
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * LOCATIONS.forest.radius;
        const x = LOCATIONS.forest.x + Math.cos(angle) * radius;
        const z = LOCATIONS.forest.z + Math.sin(angle) * radius;
        group.position.set(x, 0, z);

        group.userData = {
            type: 'tree',
            isChoppable: true,
            emoji: emoji,
            health: 100
        };

        scene.add(group);
        trees.push(group);
        choppableTrees.push(group);
    }

    function chopTree(tree) {
        const data = tree.userData;
        if (!data.isChoppable) return false;

        // Add wood to inventory
        woodInventory += 1 + Math.floor(Math.random() * 2);

        // Drop wood
        dropItem(
            tree.position.x + (Math.random() - 0.5) * 2,
            tree.position.z + (Math.random() - 0.5) * 2,
            'wood',
            '🪵'
        );

        // Small chance to drop apple (also reduces hunger!)
        if (Math.random() < 0.4) {
            dropItem(
                tree.position.x + (Math.random() - 0.5) * 2,
                tree.position.z + (Math.random() - 0.5) * 2,
                'apple',
                '🍎'
            );
        }

        // Remove tree
        const idx = choppableTrees.indexOf(tree);
        if (idx > -1) choppableTrees.splice(idx, 1);

        scene.remove(tree);

        // Respawn a new tree elsewhere after delay
        setTimeout(() => {
            createTree();
        }, 30000 + Math.random() * 20000);

        return true;
    }

    // ========== Mining Area ==========
    const miningSpots = [];

    function createMiningArea() {
        // Create a rocky area with mining spots
        // Add some rock decorations
        for (let i = 0; i < 8; i++) {
            const rockGeo = new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.5, 0);
            const rockMat = new THREE.MeshStandardMaterial({
                color: 0x808080,
                roughness: 0.9
            });
            const rock = new THREE.Mesh(rockGeo, rockMat);

            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * LOCATIONS.mine.radius;
            rock.position.set(
                LOCATIONS.mine.x + Math.cos(angle) * radius,
                0.3,
                LOCATIONS.mine.z + Math.sin(angle) * radius
            );
            rock.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            rock.castShadow = true;
            scene.add(rock);
        }

        // Create mining spots
        for (let i = 0; i < 5; i++) {
            createMiningSpot();
        }
    }

    function createMiningSpot() {
        const group = new THREE.Group();

        // Rock pile
        const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x696969,
            roughness: 0.95
        });
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.y = 0.4;
        rock.castShadow = true;
        group.add(rock);

        // Pickaxe mark
        const markGeo = new THREE.CircleGeometry(0.3, 8);
        const markMat = new THREE.MeshBasicMaterial({
            color: 0x3d3d3d,
            transparent: true,
            opacity: 0.6
        });
        const mark = new THREE.Mesh(markGeo, markMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.y = 0.02;
        mark.userData.isMiningSpot = true;
        group.add(mark);

        // Position in mine area
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * LOCATIONS.mine.radius * 0.8;
        group.position.set(
            LOCATIONS.mine.x + Math.cos(angle) * radius,
            0,
            LOCATIONS.mine.z + Math.sin(angle) * radius
        );

        group.userData = {
            type: 'miningSpot',
            mined: false,
            respawnTimer: 0
        };

        scene.add(group);
        miningSpots.push(group);
    }

    function mineOre(spot) {
        const data = spot.userData;
        if (data.mined) return false;

        // Add ore to inventory
        oreInventory += 1 + Math.floor(Math.random() * 2);

        // Drop multiple ores (2-4 items)
        const numDrops = 2 + Math.floor(Math.random() * 3);

        for (let i = 0; i < numDrops; i++) {
            // Determine what ore is found
            const roll = Math.random();
            let cumulative = 0;
            let foundOre = ORE_TYPES[0];

            for (const ore of ORE_TYPES) {
                cumulative += ore.chance;
                if (roll < cumulative) {
                    foundOre = ore;
                    break;
                }
            }

            // Drop the ore scattered around
            const x = spot.position.x + (Math.random() - 0.5) * 3;
            const z = spot.position.z + (Math.random() - 0.5) * 3;
            dropItem(x, z, 'ore', foundOre.emoji);

            // Add sparkle effect for valuable ores
            if (foundOre.name === 'gold' || foundOre.name === 'diamond' || foundOre.name === 'emerald' || foundOre.name === 'amethyst') {
                createSparkleEffect(x, 1, z, foundOre.name);
            }
        }

        // Mark as mined
        data.mined = true;

        // Change appearance (dug hole)
        spot.children.forEach(child => {
            if (child.userData.isMiningSpot) {
                child.material.color.setHex(0x2d2d2d);
                child.material.opacity = 0.8;
            }
        });

        // Respawn after delay
        setTimeout(() => {
            data.mined = false;
            spot.children.forEach(child => {
                if (child.userData.isMiningSpot) {
                    child.material.color.setHex(0x3d3d3d);
                    child.material.opacity = 0.6;
                }
            });
        }, 20000 + Math.random() * 15000);

        return true;
    }

    function updateFarmPlots(time) {
        farmPlots.forEach(plot => {
            const data = plot.userData;

            // Growth timer for planted crops
            if (data.state === 'planted' || data.state === 'growing' || data.state === 'watered') {
                data.growthTimer += 16;

                // Growth stages
                const growthTime = 8000; // 8 seconds per stage
                const newStage = Math.min(Math.floor(data.growthTimer / growthTime), data.maxGrowth);

                if (newStage > data.growthStage) {
                    data.growthStage = newStage;

                    // Update crop visuals
                    plot.children.forEach(child => {
                        if (child.userData.isCrop && data.growthStage >= 1) {
                            child.scale.set(1, 1, 1);
                        }
                        if (child.userData.isCrop2 && data.growthStage >= 2) {
                            child.scale.set(1.2, 1.2, 1.2);
                        }
                        if (child.userData.isReadyCrop && data.growthStage >= 3) {
                            child.scale.set(1.5, 1.5, 1.5);
                        }
                    });

                    // Ready to harvest
                    if (data.growthStage >= 3 && data.state !== 'ready') {
                        data.state = 'ready';
                        // Show random mature crop
                        const matureCrop = CROP_TYPES[Math.floor(Math.random() * CROP_TYPES.length)];
                        const crop = plot.children.find(c => c.userData.isReadyCrop);
                        if (crop) {
                            // Replace emoji
                            const newSprite = createEmojiSprite(matureCrop);
                            newSprite.position.copy(crop.position);
                            newSprite.scale.set(1.5, 1.5, 1.5);
                            newSprite.userData.isReadyCrop = true;
                            plot.remove(crop);
                            plot.add(newSprite);
                            data.matureCrop = matureCrop;
                        }
                    }
                }
            }

            // Water drying up (water lasts 5 seconds)
            if (data.state === 'watered') {
                const waterTime = data.waterStartTime || 0;
                if (time - waterTime > 5000) {
                    data.state = 'growing';
                    // Hide water
                    plot.children.forEach(child => {
                        if (child.userData.isWater) {
                            child.material.opacity = 0;
                        }
                    });
                }
            }
        });
    }

    function plantCrop(plot) {
        const data = plot.userData;
        if (data.state !== 'empty') return false;

        data.state = 'planted';
        data.crop = CROP_TYPES[Math.floor(Math.random() * CROP_TYPES.length)];
        data.growthTimer = 0;
        data.growthStage = 0;

        // Show seedling
        const crop = plot.children.find(c => c.userData.isCrop);
        if (crop) {
            crop.scale.set(0.5, 0.5, 0.5);
        }

        return true;
    }

    function waterCrop(plot) {
        const data = plot.userData;
        if (data.state !== 'planted' && data.state !== 'growing') return false;

        data.state = 'watered';
        data.waterStartTime = Date.now();

        // Show water
        plot.children.forEach(child => {
            if (child.userData.isWater) {
                child.material.opacity = 0.4;
            }
        });

        return true;
    }

    function harvestCrop(plot) {
        const data = plot.userData;
        if (data.state !== 'ready') return false;

        // Drop harvested crops around (reduced)
        for (let i = 0; i < 1; i++) {
            dropItem(
                plot.position.x + (Math.random() - 0.5) * 2,
                plot.position.z + (Math.random() - 0.5) * 2,
                'crop',
                data.matureCrop || CROP_TYPES[Math.floor(Math.random() * CROP_TYPES.length)]
            );
        }

        // Reset plot
        data.state = 'empty';
        data.crop = null;
        data.growthTimer = 0;
        data.growthStage = 0;

        // Reset crop visuals
        plot.children.forEach(child => {
            if (child.userData.isCrop) child.scale.set(0, 0, 0);
            if (child.userData.isCrop2) child.scale.set(0, 0, 0);
            if (child.userData.isReadyCrop) child.scale.set(0, 0, 0);
        });

        return true;
    }

    function updateAnimals(time) {
        const now = Date.now();

        // Update dogs
        animals.dogs.forEach(dog => {
            dog.userData.moveTimer -= 16;

            // Wagging tail
            dog.children.forEach(child => {
                if (child.userData.isTail) {
                    child.rotation.y = Math.sin(time * 0.01) * 0.5;
                }
            });

            if (dog.userData.moveTimer <= 0) {
                // Find new target near house
                dog.userData.targetX = -8 + (Math.random() - 0.5) * 15;
                dog.userData.targetZ = -18 + (Math.random() - 0.5) * 12;
                dog.userData.moveTimer = 5000 + Math.random() * 5000;
                dog.userData.isMoving = true;
            }

            // Move towards target
            if (dog.userData.isMoving) {
                const dx = dog.userData.targetX - dog.position.x;
                const dz = dog.userData.targetZ - dog.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist > 0.1) {
                    const speed = 0.015;
                    dog.position.x += (dx / dist) * speed;
                    dog.position.z += (dz / dist) * speed;

                    // Face direction
                    dog.rotation.y = Math.atan2(dx, dz);
                } else {
                    dog.userData.isMoving = false;
                }
            }
        });

        // Update birds
        animals.birds.forEach(bird => {
            bird.userData.moveTimer -= 16;

            // Wing flapping
            bird.children.forEach(child => {
                if (child.userData.isWing) {
                    const flapSpeed = 0.015;
                    const flapAmount = 0.6;
                    if (child.userData.side === 'left') {
                        child.rotation.z = Math.sin(time * flapSpeed + bird.userData.wingPhase) * flapAmount;
                    } else {
                        child.rotation.z = -Math.sin(time * flapSpeed + bird.userData.wingPhase) * flapAmount;
                    }
                }
            });

            if (bird.userData.moveTimer <= 0) {
                // Find new target in sky
                bird.userData.targetX = (Math.random() - 0.5) * 60;
                bird.userData.targetY = 8 + Math.random() * 10;
                bird.userData.targetZ = (Math.random() - 0.5) * 50;
                bird.userData.moveTimer = 4000 + Math.random() * 4000;
                bird.userData.isMoving = true;
            }

            // Move towards target
            if (bird.userData.isMoving) {
                const dx = bird.userData.targetX - bird.position.x;
                const dy = bird.userData.targetY - bird.position.y;
                const dz = bird.userData.targetZ - bird.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist > 0.3) {
                    const speed = 0.04;
                    bird.position.x += (dx / dist) * speed;
                    bird.position.y += (dy / dist) * speed;
                    bird.position.z += (dz / dist) * speed;

                    // Face direction
                    bird.rotation.y = Math.atan2(dx, dz);
                } else {
                    bird.userData.isMoving = false;
                }
            }

            // Billboard to camera (keep upright)
            bird.rotation.x = 0;
            bird.rotation.z = 0;
        });

        // Update fish
        animals.fish.forEach(fish => {
            fish.userData.moveTimer -= 16;

            // Tail wagging
            fish.children.forEach(child => {
                if (child.userData.isTail) {
                    child.rotation.y = Math.sin(time * 0.01 + fish.userData.tailPhase) * 0.5;
                }
            });

            if (fish.userData.moveTimer <= 0) {
                // Find new target in pond
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 8;
                fish.userData.targetX = LOCATIONS.pond.x + Math.cos(angle) * radius;
                fish.userData.targetZ = LOCATIONS.pond.z + Math.sin(angle) * radius;
                fish.userData.targetY = -0.8 + Math.random() * 0.6;
                fish.userData.moveTimer = 4000 + Math.random() * 4000;
                fish.userData.isMoving = true;
            }

            // Move towards target
            if (fish.userData.isMoving) {
                const dx = fish.userData.targetX - fish.position.x;
                const dy = fish.userData.targetY - fish.position.y;
                const dz = fish.userData.targetZ - fish.position.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist > 0.1) {
                    const speed = 0.02;
                    fish.position.x += (dx / dist) * speed;
                    fish.position.y += (dy / dist) * speed;
                    fish.position.z += (dz / dist) * speed;

                    // Face direction
                    fish.rotation.y = Math.atan2(dx, dz);
                } else {
                    fish.userData.isMoving = false;
                }
            }
        });
    }

    // ===== 3D Outfit System =====
    const OUTFIT_COLORS = [
        { shirt: 0xFF6B6B, pants: 0x4A4A8A, accent: 0xFFD700 },
        { shirt: 0x4ECDC4, pants: 0x2C3E50, accent: 0xE74C3C },
        { shirt: 0x45B7D1, pants: 0x8B4513, accent: 0xFFFFFF },
        { shirt: 0xFFEAA7, pants: 0x2F4F4F, accent: 0x2980B9 },
        { shirt: 0xDDA0DD, pants: 0x483D8B, accent: 0xFFD700 },
        { shirt: 0xE74C3C, pants: 0x1A1A2E, accent: 0xFFFFFF },
        { shirt: 0x2ECC71, pants: 0x34495E, accent: 0xF39C12 },
        { shirt: 0xF39C12, pants: 0x6C3483, accent: 0xFFFFFF },
        { shirt: 0x1ABC9C, pants: 0x7B241C, accent: 0xFFD700 },
        { shirt: 0x9B59B6, pants: 0x1C2833, accent: 0xE74C3C },
        { shirt: 0x3498DB, pants: 0x616A6B, accent: 0xFFFFFF },
        { shirt: 0xFFFFFF, pants: 0x1A1A1A, accent: 0xE74C3C },
        { shirt: 0x1A1A1A, pants: 0x1A1A1A, accent: 0xFFD700 },
        { shirt: 0xF1948A, pants: 0x2C3E50, accent: 0x3498DB },
        { shirt: 0x82E0AA, pants: 0x6E2C00, accent: 0xFFD700 },
        { shirt: 0xE67E22, pants: 0x1B4F72, accent: 0x2ECC71 },
    ];

    const OUTFIT_STYLES = [
        { name: 'casual',  torso: 'cylinder', pattern: 'solid',    hat: null,      accessories: [] },
        { name: 'suit',    torso: 'box',      pattern: 'solid',    hat: null,      accessories: ['tie', 'collar'] },
        { name: 'hoodie',  torso: 'wide',     pattern: 'solid',    hat: 'beanie',  accessories: [] },
        { name: 'sporty',  torso: 'cylinder', pattern: 'hstripes', hat: 'cap',     accessories: [] },
        { name: 'fancy',   torso: 'tapered',  pattern: 'solid',    hat: 'tophat',  accessories: ['tie'] },
        { name: 'worker',  torso: 'box',      pattern: 'solid',    hat: 'hardhat', accessories: ['belt'] },
        { name: 'striped', torso: 'cylinder', pattern: 'hstripes', hat: null,      accessories: ['belt'] },
        { name: 'dotted',  torso: 'cylinder', pattern: 'dots',     hat: 'beanie',  accessories: [] },
        { name: 'cowboy',  torso: 'tapered',  pattern: 'solid',    hat: 'cowboy',  accessories: ['belt'] },
        { name: 'royal',   torso: 'wide',     pattern: 'vstripes', hat: 'crown',   accessories: [] },
        { name: 'chef',    torso: 'box',      pattern: 'solid',    hat: 'chef',    accessories: [] },
        { name: 'wizard',  torso: 'tapered',  pattern: 'gradient', hat: 'wizard',  accessories: ['scarf'] },
    ];

    // Generate canvas-based pattern textures
    function createPatternTexture(baseColor, pattern, accentColor) {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const baseHex = '#' + baseColor.toString(16).padStart(6, '0');
        const accHex = '#' + (accentColor || 0xFFFFFF).toString(16).padStart(6, '0');
        ctx.fillStyle = baseHex;
        ctx.fillRect(0, 0, 64, 64);
        switch (pattern) {
            case 'hstripes':
                ctx.globalAlpha = 0.35; ctx.fillStyle = accHex;
                for (let y = 0; y < 64; y += 12) ctx.fillRect(0, y, 64, 6);
                ctx.globalAlpha = 1; break;
            case 'vstripes':
                ctx.globalAlpha = 0.3; ctx.fillStyle = accHex;
                for (let x = 0; x < 64; x += 12) ctx.fillRect(x, 0, 6, 64);
                ctx.globalAlpha = 1; break;
            case 'dots':
                ctx.globalAlpha = 0.4; ctx.fillStyle = accHex;
                for (let x = 8; x < 64; x += 16)
                    for (let y = 8; y < 64; y += 16)
                        { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
                ctx.globalAlpha = 1; break;
            case 'gradient':
                const g = ctx.createLinearGradient(0, 0, 0, 64);
                g.addColorStop(0, baseHex); g.addColorStop(1, accHex);
                ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); break;
        }
        return new THREE.CanvasTexture(canvas);
    }

    // Build hat meshes
    function createHatMeshes(hatType, accentColor) {
        const meshes = [];
        switch (hatType) {
            case 'cap': {
                const mat = new THREE.MeshStandardMaterial({ color: accentColor });
                const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
                dome.position.y = 2.75; dome.castShadow = true; meshes.push(dome);
                const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 16, 1, false, -Math.PI/2, Math.PI), mat);
                brim.position.set(0, 2.7, 0.25); brim.rotation.x = -0.2; meshes.push(brim);
                break;
            }
            case 'tophat': {
                const mat = new THREE.MeshStandardMaterial({ color: 0x1A1A1A });
                const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 16), mat);
                brim.position.y = 2.75; meshes.push(brim);
                const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.38, 0.55, 16), mat);
                crown.position.y = 3.02; crown.castShadow = true; meshes.push(crown);
                const band = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.07, 16),
                    new THREE.MeshStandardMaterial({ color: accentColor }));
                band.position.y = 2.82; meshes.push(band);
                break;
            }
            case 'beanie': {
                const mat = new THREE.MeshStandardMaterial({ color: accentColor });
                const dome = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
                dome.position.y = 2.6; dome.castShadow = true; meshes.push(dome);
                const pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8),
                    new THREE.MeshStandardMaterial({ color: 0xFFFFFF }));
                pom.position.y = 2.98; meshes.push(pom);
                break;
            }
            case 'cowboy': {
                const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
                const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.05, 16), mat);
                brim.position.y = 2.75; meshes.push(brim);
                const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.35, 16), mat);
                crown.position.y = 2.92; crown.castShadow = true; meshes.push(crown);
                break;
            }
            case 'hardhat': {
                const mat = new THREE.MeshStandardMaterial({ color: 0xFFD700 });
                const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
                dome.position.y = 2.7; dome.castShadow = true; meshes.push(dome);
                const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16), mat);
                brim.position.y = 2.68; meshes.push(brim);
                break;
            }
            case 'crown': {
                const mat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.7, roughness: 0.2 });
                const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.25, 8), mat);
                base.position.y = 2.8; meshes.push(base);
                for (let i = 0; i < 5; i++) {
                    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 4), mat);
                    const a = (i / 5) * Math.PI * 2;
                    spike.position.set(Math.cos(a) * 0.35, 3.0, Math.sin(a) * 0.35);
                    meshes.push(spike);
                }
                const gem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8),
                    new THREE.MeshStandardMaterial({ color: 0xE74C3C, emissive: 0xE74C3C, emissiveIntensity: 0.3 }));
                gem.position.set(0, 2.85, 0.42); meshes.push(gem);
                break;
            }
            case 'chef': {
                const mat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
                const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.15, 16), mat);
                base.position.y = 2.76; meshes.push(base);
                const puff = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 16), mat);
                puff.position.y = 3.05; puff.castShadow = true; meshes.push(puff);
                break;
            }
            case 'wizard': {
                const mat = new THREE.MeshStandardMaterial({ color: 0x483D8B });
                const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 16), mat);
                cone.position.y = 3.05; cone.rotation.z = 0.1; cone.castShadow = true; meshes.push(cone);
                const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.04, 16), mat);
                brim.position.y = 2.7; meshes.push(brim);
                const star = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
                    new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xFFD700, emissiveIntensity: 0.5 }));
                star.position.set(0, 2.95, 0.35); meshes.push(star);
                break;
            }
        }
        meshes.forEach(m => { m.userData.isOutfit = true; });
        return meshes;
    }

    // Build accessory meshes
    function createAccessoryMeshes(accessories, accentColor) {
        const meshes = [];
        accessories.forEach(acc => {
            switch (acc) {
                case 'tie': {
                    const mat = new THREE.MeshStandardMaterial({ color: accentColor });
                    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.05), mat);
                    tie.position.set(0, 1.4, 0.52); meshes.push(tie);
                    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat);
                    knot.position.set(0, 1.7, 0.52); meshes.push(knot);
                    break;
                }
                case 'collar': {
                    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 8, 16),
                        new THREE.MeshStandardMaterial({ color: 0xFFFFFF }));
                    collar.position.y = 1.85; collar.rotation.x = Math.PI / 2; meshes.push(collar);
                    break;
                }
                case 'belt': {
                    const beltMat = new THREE.MeshStandardMaterial({ color: 0x4A3728 });
                    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.04, 8, 16), beltMat);
                    belt.position.y = 0.85; belt.rotation.x = Math.PI / 2; meshes.push(belt);
                    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06),
                        new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.8 }));
                    buckle.position.set(0, 0.85, 0.5); meshes.push(buckle);
                    break;
                }
                case 'scarf': {
                    const mat = new THREE.MeshStandardMaterial({ color: accentColor });
                    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 16), mat);
                    ring.position.y = 1.9; ring.rotation.x = Math.PI / 2; meshes.push(ring);
                    const hang = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.06), mat);
                    hang.position.set(0.3, 1.6, 0.45); hang.rotation.z = -0.3; meshes.push(hang);
                    break;
                }
                case 'backpack': {
                    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.25),
                        new THREE.MeshStandardMaterial({ color: accentColor }));
                    bp.position.set(0, 1.3, -0.5); bp.castShadow = true; meshes.push(bp);
                    break;
                }
            }
        });
        meshes.forEach(m => { m.userData.isOutfit = true; });
        return meshes;
    }

    // Build complete outfit on an agent (removes old, adds new)
    function buildOutfitOnAgent(agent, styleIdx, colorIdx) {
        // Remove old outfit meshes
        const toRemove = [];
        agent.children.forEach(child => { if (child.userData.isOutfit) toRemove.push(child); });
        toRemove.forEach(mesh => {
            agent.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (mesh.material.map) mesh.material.map.dispose();
                mesh.material.dispose();
            }
        });

        const style = OUTFIT_STYLES[styleIdx];
        const colors = OUTFIT_COLORS[colorIdx];

        // Shirt material (with optional pattern texture)
        const shirtOpts = { color: colors.shirt };
        if (style.pattern !== 'solid') {
            shirtOpts.map = createPatternTexture(colors.shirt, style.pattern, colors.accent);
        }
        const shirtMat = new THREE.MeshStandardMaterial(shirtOpts);
        const pantsMat = new THREE.MeshStandardMaterial({ color: colors.pants });

        // Torso shape
        let bodyCyl, topPart;
        switch (style.torso) {
            case 'box': {
                bodyCyl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.7), shirtMat);
                bodyCyl.position.y = 1.25;
                topPart = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 0.7), shirtMat);
                topPart.position.y = 1.75;
                break;
            }
            case 'tapered': {
                bodyCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 1, 16), shirtMat);
                bodyCyl.position.y = 1.25;
                topPart = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 16), shirtMat);
                topPart.position.y = 1.75;
                break;
            }
            case 'wide': {
                bodyCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.55, 1, 16), shirtMat);
                bodyCyl.position.y = 1.25;
                topPart = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), shirtMat);
                topPart.position.y = 1.75;
                break;
            }
            default: { // cylinder
                bodyCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 16), shirtMat);
                bodyCyl.position.y = 1.25;
                topPart = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), shirtMat);
                topPart.position.y = 1.75;
                break;
            }
        }
        bodyCyl.castShadow = true; bodyCyl.userData.isOutfit = true;
        topPart.castShadow = true; topPart.userData.isOutfit = true;
        agent.add(bodyCyl); agent.add(topPart);

        // Pants
        const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), pantsMat);
        bottom.position.y = 0.75; bottom.castShadow = true; bottom.userData.isOutfit = true;
        agent.add(bottom);

        // Hat
        if (style.hat) createHatMeshes(style.hat, colors.accent).forEach(m => agent.add(m));

        // Accessories
        if (style.accessories.length > 0) createAccessoryMeshes(style.accessories, colors.accent).forEach(m => agent.add(m));

        // Store current indices
        agent.userData.currentStyleIdx = styleIdx;
        agent.userData.currentColorIdx = colorIdx;
    }

    function changeOutfit(agent) {
        let newStyle, newColor;
        do { newStyle = Math.floor(Math.random() * OUTFIT_STYLES.length); }
        while (newStyle === agent.userData.currentStyleIdx && OUTFIT_STYLES.length > 1);
        do { newColor = Math.floor(Math.random() * OUTFIT_COLORS.length); }
        while (newColor === agent.userData.currentColorIdx && OUTFIT_COLORS.length > 1);
        buildOutfitOnAgent(agent, newStyle, newColor);
    }

    function createAgentCharacter(data, index) {
        const group = new THREE.Group();
        group.userData = {
            agentId: data.id,
            isAgent: true,
            hunger: 0, // 0-100, increases over time
            lastAte: Date.now()
        };

        // Random position avoiding obstacles
        let x, z, validPos = false;
        let attempts = 0;
        do {
            x = (Math.random() - 0.5) * 60;
            z = (Math.random() - 0.5) * 60;
            // Avoid house area, pond, and center
            const distFromCenter = Math.sqrt(x * x + z * z);
            const inHouse = x > -12 && x < 2 && z > -28 && z < -12;
            const inPond = Math.sqrt((x - 20) ** 2 + (z + 15) ** 2) < 15;
            if (!inHouse && !inPond && distFromCenter > 5) validPos = true;
            attempts++;
        } while (!validPos && attempts < 50);

        group.position.set(x, 0, z);

        // Build initial outfit (each agent gets a different style + color)
        const initStyle = index % OUTFIT_STYLES.length;
        const initColor = index % OUTFIT_COLORS.length;
        buildOutfitOnAgent(group, initStyle, initColor);
        group.userData.outfitTimer = 30000 + Math.random() * 60000; // 30-90s before first change

        // Head
        const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xFFDAB9 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 2.3;
        head.castShadow = true;
        group.add(head);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.15, 2.35, 0.4);
        group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.15, 2.35, 0.4);
        group.add(rightEye);

        // Avatar circle above head
        const { canvas: avatarCanvas, texture: avatarTexture } = createAvatarCanvas(data);
        const avatarGeo = new THREE.CircleGeometry(0.8, 32);
        const avatarMat = new THREE.MeshBasicMaterial({
            map: avatarTexture,
            transparent: true,
            side: THREE.DoubleSide
        });
        const avatar = new THREE.Mesh(avatarGeo, avatarMat);
        avatar.position.y = 3.5;
        avatar.userData.isSprite = true;
        avatar.userData.texture = avatarTexture; // Store for updates
        group.add(avatar);

        // Name label
        const nameCanvas = createNameCanvas(data.displayName || data.name);
        const nameTexture = new THREE.CanvasTexture(nameCanvas);
        const nameGeo = new THREE.PlaneGeometry(3, 0.5);
        const nameMat = new THREE.MeshBasicMaterial({
            map: nameTexture,
            transparent: true,
            side: THREE.DoubleSide
        });
        const nameLabel = new THREE.Mesh(nameGeo, nameMat);
        nameLabel.position.y = 4.3;
        nameLabel.userData.isNameLabel = true;
        group.add(nameLabel);

        // Shadow
        const shadowGeo = new THREE.CircleGeometry(0.6, 16);
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.05;
        shadow.renderOrder = -1;
        group.add(shadow);

        // Random movement data
        group.userData.targetX = x;
        group.userData.targetZ = z;
        group.userData.moveTimer = Math.random() * 5000 + 2000;
        group.userData.isMoving = false;
        group.userData.displayName = data.displayName || data.name;
        group.userData.emoji = data.emoji || '🤖';
        group.userData.avatarUrl = data.avatarUrl;

        // Chat bubble (hidden by default)
        group.userData.chatBubble = null;

        // Fun animation state
        group.userData.currentEffect = null;
        group.userData.effectTimer = 0;
        group.userData.effectTarget = null; // For互动效果

        scene.add(group);
        agents.push(group);
    }

    // ========== Fun Animations ==========

    // Store active effects and dropped items
    const activeEffects = []; // { type, agent, target, sprite, timer }
    const droppedItems = []; // { mesh, timer, type }

    // Special locations - balanced layout
    const LOCATIONS = {
        house: { x: -8, z: -20, radius: 10 },      // Center-left
        pond: { x: 0, z: 28, radius: 12 },           // Bottom center
        farm: { x: 20, z: -5, radius: 14 },         // Right-center
        forest: { x: -30, z: 15, radius: 12 },      // Left side
        mine: { x: -30, z: -35, radius: 8 },        // Back-left corner
        office: { x: 25, z: 25, radius: 10 },       // Bottom-right corner
        village: { x: 30, z: -30, radius: 15 },     // Village area for building houses
        rocketPad: { x: 0, z: -45, radius: 10 },    // Rocket launch pad (back-center)
        railStation: { x: 55, z: 0, radius: 8 }       // High-speed rail station (right edge)
    };

    // Resources
    let woodInventory = 0; // Wood from chopping trees
    let oreInventory = 0; // Ore from mining
    const WOOD_NEEDED_PER_HOUSE = 3; // Wood needed to build a wood house
    const ORE_NEEDED_PER_HOUSE = 3; // Ore needed to build an ore house

    // Fish types
    const FISH_TYPES = ['🐟', '🐠', '🐡', '🦈', '🐙', '🦐', '🦑', '🐬'];

    // Crop types
    const CROP_TYPES = ['🥕', '🥬', '🌽', '🍅', '🥔', '🍆', '🍓', '🍉'];

    // Ore types (mining)
    const ORE_TYPES = [
        { emoji: '🪨', name: 'stone', chance: 0.35 },
        { emoji: '⛏️', name: 'iron', chance: 0.25 },
        { emoji: '🪙', name: 'gold', chance: 0.15 },
        { emoji: '💎', name: 'diamond', chance: 0.1 },
        { emoji: '🔮', name: 'amethyst', chance: 0.1 },
        { emoji: '🟢', name: 'emerald', chance: 0.05 }
    ];

    // House types for building
    const HOUSE_TYPES = [
        { name: 'cottage', floors: 1, color: 0x8B4513, roofColor: 0xA0522D },
        { name: 'house', floors: 2, color: 0xDEB887, roofColor: 0x8B0000 },
        { name: 'villa', floors: 3, color: 0xF5F5DC, roofColor: 0x2F4F4F },
        { name: 'tower', floors: 4, color: 0x708090, roofColor: 0x191970 }
    ];

    // Creative decorations that agents can build
    const CREATIVE_TYPES = [
        { name: 'pumpkin', emoji: '🎃', desc: '万圣节南瓜', woodCost: 2, oreCost: 0, color: 0xFF6600 },
        { name: 'lantern_red', emoji: '🏮', desc: '红灯笼', woodCost: 1, oreCost: 0, color: 0xFF0000 },
        { name: 'lantern_gold', emoji: '🏮', desc: '金灯笼', woodCost: 1, oreCost: 1, color: 0xFFD700 },
        { name: 'lantern_paper', emoji: '🏮', desc: '纸灯笼', woodCost: 1, oreCost: 0, color: 0xFFE4E1 },
        { name: 'lamp', emoji: '💡', desc: '路灯', woodCost: 1, oreCost: 2, color: 0xFFFF00 },
        { name: 'street_lamp', emoji: '🏮', desc: '街灯', woodCost: 1, oreCost: 2, color: 0xFFFFE0 },
        { name: 'fountain', emoji: '⛲', desc: '喷泉', woodCost: 0, oreCost: 4, color: 0x00BFFF },
        { name: 'flower_red', emoji: '🌹', desc: '红玫瑰', woodCost: 0, oreCost: 1, color: 0xFF1493 },
        { name: 'flower_sunflower', emoji: '🌻', desc: '向日葵', woodCost: 0, oreCost: 1, color: 0xFFD700 },
        { name: 'flower_tulip', emoji: '🌷', desc: '郁金香', woodCost: 0, oreCost: 1, color: 0xFF69B4 },
        { name: 'flower_hibiscus', emoji: '🌺', desc: '扶桑', woodCost: 0, oreCost: 1, color: 0xFF0040 },
        { name: 'flower_sakura', emoji: '🌸', desc: '樱花', woodCost: 0, oreCost: 1, color: 0xFFB7C5 },
        { name: 'flower_lavender', emoji: '💜', desc: '薰衣草', woodCost: 0, oreCost: 1, color: 0xE6E6FA },
        { name: 'bonsai', emoji: '🌳', desc: '盆景', woodCost: 2, oreCost: 0, color: 0x228B22 },
        { name: 'snowman', emoji: '⛄', desc: '雪人', woodCost: 0, oreCost: 2, color: 0xFFFAFA },
        { name: 'christmas_tree', emoji: '🎄', desc: '圣诞树', woodCost: 3, oreCost: 1, color: 0x006400 },
        { name: 'gift', emoji: '🎁', desc: '礼物盒', woodCost: 1, oreCost: 1, color: 0xFF1493 },
        { name: 'cake', emoji: '🎂', desc: '蛋糕', woodCost: 0, oreCost: 2, color: 0xFFB6C1 },
        { name: 'firework', emoji: '🎆', desc: '烟花', woodCost: 0, oreCost: 1, color: 0xFF4500 },
        { name: 'balloon', emoji: '🎈', desc: '气球', woodCost: 0, oreCost: 1, color: 0xFF69B4 },
        { name: 'balloon_red', emoji: '🎈', desc: '红气球', woodCost: 0, oreCost: 1, color: 0xFF0000 },
        { name: 'balloon_blue', emoji: '🎈', desc: '蓝气球', woodCost: 0, oreCost: 1, color: 0x4169E1 },
        { name: 'flag', emoji: '🚩', desc: '旗帜', woodCost: 2, oreCost: 0, color: 0xFF0000 },
        { name: 'flag_blue', emoji: '🚩', desc: '蓝旗', woodCost: 2, oreCost: 0, color: 0x4169E1 },
        { name: 'bench', emoji: '🪑', desc: '长椅', woodCost: 2, oreCost: 0, color: 0x8B4513 },
        { name: 'statue', emoji: '🗿', desc: '雕像', woodCost: 0, oreCost: 3, color: 0x808080 },
        { name: 'statue_gold', emoji: '🗿', desc: '金雕像', woodCost: 0, oreCost: 5, color: 0xFFD700 },
        { name: 'tent', emoji: '⛺', desc: '帐篷', woodCost: 2, oreCost: 0, color: 0xFFA500 },
        { name: 'windmill', emoji: '🎡', desc: '风车', woodCost: 3, oreCost: 1, color: 0xFF69B4 },
        { name: 'well', emoji: '🕳️', desc: '水井', woodCost: 2, oreCost: 1, color: 0x8B7355 },
        { name: 'bridge', emoji: '🌉', desc: '小桥', woodCost: 3, oreCost: 0, color: 0x8B4513 },
        { name: 'rock_garden', emoji: '🪨', desc: '枯山水', woodCost: 0, oreCost: 2, color: 0xD3D3D3 },
        { name: 'pond_decor', emoji: '🦆', desc: '小池塘', woodCost: 0, oreCost: 2, color: 0x87CEEB },
        { name: 'bell', emoji: '🔔', desc: '风铃', woodCost: 1, oreCost: 1, color: 0xFFD700 },
        { name: 'hourglass', emoji: '⏳', desc: '沙漏', woodCost: 0, oreCost: 1, color: 0xD2B48C },
        { name: 'compass', emoji: '🧭', desc: '指南针', woodCost: 0, oreCost: 2, color: 0xC0C0C0 },
        { name: 'anchor', emoji: '⚓', desc: '锚', woodCost: 0, oreCost: 2, color: 0x696969 },
        { name: 'drum', emoji: '🥁', desc: '鼓', woodCost: 2, oreCost: 0, color: 0x8B4513 },
        { name: 'guitar', emoji: '🎸', desc: '吉他', woodCost: 2, oreCost: 0, color: 0xD2691E },
        { name: 'piano', emoji: '🎹', desc: '钢琴', woodCost: 0, oreCost: 3, color: 0x1C1C1C },
        { name: 'violin', emoji: '🎻', desc: '小提琴', woodCost: 1, oreCost: 1, color: 0xD2691E },
        { name: 'telescope', emoji: '🔭', desc: '望远镜', woodCost: 0, oreCost: 3, color: 0xC0C0C0 },
        { name: 'microscope', emoji: '🔬', desc: '显微镜', woodCost: 0, oreCost: 3, color: 0xC0C0C0 },
        { name: 'torii_gate', emoji: '⛩️', desc: '鸟居', woodCost: 4, oreCost: 2, color: 0xCC0000 },
        { name: 'lighthouse', emoji: '🏠', desc: '灯塔', woodCost: 2, oreCost: 4, color: 0xFFFFFF },
        { name: 'ferris_wheel', emoji: '🎡', desc: '摩天轮', woodCost: 3, oreCost: 4, color: 0xFF69B4 },
        { name: 'carousel', emoji: '🎠', desc: '旋转木马', woodCost: 3, oreCost: 3, color: 0xFFD700 },
        { name: 'hot_air_balloon', emoji: '🎈', desc: '热气球', woodCost: 2, oreCost: 2, color: 0xFF4500 },
        { name: 'pagoda', emoji: '🏯', desc: '宝塔', woodCost: 5, oreCost: 3, color: 0x8B0000 },
        { name: 'castle_tower', emoji: '🏰', desc: '城堡塔', woodCost: 3, oreCost: 5, color: 0x808080 },
        { name: 'archway', emoji: '🚪', desc: '拱门', woodCost: 2, oreCost: 3, color: 0xD2B48C },
        { name: 'obelisk', emoji: '🗼', desc: '方尖碑', woodCost: 0, oreCost: 5, color: 0xC0C0C0 },
        { name: 'clock_tower', emoji: '🕐', desc: '钟楼', woodCost: 3, oreCost: 4, color: 0x8B4513 }
    ];

    // Decoration zones for organized placement
    const DECOR_ZONES = [
        { x: -15, z: 25, name: 'pond', radius: 15 },      // Near pond
        { x: -35, z: 5, name: 'forest', radius: 10 },    // Near forest entrance
        { x: 10, z: -15, name: 'farm', radius: 12 },     // Near farm
        { x: 35, z: 15, name: 'office', radius: 10 },   // Near office
        { x: -10, z: -25, name: 'house', radius: 12 }    // Near house
    ];

    // Track placed decorations
    const placedDecorations = [];

    // Find best position for new decoration (organized placement)
    function findBestDecorPosition() {
        // Try each zone to find one with enough space
        const shuffledZones = [...DECOR_ZONES].sort(() => Math.random() - 0.5);

        for (const zone of shuffledZones) {
            // Try multiple positions within this zone
            const attempts = 8;
            for (let i = 0; i < attempts; i++) {
                const angle = (i / attempts) * Math.PI * 2;
                const dist = 3 + Math.random() * (zone.radius - 3);
                const x = zone.x + Math.cos(angle) * dist;
                const z = zone.z + Math.sin(angle) * dist;

                // Check distance from other decorations
                let tooClose = false;
                for (const decor of placedDecorations) {
                    const dx = decor.position.x - x;
                    const dz = decor.position.z - z;
                    if (Math.sqrt(dx * dx + dz * dz) < 4) {
                        tooClose = true;
                        break;
                    }
                }

                // Check distance from village
                const distToVillage = Math.sqrt(
                    Math.pow(x - LOCATIONS.village.x, 2) +
                    Math.pow(z - LOCATIONS.village.z, 2)
                );
                if (distToVillage < 10) {
                    continue;
                }

                // Check distance from rocket pad
                const distToRocket = Math.sqrt(
                    Math.pow(x - LOCATIONS.rocketPad.x, 2) +
                    Math.pow(z - LOCATIONS.rocketPad.z, 2)
                );
                if (distToRocket < 12) {
                    continue;
                }

                // Check distance from rail track (strip exclusion)
                if (Math.abs(x - RAIL_X) < 6) {
                    continue;
                }

                // Check distance from other special areas
                const distToHouse = Math.sqrt(Math.pow(x - LOCATIONS.house.x, 2) + Math.pow(z - LOCATIONS.house.z, 2));
                const distToFarm = Math.sqrt(Math.pow(x - LOCATIONS.farm.x, 2) + Math.pow(z - LOCATIONS.farm.z, 2));
                const distToPond = Math.sqrt(Math.pow(x - LOCATIONS.pond.x, 2) + Math.pow(z - LOCATIONS.pond.z, 2));
                const distToMine = Math.sqrt(Math.pow(x - LOCATIONS.mine.x, 2) + Math.pow(z - LOCATIONS.mine.z, 2));
                const distToForest = Math.sqrt(Math.pow(x - LOCATIONS.forest.x, 2) + Math.pow(z - LOCATIONS.forest.z, 2));
                const distToOffice = Math.sqrt(Math.pow(x - LOCATIONS.office.x, 2) + Math.pow(z - LOCATIONS.office.z, 2));

                if (distToHouse < 8 || distToFarm < 8 || distToPond < 8 || distToMine < 5 || distToForest < 8 || distToOffice < 6) {
                    continue;
                }

                if (!tooClose) {
                    return { x, z };
                }
            }
        }

        // Fallback: random position far from everything
        return {
            x: (Math.random() - 0.5) * 50,
            z: (Math.random() - 0.5) * 50
        };
    }

    // Tree types
    const TREE_TYPES = ['🌲', '🌳', '🌴', '🎄'];

    const EFFECT_TYPES = {
        HEART: { emoji: '❤️', duration: 2000 },
        CHAT: { emoji: '💬', duration: 3000 },
        ANGRY: { emoji: '😠', duration: 2500 },
        LAUGH: { emoji: '😂', duration: 2000 },
        STAR: { emoji: '⭐', duration: 1500 },
        THOUGHT: { emoji: '💭', duration: 2500 },
        DANCE: { emoji: '💃', duration: 1500 },
        WAVE: { emoji: '👋', duration: 1500 },
        FISHING: { emoji: '🎣', duration: 4000 },
        SLEEPING: { emoji: '😴', duration: 5000 },
        ZZZ: { emoji: '💤', duration: 3000 },
        CHOPPING: { emoji: '🪓', duration: 3000 },
        MINING: { emoji: '⛏️', duration: 3500 },
        DIGGING: { emoji: '🧱', duration: 2500 },
        WORKING: { emoji: '💻', duration: 5000 },
        TYPING: { emoji: '⌨️', duration: 3000 },
        IDEA: { emoji: '💡', duration: 2000 },
        BUILDING: { emoji: '🔨', duration: 4000 },
        CONSTRUCT: { emoji: '🏗️', duration: 3500 },
        HUNGRY: { emoji: '🍽️', duration: 3000 },
        EVIL: { emoji: '😈', duration: 2500 },
        THINK: { emoji: '🤔', duration: 2000 },
        SAD: { emoji: '😢', duration: 2000 },
        SPARKLE: { emoji: '✨', duration: 2000 },
        ROCKET_BUILD: { emoji: '🔧', duration: 4000 },
        COUNTDOWN: { emoji: '🔥', duration: 3000 },
        LAUNCH: { emoji: '🚀', duration: 2000 },
        FIREWORK: { emoji: '🎆', duration: 3000 }
    };

    function createEmojiSprite(emoji) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = '48px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.5, 1.5, 1);
        return sprite;
    }

    function showEffectOnAgent(agent, effectType, targetAgent = null) {
        // Don't show effect if agent is busy
        if (agent.userData.isBusy) return;

        const effect = EFFECT_TYPES[effectType];
        if (!effect) return;

        const sprite = createEmojiSprite(effect.emoji);
        sprite.position.set(0, 4.5, 0);
        agent.add(sprite);

        activeEffects.push({
            type: effectType,
            agent: agent,
            target: targetAgent,
            sprite: sprite,
            timer: effect.duration,
            startTime: Date.now()
        });
    }

    function dropItem(x, z, type, customEmoji = null) {
        let emoji, scale;
        if (customEmoji) {
            emoji = customEmoji;
            scale = 0.8;
        } else if (type === 'coin') {
            emoji = '💰';
            scale = 0.8;
        } else if (type === 'poop') {
            emoji = '💩';
            scale = 0.7;
        } else if (type === 'star') {
            emoji = '✨';
            scale = 0.6;
        } else if (type === 'fish') {
            emoji = FISH_TYPES[Math.floor(Math.random() * FISH_TYPES.length)];
            scale = 0.8;
        } else if (type === 'crop') {
            emoji = '🌱';
            scale = 0.6;
        } else {
            emoji = '🎁';
            scale = 0.8;
        }

        const sprite = createEmojiSprite(emoji);
        sprite.position.set(x, 0.5, z);
        sprite.scale.set(scale, scale, 1);
        scene.add(sprite);

        // Add slight float animation
        const startY = 0.5;
        const floatOffset = Math.random() * Math.PI * 2;

        // Different timer for different types
        let timer = 8000 + Math.random() * 4000;
        if (type === 'crop') timer = 15000 + Math.random() * 5000; // Crops last longer

        droppedItems.push({
            mesh: sprite,
            type: type,
            startX: x,
            startZ: z,
            startY: startY,
            floatOffset: floatOffset,
            timer: timer,
            startTime: Date.now()
        });
    }

    function triggerRandomEffect(agent) {
        const effectRand = Math.random();
        if (effectRand < 0.25) {
            showEffectOnAgent(agent, 'CHAT');
        } else if (effectRand < 0.5) {
            showEffectOnAgent(agent, 'LAUGH');
        } else if (effectRand < 0.7) {
            showEffectOnAgent(agent, 'ANGRY');
        } else if (effectRand < 0.85) {
            showEffectOnAgent(agent, 'THOUGHT');
        } else {
            showEffectOnAgent(agent, 'DANCE');
        }
    }

    // Handle fishing catch
    function catchFish(agent) {
        // Drop multiple fish scattered around
        const numFish = 1 + Math.floor(Math.random() * 2); // 1-2 fish
        for (let i = 0; i < numFish; i++) {
            const shoreX = agent.position.x + (Math.random() - 0.5) * 4;
            const shoreZ = agent.position.z + 1 + Math.random() * 2;
            dropItem(shoreX, shoreZ, 'fish');
        }

        // Reduce hunger when eating fish
        if (agent.userData) {
            agent.userData.hunger = Math.max(0, (agent.userData.hunger || 0) - 30);
        }

        // Show happy effect
        showEffectOnAgent(agent, 'LAUGH');
    }

    function updateFunAnimations(time) {
        const now = Date.now();

        // Update agent effects
        for (let i = activeEffects.length - 1; i >= 0; i--) {
            const effect = activeEffects[i];
            effect.timer -= 16;

            // Float animation
            if (effect.sprite) {
                effect.sprite.position.y = 4.5 + Math.sin(now * 0.005) * 0.2;
            }

            // For互动效果, move towards target
            if (effect.target && effect.agent && effect.agent.userData.effectTarget) {
                const dx = effect.target.position.x - effect.agent.position.x;
                const dz = effect.target.position.z - effect.agent.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > 0.5) {
                    effect.sprite.position.x += dx / dist * 0.05;
                    effect.sprite.position.z += dz / dist * 0.05;
                }
            }

            if (effect.timer <= 0) {
                effect.agent.remove(effect.sprite);
                effect.sprite.material.map.dispose();
                effect.sprite.material.dispose();
                activeEffects.splice(i, 1);
            }
        }

        // Update dropped items
        for (let i = droppedItems.length - 1; i >= 0; i--) {
            const item = droppedItems[i];
            item.timer -= 16;

            // Float animation
            item.mesh.position.y = item.startY + Math.sin(now * 0.003 + item.floatOffset) * 0.15;

            // Fade out near end
            if (item.timer < 1000) {
                item.mesh.material.opacity = item.timer / 1000;
            }

            if (item.timer <= 0) {
                scene.remove(item.mesh);
                item.mesh.material.map.dispose();
                item.mesh.material.dispose();
                droppedItems.splice(i, 1);
            }
        }

        // Animate decorations
        placedDecorations.forEach(dec => {
            if (dec.userData.animate === 'windmill' && dec.userData.blades) {
                dec.userData.blades.rotation.z += 0.02;
            }
            if (dec.userData.animate === 'lighthouse' && dec.userData.beam) {
                dec.userData.beam.rotation.y += 0.03;
            }
            if (dec.userData.animate === 'ferris_wheel' && dec.userData.wheel) {
                dec.userData.wheel.rotation.z += 0.005;
                dec.userData.wheel.children.forEach(child => {
                    if (child.userData.isSeat) child.rotation.z = -dec.userData.wheel.rotation.z;
                });
            }
            if (dec.userData.animate === 'carousel' && dec.userData.spinGroup) {
                dec.userData.spinGroup.rotation.y += 0.015;
            }
            if (dec.userData.animate === 'balloon') {
                const baseY = dec.userData.baseY || 0;
                dec.position.y = baseY + Math.sin(now * 0.001 + dec.position.x) * 0.3;
            }
        });

        // Randomly trigger effects on agents (every ~3-5 seconds per agent)
        agents.forEach(agent => {
            if (agent.userData.isBusy) return;

            // Update hunger (increases over time, slower)
            agent.userData.hunger = (agent.userData.hunger || 0) + 0.008;

            // If very hungry, show hungry effect
            if (agent.userData.hunger > 65 && agent.userData.hunger < 70) {
                showEffectOnAgent(agent, 'HUNGRY');
            }

            // If hungry, force food-related activity (higher threshold)
            if (agent.userData.hunger > 75 && !agent.userData.specialActivity) {
                const foodRand = Math.random();
                if (foodRand < 0.6) {
                    // Go fishing
                    agent.userData.specialActivity = {
                        x: LOCATIONS.pond.x + (Math.random() - 0.5) * 10,
                        z: LOCATIONS.pond.z + (Math.random() - 0.5) * 10,
                        type: 'fishing',
                        duration: 5000
                    };
                } else {
                    // Go farming
                    agent.userData.specialActivity = {
                        x: LOCATIONS.farm.x + (Math.random() - 0.5) * 10,
                        z: LOCATIONS.farm.z + (Math.random() - 0.5) * 10,
                        type: 'farming',
                        duration: 3000
                    };
                }
                agent.userData.targetX = agent.userData.specialActivity.x;
                agent.userData.targetZ = agent.userData.specialActivity.z;
                agent.userData.isMoving = true;
                return;
            }

            // Check if agent is doing a special activity (moving to location)
            if (agent.userData.specialActivity) {
                // Move towards target location
                const target = agent.userData.specialActivity;
                const dx = target.x - agent.position.x;
                const dz = target.z - agent.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist > 0.5) {
                    agent.position.x += (dx / dist) * 0.03;
                    agent.position.z += (dz / dist) * 0.03;
                } else {
                    // Arrived at location, start the activity
                    if (target.type === 'fishing') {
                        showEffectOnAgent(agent, 'FISHING');
                        // Catch fish after fishing
                        setTimeout(() => {
                            if (agent.parent) {
                                catchFish(agent);
                            }
                        }, 2000);
                    } else if (target.type === 'farming') {
                        // Find empty plot to plant
                        const emptyPlot = farmPlots.find(p => p.userData.state === 'empty');
                        if (emptyPlot) {
                            plantCrop(emptyPlot);
                            showEffectOnAgent(agent, 'THOUGHT');
                        } else {
                            // No empty plots, just show thought
                            showEffectOnAgent(agent, 'THOUGHT');
                        }
                    } else if (target.type === 'watering') {
                        // Find planted plot to water
                        const wateredPlot = farmPlots.find(p => p.userData.state === 'planted' || p.userData.state === 'growing');
                        if (wateredPlot) {
                            waterCrop(wateredPlot);
                            showEffectOnAgent(agent, 'CHAT');
                        } else {
                            showEffectOnAgent(agent, 'THOUGHT');
                        }
                    } else if (target.type === 'harvesting') {
                        // Find ready plot to harvest
                        const readyPlot = farmPlots.find(p => p.userData.state === 'ready');
                        if (readyPlot) {
                            harvestCrop(readyPlot);
                            // Reduce hunger when eating crops
                            agent.userData.hunger = Math.max(0, (agent.userData.hunger || 0) - 25);
                            showEffectOnAgent(agent, 'LAUGH');
                        } else {
                            // Nothing to harvest, just show chat
                            showEffectOnAgent(agent, 'CHAT');
                        }
                    } else if (target.type === 'sleeping') {
                        showEffectOnAgent(agent, 'SLEEPING');
                        // Add ZZZ after a delay
                        setTimeout(() => {
                            if (agent.parent) showEffectOnAgent(agent, 'ZZZ');
                        }, 2000);
                    } else if (target.type === 'fireworks') {
                        // Launch fireworks!
                        showEffectOnAgent(agent, 'FIREWORK');
                        const agentX = agent.position.x;
                        const agentZ = agent.position.z;

                        // Launch 2-5 fireworks with staggered timing
                        const count = 2 + Math.floor(Math.random() * 4);
                        for (let fw = 0; fw < count; fw++) {
                            setTimeout(() => {
                                launchFirework(
                                    agentX + (Math.random() - 0.5) * 8,
                                    agentZ + (Math.random() - 0.5) * 8
                                );
                            }, fw * 600 + Math.random() * 400);
                        }

                    } else if (target.type === 'decorating') {
                        // Create fun decorations!
                        showEffectOnAgent(agent, 'IDEA');

                        // First need enough resources
                        const woodAvailable = woodInventory;
                        const oreAvailable = oreInventory;

                        // Pick a random decoration type
                        const decorType = CREATIVE_TYPES[Math.floor(Math.random() * CREATIVE_TYPES.length)];
                        const neededWood = decorType.woodCost;
                        const neededOre = decorType.oreCost;

                        if (woodAvailable >= neededWood && oreAvailable >= neededOre) {
                            // Have enough! Build it
                            woodInventory -= neededWood;
                            oreInventory -= neededOre;

                            setTimeout(() => {
                                if (agent.parent) showEffectOnAgent(agent, 'CONSTRUCT');
                            }, 1000);

                            setTimeout(() => {
                                // Use organized placement
                                const bestPos = findBestDecorPosition();
                                createDecoration(decorType.name, bestPos.x, bestPos.z);
                            }, 2500);
                        } else {
                            // Not enough - go gather!
                            setTimeout(() => {
                                if (agent.parent) showEffectOnAgent(agent, 'SAD');
                            }, 1000);

                            setTimeout(() => {
                                if (agent.userData.specialActivity) {
                                    // Decide what to gather based on what we need
                                    const needWood = neededWood > woodAvailable;
                                    const needOre = neededOre > oreAvailable;

                                    let gatherType = 'chopping';
                                    let targetLoc = LOCATIONS.forest;

                                    if (needOre && (!needWood || oreAvailable < oreInventory)) {
                                        gatherType = 'mining';
                                        targetLoc = LOCATIONS.mine;
                                    }

                                    agent.userData.specialActivity = {
                                        x: targetLoc.x + (Math.random() - 0.5) * 10,
                                        z: targetLoc.z + (Math.random() - 0.5) * 10,
                                        type: gatherType,
                                        duration: 4000
                                    };
                                    agent.userData.targetX = agent.userData.specialActivity.x;
                                    agent.userData.targetZ = agent.userData.specialActivity.z;
                                    agent.userData.lastGatheredResource = gatherType === 'chopping' ? 'wood' : 'ore';
                                }
                            }, 2000);
                        }
                    } else if (target.type === 'mischief') {
                        // Mischief! Look for decorations to destroy
                        showEffectOnAgent(agent, 'EVIL');

                        if (placedDecorations.length > 0) {
                            // Find a decoration to destroy
                            const targetDecor = placedDecorations[Math.floor(Math.random() * placedDecorations.length)];

                            setTimeout(() => {
                                if (agent.parent) showEffectOnAgent(agent, 'LAUGH');
                            }, 1000);

                            setTimeout(() => {
                                if (targetDecor && targetDecor.parent) {
                                    // Show explosion effect before removing
                                    dropItem(targetDecor.position.x, targetDecor.position.z, 'ore', '💥');
                                    removeDecoration(targetDecor);
                                }
                            }, 2000);
                        } else {
                            // No decorations to destroy - just look around suspiciously
                            setTimeout(() => {
                                if (agent.parent) showEffectOnAgent(agent, 'THINK');
                            }, 1000);
                        }
                    } else if (target.type === 'chopping') {
                        // Find a tree to chop (only if enough trees left)
                        showEffectOnAgent(agent, 'CHOPPING');
                        // Track resource type for building
                        agent.userData.lastGatheredResource = 'wood';
                        if (choppableTrees.length > 5) {
                            const tree = choppableTrees[Math.floor(Math.random() * choppableTrees.length)];
                            if (tree) {
                                chopTree(tree);
                            }
                        }
                    } else if (target.type === 'mining') {
                        // Find a mining spot
                        showEffectOnAgent(agent, 'MINING');
                        // Track resource type for building
                        agent.userData.lastGatheredResource = 'ore';
                        const availableSpots = miningSpots.filter(s => !s.userData.mined);
                        if (availableSpots.length > 0) {
                            const spot = availableSpots[Math.floor(Math.random() * availableSpots.length)];
                            if (spot) {
                                mineOre(spot);
                            }
                        }
                    } else if (target.type === 'working') {
                        // Working at office
                        showEffectOnAgent(agent, 'WORKING');
                        // Show typing effect after a delay
                        setTimeout(() => {
                            if (agent.parent && agent.userData.specialActivity) {
                                showEffectOnAgent(agent, 'TYPING');
                            }
                        }, 2000);
                        // Drop document/note occasionally
                        setTimeout(() => {
                            if (agent.parent) {
                                dropDocument(
                                    agent.position.x + (Math.random() - 0.5) * 2,
                                    agent.position.z + (Math.random() - 0.5) * 2
                                );
                            }
                        }, 3500);
                        // Show idea when done
                        setTimeout(() => {
                            if (agent.parent && agent.userData.specialActivity) {
                                showEffectOnAgent(agent, 'IDEA');
                            }
                        }, 4500);
                    } else if (target.type === 'building') {
                        // Building a house in village - must have enough resources first

                        // Check what resource we have
                        let buildingType = agent.userData.lastGatheredResource || 'wood';
                        let hasEnough = false;

                        // Check if we have enough of the last gathered resource
                        if (buildingType === 'wood' && woodInventory >= WOOD_NEEDED_PER_HOUSE) {
                            hasEnough = true;
                        } else if (buildingType === 'ore' && oreInventory >= ORE_NEEDED_PER_HOUSE) {
                            hasEnough = true;
                        }

                        // If not enough, try the other resource
                        if (!hasEnough) {
                            if (woodInventory >= WOOD_NEEDED_PER_HOUSE) {
                                buildingType = 'wood';
                                hasEnough = true;
                            } else if (oreInventory >= ORE_NEEDED_PER_HOUSE) {
                                buildingType = 'ore';
                                hasEnough = true;
                            }
                        }

                        if (!hasEnough) {
                            // Not enough resources - redirect to gather first
                            setTimeout(() => {
                                if (agent.parent) showEffectOnAgent(agent, 'SAD');
                            }, 500);
                            // Go gather resources instead of building
                            setTimeout(() => {
                                if (agent.userData.specialActivity) {
                                    const preferWood = woodInventory > 0;
                                    agent.userData.specialActivity = {
                                        x: preferWood ? LOCATIONS.forest.x + (Math.random() - 0.5) * 10 : LOCATIONS.mine.x + (Math.random() - 0.5) * 8,
                                        z: preferWood ? LOCATIONS.forest.z + (Math.random() - 0.5) * 10 : LOCATIONS.mine.z + (Math.random() - 0.5) * 8,
                                        type: preferWood ? 'chopping' : 'mining',
                                        duration: 4000
                                    };
                                    agent.userData.targetX = agent.userData.specialActivity.x;
                                    agent.userData.targetZ = agent.userData.specialActivity.z;
                                    // Remember what we're gathering
                                    agent.userData.lastGatheredResource = preferWood ? 'wood' : 'ore';
                                }
                            }, 1500);
                        } else if ((Date.now() - lastGlobalBuildTime) < GLOBAL_BUILD_COOLDOWN) {
                            // Global cooldown active - someone just built, wait
                            setTimeout(() => {
                                if (agent.parent) showEffectOnAgent(agent, 'THINK');
                            }, 500);
                        } else {
                            // Have enough resources, build ONE floor only!
                            showEffectOnAgent(agent, 'BUILDING');

                            // Collect empty plots and plots with existing buildings (respect cooldown)
                            const now = Date.now();
                            const emptyPlots = scene.children.filter(obj =>
                                obj.userData && obj.userData.type === 'villagePlot' && !obj.userData.currentFloor
                            );
                            const builtPlots = scene.children.filter(obj =>
                                obj.userData && obj.userData.type === 'villagePlot'
                                && obj.userData.currentFloor && obj.userData.currentFloor < MAX_FLOORS
                                && (!obj.userData.lastBuildTime || (now - obj.userData.lastBuildTime) >= BUILD_COOLDOWN)
                            );

                            let buildPlot = null;

                            // Randomly decide: build on empty plot or add floor to existing
                            if (emptyPlots.length > 0 && builtPlots.length > 0) {
                                // 60% chance to pick empty plot, 40% to add floor
                                if (Math.random() < 0.6) {
                                    buildPlot = emptyPlots[Math.floor(Math.random() * emptyPlots.length)];
                                } else {
                                    buildPlot = builtPlots[Math.floor(Math.random() * builtPlots.length)];
                                    buildingType = buildPlot.userData.buildingType || buildingType;
                                }
                            } else if (emptyPlots.length > 0) {
                                buildPlot = emptyPlots[Math.floor(Math.random() * emptyPlots.length)];
                            } else if (builtPlots.length > 0) {
                                buildPlot = builtPlots[Math.floor(Math.random() * builtPlots.length)];
                                buildingType = buildPlot.userData.buildingType || buildingType;
                            }

                            if (buildPlot) {
                                const currentBuildingType = buildingType;

                                setTimeout(() => {
                                    if (agent.parent) showEffectOnAgent(agent, 'CONSTRUCT');
                                }, 1500);
                                setTimeout(() => {
                                    // Build exactly ONE floor (buildHouse checks cooldown & max)
                                    buildHouse(buildPlot, currentBuildingType);
                                }, 3000);
                            } else {
                                // No plots available
                                setTimeout(() => {
                                    if (agent.parent) showEffectOnAgent(agent, 'IDEA');
                                }, 1000);
                            }
                        }
                    } else if (target.type === 'rocket_building') {
                        // Building a rocket stage!
                        if (rocketState.currentStage >= ROCKET_STAGES || rocketState.isLaunching) {
                            showEffectOnAgent(agent, 'STAR');
                        } else {
                            showEffectOnAgent(agent, 'ROCKET_BUILD');
                            const idx = rocketState.currentStage;
                            const wNeed = ROCKET_WOOD_PER_STAGE[idx], oNeed = ROCKET_ORE_PER_STAGE[idx];
                            if (woodInventory >= wNeed && oreInventory >= oNeed) {
                                setTimeout(() => {
                                    if (agent.parent) showEffectOnAgent(agent, 'CONSTRUCT');
                                }, 1500);
                                setTimeout(() => {
                                    const success = buildRocketStage();
                                    if (success && rocketState.currentStage >= ROCKET_STAGES) {
                                        showEffectOnAgent(agent, 'LAUNCH');
                                    }
                                }, 3000);
                            } else {
                                setTimeout(() => {
                                    if (agent.parent) showEffectOnAgent(agent, 'SAD');
                                }, 500);
                                setTimeout(() => {
                                    if (agent.userData.specialActivity) {
                                        const needWood = woodInventory < wNeed;
                                        agent.userData.specialActivity = {
                                            x: needWood ? LOCATIONS.forest.x + (Math.random()-0.5)*10 : LOCATIONS.mine.x + (Math.random()-0.5)*8,
                                            z: needWood ? LOCATIONS.forest.z + (Math.random()-0.5)*10 : LOCATIONS.mine.z + (Math.random()-0.5)*8,
                                            type: needWood ? 'chopping' : 'mining',
                                            duration: 4000
                                        };
                                        agent.userData.targetX = agent.userData.specialActivity.x;
                                        agent.userData.targetZ = agent.userData.specialActivity.z;
                                    }
                                }, 1500);
                            }
                        }
                    }

                    // Clear activity after normal duration (building will handle its own continuation)
                    setTimeout(() => {
                        agent.userData.specialActivity = null;
                        agent.userData.moveTimer = 0;
                    }, target.duration || 3000);
                }
                return; // Skip normal effects while doing special activity
            }

            // Outfit change timer (30-90s intervals)
            agent.userData.outfitTimer = (agent.userData.outfitTimer || 0) - 16;
            if (agent.userData.outfitTimer <= 0) {
                changeOutfit(agent);
                showEffectOnAgent(agent, 'SPARKLE');
                agent.userData.outfitTimer = 30000 + Math.random() * 60000;
            }

            agent.userData.effectTimer = (agent.userData.effectTimer || 0) - 16;

            if (agent.userData.effectTimer <= 0) {
                // Reset timer
                agent.userData.effectTimer = 3000 + Math.random() * 5000;

                const rand = Math.random();

                // 35% chance for special activities
                if (rand < 0.35) {
                    const activityRand = Math.random();

                    if (activityRand < 0.08) {
                        // Go fishing at pond (8%)
                        const pondPos = {
                            x: LOCATIONS.pond.x + (Math.random() - 0.5) * 10,
                            z: LOCATIONS.pond.z + (Math.random() - 0.5) * 10,
                            type: 'fishing',
                            duration: 5000
                        };
                        agent.userData.specialActivity = pondPos;
                        agent.userData.targetX = pondPos.x;
                        agent.userData.targetZ = pondPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.14) {
                        // Go farming (6%)
                        const farmPos = {
                            x: LOCATIONS.farm.x + (Math.random() - 0.5) * 10,
                            z: LOCATIONS.farm.z + (Math.random() - 0.5) * 10,
                            type: 'farming',
                            duration: 3000
                        };
                        agent.userData.specialActivity = farmPos;
                        agent.userData.targetX = farmPos.x;
                        agent.userData.targetZ = farmPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.28) {
                        // Go chopping trees (14% - main resource)
                        const treePos = {
                            x: LOCATIONS.forest.x + (Math.random() - 0.5) * 10,
                            z: LOCATIONS.forest.z + (Math.random() - 0.5) * 10,
                            type: 'chopping',
                            duration: 3500
                        };
                        agent.userData.specialActivity = treePos;
                        agent.userData.targetX = treePos.x;
                        agent.userData.targetZ = treePos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.42) {
                        // Go mining (14% - main resource)
                        const minePos = {
                            x: LOCATIONS.mine.x + (Math.random() - 0.5) * 8,
                            z: LOCATIONS.mine.z + (Math.random() - 0.5) * 8,
                            type: 'mining',
                            duration: 4000
                        };
                        agent.userData.specialActivity = minePos;
                        agent.userData.targetX = minePos.x;
                        agent.userData.targetZ = minePos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.54) {
                        // Go building house in village (12%)
                        const villagePos = {
                            x: LOCATIONS.village.x + (Math.random() - 0.5) * 15,
                            z: LOCATIONS.village.z + (Math.random() - 0.5) * 10,
                            type: 'building',
                            duration: 5000
                        };
                        agent.userData.specialActivity = villagePos;
                        agent.userData.targetX = villagePos.x;
                        agent.userData.targetZ = villagePos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.59) {
                        // Go watering (5%)
                        const waterPos = {
                            x: LOCATIONS.farm.x + (Math.random() - 0.5) * 10,
                            z: LOCATIONS.farm.z + (Math.random() - 0.5) * 10,
                            type: 'watering',
                            duration: 2500
                        };
                        agent.userData.specialActivity = waterPos;
                        agent.userData.targetX = waterPos.x;
                        agent.userData.targetZ = waterPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.63) {
                        // Go harvesting (4%)
                        const harvestPos = {
                            x: LOCATIONS.farm.x + (Math.random() - 0.5) * 10,
                            z: LOCATIONS.farm.z + (Math.random() - 0.5) * 10,
                            type: 'harvesting',
                            duration: 4000
                        };
                        agent.userData.specialActivity = harvestPos;
                        agent.userData.targetX = harvestPos.x;
                        agent.userData.targetZ = harvestPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.66) {
                        // Go to office to work (3%)
                        const officePos = {
                            x: LOCATIONS.office.x + (Math.random() - 0.5) * 6,
                            z: LOCATIONS.office.z + (Math.random() - 0.5) * 4,
                            type: 'working',
                            duration: 6000
                        };
                        agent.userData.specialActivity = officePos;
                        agent.userData.targetX = officePos.x;
                        agent.userData.targetZ = officePos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.70) {
                        // Go sleep (4%)
                        const sleepPos = {
                            x: LOCATIONS.house.x + (Math.random() - 0.5) * 4,
                            z: LOCATIONS.house.z + (Math.random() - 0.5) * 4,
                            type: 'sleeping',
                            duration: 6000
                        };
                        agent.userData.specialActivity = sleepPos;
                        agent.userData.targetX = sleepPos.x;
                        agent.userData.targetZ = sleepPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.80) {
                        // Rocket building! Go to launch pad (10%)
                        const rocketPos = {
                            x: LOCATIONS.rocketPad.x + (Math.random() - 0.5) * 6,
                            z: LOCATIONS.rocketPad.z + (Math.random() - 0.5) * 6,
                            type: 'rocket_building',
                            duration: 6000
                        };
                        agent.userData.specialActivity = rocketPos;
                        agent.userData.targetX = rocketPos.x;
                        agent.userData.targetZ = rocketPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.90) {
                        // Launch fireworks! (10%)
                        const fwX = (Math.random() - 0.5) * 50;
                        const fwZ = (Math.random() - 0.5) * 50;
                        const fireworkPos = {
                            x: fwX,
                            z: fwZ,
                            type: 'fireworks',
                            duration: 5000
                        };
                        agent.userData.specialActivity = fireworkPos;
                        agent.userData.targetX = fireworkPos.x;
                        agent.userData.targetZ = fireworkPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.94) {
                        // Create decorations (4%)
                        const bestPos = findBestDecorPosition();
                        const decorPos = {
                            x: bestPos.x,
                            z: bestPos.z,
                            type: 'decorating',
                            duration: 4000
                        };
                        agent.userData.specialActivity = decorPos;
                        agent.userData.targetX = decorPos.x;
                        agent.userData.targetZ = decorPos.z;
                        agent.userData.isMoving = true;
                    } else if (activityRand < 0.97) {
                        // Mischief! Go destroy decorations (3%)
                        const mischiefPos = {
                            x: (Math.random() - 0.5) * 60,
                            z: (Math.random() - 0.5) * 60,
                            type: 'mischief',
                            duration: 3500
                        };
                        agent.userData.specialActivity = mischiefPos;
                        agent.userData.targetX = mischiefPos.x;
                        agent.userData.targetZ = mischiefPos.z;
                        agent.userData.isMoving = true;
                    } else {
                        triggerRandomEffect(agent);
                    }
                } else if (rand < 0.45) {
                    // Find nearby agents for互动
                    const nearbyAgents = agents.filter(a => {
                        if (a === agent) return false;
                        const dx = a.position.x - agent.position.x;
                        const dz = a.position.z - agent.position.z;
                        return Math.sqrt(dx * dx + dz * dz) < 15;
                    });

                    const effectRand = Math.random();

                    if (nearbyAgents.length > 0 && effectRand < 0.5) {
                        // 互动 with nearby agent
                        const target = nearbyAgents[Math.floor(Math.random() * nearbyAgents.length)];

                        if (effectRand < 0.2) {
                            showEffectOnAgent(agent, 'HEART', target);
                            showEffectOnAgent(target, 'HEART', agent);
                        } else if (effectRand < 0.4) {
                            showEffectOnAgent(agent, 'CHAT', target);
                        } else {
                            showEffectOnAgent(agent, 'WAVE', target);
                        }
                    } else {
                        triggerRandomEffect(agent);
                    }
                }
            }
        });

        // Randomly drop items (very rare)
        if (Math.random() < 0.0002) {
            const x = (Math.random() - 0.5) * 80;
            const z = (Math.random() - 0.5) * 80;
            // Avoid dropping in house or pond
            const inHouse = x > -12 && x < 2 && z > -28 && z < -12;
            const inPond = Math.sqrt((x - 20) ** 2 + (z + 15) ** 2) < 15;
            if (!inHouse && !inPond) {
                const itemType = Math.random() < 0.7 ? 'coin' : (Math.random() < 0.5 ? 'star' : 'gift');
                dropItem(x, z, itemType);
            }
        }
    }

    function createAvatarCanvas(data) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Circle background
        ctx.beginPath();
        ctx.arc(64, 64, 60, 0, Math.PI * 2);
        ctx.fillStyle = data.avatarUrl ? '#ffffff' : getColorForName(data.displayName || data.name);
        ctx.fill();

        // Avatar or initial
        if (data.avatarUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                ctx.save();
                ctx.beginPath();
                ctx.arc(64, 64, 55, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                // Crop to center 1:1 square (no stretching)
                const w = img.naturalWidth, h = img.naturalHeight;
                const side = Math.min(w, h);
                const sx = (w - side) / 2, sy = (h - side) / 2;
                ctx.drawImage(img, sx, sy, side, side, 9, 9, 110, 110);
                ctx.restore();
                // Update texture after image loads
                if (data._texture) {
                    data._texture.needsUpdate = true;
                }
            };
            img.src = data.avatarUrl;
        } else {
            // Initial
            const initial = (data.displayName || data.name || '?').charAt(0).toUpperCase();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 60px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(initial, 64, 68);
        }

        const texture = new THREE.CanvasTexture(canvas);
        data._texture = texture; // Store for updates
        return { canvas, texture };
    }

    function createNameCanvas(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Text shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(name, 129, 33);

        // Main text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(name, 128, 32);

        return canvas;
    }

    function getColorForName(name) {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    function onClick(event) {
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        // Check all agents
        const intersects = raycaster.intersectObjects(scene.children, true);

        for (const intersect of intersects) {
            let obj = intersect.object;
            // Find parent group
            while (obj.parent && !obj.userData.isAgent) {
                obj = obj.parent;
            }

            if (obj.userData && obj.userData.isAgent) {
                openChat(obj.userData.agentId, obj.userData.displayName, obj.userData.emoji, obj.userData.avatarUrl);
                return;
            }
        }
    }

    // ========== Chat System ==========

    // Store all conversations for persistence
    const conversations = {}; // agentId -> [{ role: 'user'|'assistant', content: '...' }]

    // Track chat window z-index for bring-to-top
    let chatZIndex = 10000;

    function openChat(agentId, displayName, emoji, avatarUrl) {
        // If chat already open, bring it to top
        if (openChats[agentId]) {
            chatZIndex++;
            openChats[agentId].element.style.zIndex = chatZIndex;
            openChats[agentId].element.focus();
            return;
        }

        // Initialize conversation if not exists
        if (!conversations[agentId]) {
            conversations[agentId] = [];
        }

        // Center position with slight random offset to avoid exact overlap
        const randomOffsetX = (Math.random() - 0.5) * 40; // -20 to +20 pixels
        const randomOffsetY = (Math.random() - 0.5) * 30; // -15 to +15 pixels
        const centerX = (window.innerWidth - 320) / 2 + randomOffsetX;
        const centerY = (window.innerHeight - 400) / 2 + randomOffsetY;

        // Assign z-index
        chatZIndex++;

        // Create chat window
        const chatEl = document.createElement('div');
        chatEl.className = 'chat-window';
        chatEl.style.cssText = `
            position: fixed;
            left: ${centerX}px;
            top: ${centerY}px;
            width: 320px;
            height: 450px;
            background: rgba(20, 20, 25, 0.98);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.15);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            z-index: ${chatZIndex};
            pointer-events: auto;
        `;

        // Avatar for header
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`
            : `<span style="font-size: 24px;">${emoji}</span>`;

        // Header (draggable)
        chatEl.innerHTML = `
            <div class="chat-header" style="
                padding: 12px 16px;
                background: rgba(255,255,255,0.08);
                border-bottom: 1px solid rgba(255,255,255,0.1);
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: move;
                user-select: none;
            ">
                ${avatarHtml}
                <span style="font-weight: 600; flex: 1; color: white;">${displayName}</span>
                <button class="chat-close" style="
                    background: none;
                    border: none;
                    color: #888;
                    cursor: pointer;
                    font-size: 20px;
                    padding: 4px;
                ">&times;</button>
            </div>
            <div class="chat-messages" style="
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            "></div>
            <div class="chat-input-area" style="
                padding: 12px;
                border-top: 1px solid rgba(255,255,255,0.1);
                display: flex;
                gap: 8px;
            ">
                <input type="text" class="chat-input" placeholder="发送消息..." style="
                    flex: 1;
                    padding: 10px 14px;
                    border-radius: 20px;
                    border: 1px solid rgba(255,255,255,0.2);
                    background: rgba(255,255,255,0.08);
                    color: white;
                    outline: none;
                    font-size: 14px;
                ">
                <button class="chat-send" style="
                    padding: 10px 16px;
                    border-radius: 20px;
                    border: none;
                    background: #6366f1;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                ">发送</button>
            </div>
        `;

        // Add to body instead of uiLayer to avoid pointer-events issues
        document.body.appendChild(chatEl);

        // Click anywhere on chat window brings it to top
        chatEl.addEventListener('click', () => {
            chatZIndex++;
            chatEl.style.zIndex = chatZIndex;
        });

        // Make chat window draggable
        const header = chatEl.querySelector('.chat-header');
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('chat-close')) return;
            isDragging = true;
            dragOffsetX = e.clientX - chatEl.offsetLeft;
            dragOffsetY = e.clientY - chatEl.offsetTop;
            chatEl.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            chatEl.style.left = (e.clientX - dragOffsetX) + 'px';
            chatEl.style.top = (e.clientY - dragOffsetY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                chatEl.style.transition = '';
            }
        });

        // Store chat reference
        openChats[agentId] = {
            element: chatEl,
            messagesEl: chatEl.querySelector('.chat-messages'),
            inputEl: chatEl.querySelector('.chat-input'),
            sendBtn: chatEl.querySelector('.chat-send'),
            closeBtn: chatEl.querySelector('.chat-close'),
            isLoading: false
        };

        const chat = openChats[agentId];

        // Send message handler
        const sendMsg = () => {
            const text = chat.inputEl.value.trim();
            if (!text || chat.isLoading) return;

            // Add user message
            addMessage(agentId, 'user', text);
            chat.inputEl.value = '';

            // Show loading
            showLoading(agentId);

            // Send to agent (concurrent-safe)
            sendToAgent(agentId, text);
        };

        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            chat.sendBtn.addEventListener('click', sendMsg);
            chat.inputEl.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendMsg();
            });

            chat.closeBtn.addEventListener('click', () => {
                closeChat(agentId);
            });

            // Drag and drop image support
            const chatArea = chatEl;
            chatArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                chatArea.style.borderColor = '#8957e5';
                chatArea.style.borderWidth = '3px';
            });
            chatArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                chatArea.style.borderColor = '';
                chatArea.style.borderWidth = '';
            });
            chatArea.addEventListener('drop', async (e) => {
                e.preventDefault();
                chatArea.style.borderColor = '';
                chatArea.style.borderWidth = '';

                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    const file = files[0];
                    if (file.type.startsWith('image/')) {
                        // Read and display image
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const imgData = event.target.result;
                            // Add image message
                            addImageMessage(agentId, 'user', imgData);
                            // Send to agent with image
                            sendImageToAgent(agentId, imgData, file.name);
                        };
                        reader.readAsDataURL(file);
                    }
                }
            });

            // Load conversation history
            if (conversations[agentId] && conversations[agentId].length > 0) {
                conversations[agentId].forEach(msg => {
                    addMessage(agentId, msg.role, msg.content);
                });
            }

            // Auto-focus input
            chat.inputEl.focus();
        }, 100);
    }

    function closeChat(agentId) {
        const chat = openChats[agentId];
        if (chat && chat.element) {
            chat.element.remove();
            delete openChats[agentId];
        }
        // Mark agent as not busy
        setAgentBusy(agentId, false);
    }

    // Set agent busy state on map
    function setAgentBusy(agentId, isBusy) {
        const agent = agents.find(a => a.userData.agentId === agentId);
        if (agent) {
            agent.userData.isBusy = isBusy;
            // Update visual - add/remove busy indicator
            updateAgentBusyVisual(agent, isBusy);
        }
    }

    function updateAgentBusyVisual(agent, isBusy) {
        // Remove existing busy indicator
        const existing = agent.children.find(c => c.userData.isBusyIndicator);
        if (existing) {
            agent.remove(existing);
        }

        if (isBusy) {
            // Add spinning indicator
            const ringGeo = new THREE.RingGeometry(1.2, 1.4, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0xffaa00,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.y = 3.5;
            ring.userData.isBusyIndicator = true;
            ring.userData.spinning = true;
            agent.add(ring);
        }
    }

    function addMessage(agentId, role, content) {
        const chat = openChats[agentId];
        if (!chat) return;

        // Store in conversation history
        if (!conversations[agentId]) {
            conversations[agentId] = [];
        }
        conversations[agentId].push({ role, content });

        const msgEl = document.createElement('div');
        msgEl.style.cssText = `
            max-width: 85%;
            padding: 10px 14px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.4;
            word-break: break-word;
        `;

        if (role === 'user') {
            msgEl.style.cssText += `
                align-self: flex-end;
                background: #6366f1;
                color: white;
                border-bottom-right-radius: 4px;
            `;
        } else if (role === 'loading') {
            msgEl.style.cssText += `
                align-self: flex-start;
                background: rgba(255,255,255,0.1);
                color: #aaa;
                border-bottom-left-radius: 4px;
            `;
            msgEl.innerHTML = '<span class="loading-dots">思考中<span>.</span><span>.</span><span>.</span></span>';
        } else {
            msgEl.style.cssText += `
                align-self: flex-start;
                background: rgba(255,255,255,0.1);
                color: #e0e0e0;
                border-bottom-left-radius: 4px;
            `;
        }

        msgEl.textContent = content;
        chat.messagesEl.appendChild(msgEl);
        chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
    }

    // Add image message to chat
    function addImageMessage(agentId, role, imageData) {
        const chat = openChats[agentId];
        if (!chat) return;

        // Store in conversation history (just store a reference)
        if (!conversations[agentId]) {
            conversations[agentId] = [];
        }
        conversations[agentId].push({ role, content: '[图片]', isImage: true, imageData });

        const msgEl = document.createElement('div');
        msgEl.style.cssText = `
            max-width: 85%;
            padding: 8px;
            border-radius: 18px;
            ${role === 'user' ? 'align-self: flex-end; background: #6366f1; border-bottom-right-radius: 4px;' : 'align-self: flex-start; background: #2d2d2d; border-bottom-left-radius: 4px;'}
        `;

        const img = document.createElement('img');
        img.src = imageData;
        img.style.cssText = 'max-width: 200px; max-height: 200px; border-radius: 12px; display: block;';
        msgEl.appendChild(img);

        chat.messagesEl.appendChild(msgEl);
        chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
    }

    // Send image to agent
    async function sendImageToAgent(agentId, imageData, fileName) {
        const chat = openChats[agentId];
        if (!chat) return;

        // Show loading
        showLoading(agentId);

        try {
            const response = await fetch(`/api/agents/${agentId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: '[用户发送了一张图片]',
                    image: imageData
                })
            });

            if (!response.ok) throw new Error('发送失败');

            const data = await response.json();
            hideLoading(agentId);

            if (data.response) {
                addMessage(agentId, 'assistant', data.response);
            }
        } catch (e) {
            hideLoading(agentId);
            addMessage(agentId, 'error', '发送失败: ' + e.message);
        }
    }

    function showLoading(agentId) {
        const chat = openChats[agentId];
        if (!chat) return;

        chat.isLoading = true;
        chat.sendBtn.disabled = true;
        chat.sendBtn.style.opacity = '0.5';

        const loadingEl = document.createElement('div');
        loadingEl.className = 'message loading';
        loadingEl.style.cssText = `
            align-self: flex-start;
            background: rgba(255,255,255,0.1);
            color: #aaa;
            border-bottom-left-radius: 4px;
            padding: 10px 14px;
            border-radius: 18px;
            max-width: 85%;
        `;
        loadingEl.innerHTML = '<span class="loading-dots">思考中<span>.</span><span>.</span><span>.</span></span>';

        chat.loadingEl = loadingEl;
        chat.messagesEl.appendChild(loadingEl);
        chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
    }

    function hideLoading(agentId) {
        const chat = openChats[agentId];
        if (!chat) return;

        chat.isLoading = false;
        chat.sendBtn.disabled = false;
        chat.sendBtn.style.opacity = '1';

        if (chat.loadingEl) {
            chat.loadingEl.remove();
            chat.loadingEl = null;
        }
    }

    // Queue-based request to avoid OpenClaw lock
    async function sendToAgent(agentId, message) {
        const chat = openChats[agentId];
        if (!chat) return;

        // Create promise chain for this agent
        if (!agentQueues[agentId]) {
            agentQueues[agentId] = Promise.resolve();
        }

        const previousQueue = agentQueues[agentId];

        agentQueues[agentId] = previousQueue.then(async () => {
            try {
                await doSendToAgent(agentId, message);
            } catch (e) {
                console.error(`[Chat] Error sending to ${agentId}:`, e);
                addMessage(agentId, 'error', '发送失败: ' + e.message);
            }
        });

        return agentQueues[agentId];
    }

    async function doSendToAgent(agentId, message) {
        // Continue even if chat window is closed - process in background
        // We'll store the response in conversations[] and show when chat reopens
        const chat = openChats[agentId];

        // Mark agent as busy while processing
        setAgentBusy(agentId, true);

        try {
            // Use Meco Studio API to proxy request to OpenClaw (avoids CORS)
            const response = await fetch(`/api/agents/${agentId}/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            hideLoading(agentId);

            // Read SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            // Create or find message element for streaming
            let msgEl = null;
            if (chat) {
                msgEl = document.createElement('div');
                msgEl.className = 'message assistant';
                msgEl.style.cssText = `
                    align-self: flex-start;
                    background: rgba(255,255,255,0.1);
                    color: #e0e0e0;
                    border-bottom-left-radius: 4px;
                    padding: 10px 14px;
                    border-radius: 18px;
                    max-width: 85%;
                `;
                chat.messagesEl.appendChild(msgEl);
            }

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            // Meco Studio API format: { content: "..." }
                            // Also check for OpenClaw format: { choices: [{ delta: { content: "..." } }] }
                            const content = parsed.content || parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                fullResponse += content;
                                if (msgEl) {
                                    msgEl.textContent = fullResponse;
                                    chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
                                }
                            }
                            // Check for error
                            if (parsed.error) {
                                throw new Error(parsed.error);
                            }
                        } catch (e) {}
                    }
                }
            }

            // Store assistant response in conversation history
            if (fullResponse) {
                conversations[agentId].push({ role: 'assistant', content: fullResponse });
            }

            // Mark agent as not busy after response complete
            setAgentBusy(agentId, false);
        } catch (e) {
            hideLoading(agentId);
            // Mark agent as not busy on error
            setAgentBusy(agentId, false);
            const errorMsg = '发送失败: ' + e.message;
            if (chat) {
                addMessage(agentId, 'error', errorMsg);
            }
            throw e;
        }
    }

    function onWindowResize() {
        if (!container || !camera || !renderer) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }

    // ===== Star Field =====
    let starField = null;
    function createStarField() {
        const starCount = 300;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 250;
            positions[i * 3 + 1] = 50 + Math.random() * 60;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 250;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: 0xFFFFFF, size: 0.5, transparent: true, opacity: 0,
            sizeAttenuation: true
        });
        starField = new THREE.Points(geometry, material);
        starField.visible = false;
        scene.add(starField);
    }

    // ===== Day/Night Cycle Update =====
    function updateDayNightCycle() {
        const now = Date.now();
        if (!dayNightState.initialized) {
            dayNightState.initialized = true;
            dayNightState.cycleStart = now;
            dayNightState.isNight = false;
            dayNightState.transition = 0;
            dayNightState._prevIsNight = false; // track phase flips
        }

        const elapsed = now - dayNightState.cycleStart;
        const currentDuration = dayNightState.isNight ? NIGHT_DURATION : DAY_DURATION;

        // Check if we need to flip phase
        if (elapsed >= currentDuration) {
            dayNightState._prevIsNight = dayNightState.isNight;
            dayNightState.isNight = !dayNightState.isNight;
            dayNightState.cycleStart = now;
        }

        // Calculate transition value (0 = full day, 1 = full night)
        const phaseElapsed = now - dayNightState.cycleStart;
        let targetT = dayNightState.isNight ? 1 : 0;

        // Only do smooth transition if phase actually flipped (not on first init)
        if (phaseElapsed < TRANSITION_DURATION && dayNightState._prevIsNight !== undefined
            && dayNightState._prevIsNight !== dayNightState.isNight) {
            const transProgress = phaseElapsed / TRANSITION_DURATION;
            const eased = transProgress * transProgress * (3 - 2 * transProgress); // smoothstep
            if (dayNightState.isNight) {
                targetT = eased; // 0 → 1
            } else {
                targetT = 1 - eased; // 1 → 0
            }
        }
        dayNightState.transition = targetT;
        const t = targetT;

        // === Sky & Fog ===
        if (t <= 0.5) {
            // Day → Sunset (0..0.5)
            const st = t * 2;
            scene.background.copy(DAY_SKY).lerp(SUNSET_SKY, st);
            scene.fog.color.copy(DAY_FOG).lerp(SUNSET_SKY, st);
        } else {
            // Sunset → Night (0.5..1)
            const st = (t - 0.5) * 2;
            scene.background.copy(SUNSET_SKY).lerp(NIGHT_SKY, st);
            scene.fog.color.copy(SUNSET_SKY).lerp(NIGHT_FOG, st);
        }

        // === Sun Light ===
        worldLights.sun.intensity = 1.0 - t * 0.85;      // 1.0 → 0.15
        worldLights.sun.color.setHex(t < 0.5 ? 0xfffaed : 0x8888AA);

        // === Ambient Light ===
        worldLights.ambient.intensity = 0.6 - t * 0.45;   // 0.6 → 0.15

        // === Moon ===
        worldLights.moon.visible = t > 0.3;
        if (worldLights.moon.visible) {
            worldLights.moon.material.opacity = Math.min(1, (t - 0.3) / 0.3);
        }
        worldLights.moonLight.intensity = t * 0.3;        // 0 → 0.3

        // === Stars ===
        if (starField) {
            starField.visible = t > 0.4;
            if (starField.visible) {
                starField.material.opacity = Math.min(1, (t - 0.4) / 0.3);
                // Twinkle: slightly vary size
                starField.material.size = 0.4 + Math.sin(Date.now() * 0.002) * 0.15;
            }
        }

        // === Lamp Posts — brighten at night ===
        nightObjects.lampPosts.forEach(lp => {
            const pl = lp.userData.pointLight;
            const head = lp.userData.lampHead;
            if (pl) {
                pl.intensity = 0.5 + t * 2.5;    // 0.5 → 3.0
                pl.distance = 8 + t * 12;         // 8 → 20
            }
            if (head) {
                head.material.color.setHex(t > 0.3 ? 0xFFE08A : 0xFFE4B5);
                // Make lamp head emissive at night
                if (!head.material._origType) {
                    // Swap to MeshStandard for emissive support
                    const newMat = new THREE.MeshStandardMaterial({
                        color: 0xFFE4B5,
                        emissive: 0xFFE08A,
                        emissiveIntensity: 0
                    });
                    head.material.dispose();
                    head.material = newMat;
                    head.material._origType = true;
                }
                head.material.emissiveIntensity = t * 1.5; // 0 → 1.5
            }
        });

        // === Windows — warm glow at night ===
        nightObjects.windowMeshes.forEach(win => {
            if (t > 0.2) {
                const glow = Math.min(1, (t - 0.2) / 0.3);
                // Swap to emissive material if needed
                if (!win.userData._nightMat) {
                    const dayCol = win.userData.dayColor || 0x87CEEB;
                    win.userData._dayMat = win.material;
                    win.userData._nightMat = new THREE.MeshStandardMaterial({
                        color: 0xFFD54F,
                        emissive: 0xFFA726,
                        emissiveIntensity: 0,
                        transparent: true,
                        opacity: 1
                    });
                }
                win.material = win.userData._nightMat;
                win.material.emissiveIntensity = glow * 0.8;
                win.material.opacity = 1;
            } else {
                // Restore day material
                if (win.userData._dayMat) {
                    win.material = win.userData._dayMat;
                }
            }
        });

        // === Computer Screens — glow brighter at night ===
        nightObjects.screenMeshes.forEach(scr => {
            scr.material.opacity = 0.8 + t * 0.2;
            // At night the screen is the main light source, make it pop
            if (t > 0.3 && !scr.userData._nightPointLight) {
                const pl = new THREE.PointLight(0x4FC3F7, 0, 5);
                pl.position.copy(scr.position);
                scene.add(pl);
                scr.userData._nightPointLight = pl;
            }
            if (scr.userData._nightPointLight) {
                scr.userData._nightPointLight.intensity = t * 1.5;
            }
        });

        // === Decoration lamps — boost existing point lights at night ===
        // Cache discovered point lights (avoid traverse every frame)
        if (!dayNightState._decLightsCache) {
            dayNightState._decLightsCache = [];
            dayNightState._decLightsDirty = true;
        }
        // Rebuild cache when decoration count changes
        if (dayNightState._decLightsCache._decCount !== placedDecorations.length) {
            dayNightState._decLightsCache = [];
            placedDecorations.forEach(dec => {
                if (dec.userData.animate === 'lighthouse' && dec.userData.beam) {
                    const beamMesh = dec.userData.beam.children[0];
                    if (beamMesh) dayNightState._decLightsCache.push({ type: 'beam', mesh: beamMesh });
                }
                dec.traverse(child => {
                    if (child.isPointLight) {
                        if (!child.userData._dayIntensity) child.userData._dayIntensity = child.intensity;
                        dayNightState._decLightsCache.push({ type: 'light', light: child, dayI: child.userData._dayIntensity });
                    }
                });
            });
            dayNightState._decLightsCache._decCount = placedDecorations.length;
        }
        dayNightState._decLightsCache.forEach(entry => {
            if (entry.type === 'beam') {
                entry.mesh.material.opacity = 0.5 + t * 0.4;
            } else {
                entry.light.intensity = entry.dayI + t * 2;
            }
        });

        // === HUD indicator (throttled to ~1 update/sec) ===
        const hudNow = Date.now();
        if (dayNightState.hudElement && (!dayNightState._lastHud || hudNow - dayNightState._lastHud > 1000)) {
            dayNightState._lastHud = hudNow;
            const phaseElapsed = hudNow - dayNightState.cycleStart;
            const currentDuration = dayNightState.isNight ? NIGHT_DURATION : DAY_DURATION;
            const remaining = Math.max(0, Math.ceil((currentDuration - phaseElapsed) / 1000));
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            const timeStr = min + ':' + (sec < 10 ? '0' : '') + sec;
            if (t < 0.3) {
                dayNightState.hudElement.textContent = '☀️ ' + timeStr;
                dayNightState.hudElement.style.background = 'rgba(255,165,0,0.4)';
            } else if (t < 0.6) {
                dayNightState.hudElement.textContent = '🌅 ' + timeStr;
                dayNightState.hudElement.style.background = 'rgba(180,80,30,0.5)';
            } else {
                dayNightState.hudElement.textContent = '🌙 ' + timeStr;
                dayNightState.hudElement.style.background = 'rgba(20,20,60,0.6)';
            }
        }
    }

    function animate() {
        if (!isActive) return;
        animationId = requestAnimationFrame(animate);

        // Update OrbitControls
        if (controls) controls.update();

        const time = Date.now();

        // Update agents - occasional random movement
        agents.forEach(agent => {
            // Billboard avatar and name to camera
            agent.children.forEach(child => {
                if (child.userData.isSprite || child.userData.isNameLabel) {
                    child.lookAt(camera.position);
                }
                // Animate busy indicator
                if (child.userData.spinning) {
                    child.rotation.z = time * 0.003;
                }
            });

            // Skip movement if agent is busy chatting
            if (agent.userData.isBusy) {
                return;
            }

            // Random movement
            agent.userData.moveTimer -= 16;
            if (agent.userData.moveTimer <= 0) {
                // Set new random target
                let newX, newZ, valid = false;
                let attempts = 0;
                do {
                    newX = agent.position.x + (Math.random() - 0.5) * 20;
                    newZ = agent.position.z + (Math.random() - 0.5) * 20;
                    const dist = Math.sqrt(newX * newX + newZ * newZ);
                    const inHouse = newX > -12 && newX < 2 && newZ > -28 && newZ < -12;
                    const inPond = Math.sqrt((newX - 20) ** 2 + (newZ + 15) ** 2) < 15;
                    if (!inHouse && !inPond && dist > 3 && dist < 40) valid = true;
                    attempts++;
                } while (!valid && attempts < 10);

                if (valid) {
                    agent.userData.targetX = newX;
                    agent.userData.targetZ = newZ;
                    agent.userData.isMoving = true;
                }
                agent.userData.moveTimer = Math.random() * 8000 + 4000;
            }

            // Move towards target
            if (agent.userData.isMoving) {
                const dx = agent.userData.targetX - agent.position.x;
                const dz = agent.userData.targetZ - agent.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist > 0.1) {
                    const speed = 0.02;
                    agent.position.x += (dx / dist) * speed;
                    agent.position.z += (dz / dist) * speed;

                    // Walking animation - slight bounce
                    agent.position.y = Math.sin(time * 0.01) * 0.05;
                } else {
                    agent.userData.isMoving = false;
                    agent.position.y = 0;
                }
            }
        });

        // Update particle pool (single draw call for all particles)
        updateParticlePool();

        // Update day/night cycle
        updateDayNightCycle();

        // Update fun animations
        updateFunAnimations(time);

        // Update animals
        updateAnimals(time);

        // Update farm plots
        updateFarmPlots(time);

        renderer.render(scene, camera);
    }

    function dispose() {
        isActive = false;
        if (animationId) cancelAnimationFrame(animationId);

        // Close all chats
        Object.keys(openChats).forEach(agentId => closeChat(agentId));

        // Clean up day/night state
        dayNightState.initialized = false;
        dayNightState._decLightsCache = null;
        nightObjects.windowMeshes = [];
        nightObjects.lampPosts = [];
        nightObjects.screenMeshes = [];
        starField = null;

        // Clean up particle pool
        if (particlePool.points) {
            if (particlePool.geometry) particlePool.geometry.dispose();
            if (particlePool.points.material) {
                if (particlePool.points.material.map) particlePool.points.material.map.dispose();
                particlePool.points.material.dispose();
            }
            particlePool.points = null;
            particlePool.geometry = null;
        }

        // Clean up Three.js
        if (renderer) {
            renderer.dispose();
            container.innerHTML = '';
        }

        scene = null;
        camera = null;
        renderer = null;
    }

    return { init, dispose, openChat };
})();
